// M2 spike, part 2: can Vulkan take the buffer VAAPI just gave us?
//
// Part 1 (spike.c) established what radeonsi allocates for an NV12 encode
// surface: one buffer object, AMD tiled, DCC off, described as two layers
// (R8 for luma, GR88 for chroma). This asks the other half of ADR D5's
// question — whether RADV will import that exact layout so a shader can write
// NV12 straight into the surface the encoder will read.
//
// `vulkaninfo` cannot answer it: this build prints no per-format modifier list
// at all. So the query is made directly, and then the import is actually
// performed, because "the modifier is advertised" and "the image binds" are not
// the same claim.
//
// Build:  gcc vk_import.c -o vk_import $(pkg-config --cflags libdrm) -lva -lva-drm -lvulkan
// Run:    sg render -c ./vk_import

#include <fcntl.h>
#include <inttypes.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include <drm_fourcc.h>
#include <va/va.h>
#include <va/va_drm.h>
#include <va/va_drmcommon.h>
#include <vulkan/vulkan.h>

#define WIDTH 1920
#define HEIGHT 1080

static VkDevice g_device = VK_NULL_HANDLE;
static PFN_vkGetMemoryFdPropertiesKHR g_get_memory_fd_properties;

// ── Phase 1: allocate + export from VAAPI (D5's order: encoder surface first) ──

static int vaapi_export(VADRMPRIMESurfaceDescriptor *desc, VADisplay *out_dpy,
                        VASurfaceID *out_surface, int *out_drm_fd) {
  int drm_fd = open("/dev/dri/renderD128", O_RDWR);
  if (drm_fd < 0) {
    perror("open /dev/dri/renderD128");
    return 1;
  }
  VADisplay dpy = vaGetDisplayDRM(drm_fd);
  int major, minor;
  if (vaInitialize(dpy, &major, &minor) != VA_STATUS_SUCCESS) {
    fprintf(stderr, "vaInitialize failed\n");
    return 1;
  }
  printf("VA-API %d.%d — %s\n\n", major, minor, vaQueryVendorString(dpy));

  VASurfaceAttrib attrs[2] = {0};
  attrs[0].type = VASurfaceAttribPixelFormat;
  attrs[0].flags = VA_SURFACE_ATTRIB_SETTABLE;
  attrs[0].value.type = VAGenericValueTypeInteger;
  attrs[0].value.value.i = VA_FOURCC_NV12;
  attrs[1].type = VASurfaceAttribUsageHint;
  attrs[1].flags = VA_SURFACE_ATTRIB_SETTABLE;
  attrs[1].value.type = VAGenericValueTypeInteger;
  attrs[1].value.value.i = VA_SURFACE_ATTRIB_USAGE_HINT_ENCODER;

  VASurfaceID surface;
  if (vaCreateSurfaces(dpy, VA_RT_FORMAT_YUV420, WIDTH, HEIGHT, &surface, 1, attrs,
                       2) != VA_STATUS_SUCCESS) {
    fprintf(stderr, "vaCreateSurfaces failed\n");
    return 1;
  }
  if (vaExportSurfaceHandle(dpy, surface, VA_SURFACE_ATTRIB_MEM_TYPE_DRM_PRIME_2,
                            VA_EXPORT_SURFACE_WRITE_ONLY |
                                VA_EXPORT_SURFACE_SEPARATE_LAYERS,
                            desc) != VA_STATUS_SUCCESS) {
    fprintf(stderr, "vaExportSurfaceHandle failed\n");
    return 1;
  }
  *out_dpy = dpy;
  *out_surface = surface;
  *out_drm_fd = drm_fd;
  return 0;
}

// ── Phase 2: does RADV advertise this modifier, and with what capabilities? ──

static const char *fmt_name(VkFormat f) {
  switch (f) {
    case VK_FORMAT_R8_UNORM: return "R8_UNORM        (luma plane)";
    case VK_FORMAT_R8G8_UNORM: return "R8G8_UNORM      (chroma plane)";
    case VK_FORMAT_G8_B8R8_2PLANE_420_UNORM: return "G8_B8R8_2PLANE_420_UNORM (NV12)";
    default: return "?";
  }
}

// The capabilities that decide HOW a shader can write into the surface.
static void print_features(VkFormatFeatureFlags f) {
  printf("        storage=%s colour_attachment=%s transfer_dst=%s sampled=%s\n",
         (f & VK_FORMAT_FEATURE_STORAGE_IMAGE_BIT) ? "yes" : "NO ",
         (f & VK_FORMAT_FEATURE_COLOR_ATTACHMENT_BIT) ? "yes" : "NO ",
         (f & VK_FORMAT_FEATURE_TRANSFER_DST_BIT) ? "yes" : "NO ",
         (f & VK_FORMAT_FEATURE_SAMPLED_IMAGE_BIT) ? "yes" : "NO ");
}

static int modifier_supported(VkPhysicalDevice phys, VkFormat format,
                              uint64_t wanted, VkFormatFeatureFlags *out_features) {
  VkDrmFormatModifierPropertiesListEXT list = {
      .sType = VK_STRUCTURE_TYPE_DRM_FORMAT_MODIFIER_PROPERTIES_LIST_EXT};
  VkFormatProperties2 props = {.sType = VK_STRUCTURE_TYPE_FORMAT_PROPERTIES_2,
                               .pNext = &list};

  vkGetPhysicalDeviceFormatProperties2(phys, format, &props);
  if (list.drmFormatModifierCount == 0) return 0;

  VkDrmFormatModifierPropertiesEXT *mods =
      calloc(list.drmFormatModifierCount, sizeof(*mods));
  list.pDrmFormatModifierProperties = mods;
  vkGetPhysicalDeviceFormatProperties2(phys, format, &props);

  int found = 0;
  printf("    %s — %u modifiers advertised\n", fmt_name(format),
         list.drmFormatModifierCount);
  for (uint32_t i = 0; i < list.drmFormatModifierCount; i++) {
    if (mods[i].drmFormatModifier != wanted) continue;
    found = 1;
    printf("      FOUND 0x%016" PRIx64 " (planes=%u)\n", mods[i].drmFormatModifier,
           mods[i].drmFormatModifierPlaneCount);
    print_features(mods[i].drmFormatModifierTilingFeatures);
    if (out_features) *out_features = mods[i].drmFormatModifierTilingFeatures;
  }
  if (!found) printf("      NOT FOUND — RADV will not import this layout\n");
  free(mods);
  return found;
}

// ── Phase 3: actually import it. Advertised is not the same as bound. ──

static int import_plane(VkPhysicalDevice phys, const char *label, VkFormat format,
                        uint32_t w, uint32_t h, uint64_t modifier, int dmabuf_fd,
                        uint64_t offset, uint64_t pitch, VkImageUsageFlags usage) {
  VkSubresourceLayout plane = {.offset = offset, .rowPitch = pitch};
  VkImageDrmFormatModifierExplicitCreateInfoEXT mod_info = {
      .sType = VK_STRUCTURE_TYPE_IMAGE_DRM_FORMAT_MODIFIER_EXPLICIT_CREATE_INFO_EXT,
      .drmFormatModifier = modifier,
      .drmFormatModifierPlaneCount = 1,
      .pPlaneLayouts = &plane};
  VkExternalMemoryImageCreateInfo ext_info = {
      .sType = VK_STRUCTURE_TYPE_EXTERNAL_MEMORY_IMAGE_CREATE_INFO,
      .pNext = &mod_info,
      .handleTypes = VK_EXTERNAL_MEMORY_HANDLE_TYPE_DMA_BUF_BIT_EXT};
  VkImageCreateInfo image_info = {
      .sType = VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO,
      .pNext = &ext_info,
      .imageType = VK_IMAGE_TYPE_2D,
      .format = format,
      .extent = {w, h, 1},
      .mipLevels = 1,
      .arrayLayers = 1,
      .samples = VK_SAMPLE_COUNT_1_BIT,
      .tiling = VK_IMAGE_TILING_DRM_FORMAT_MODIFIER_EXT,
      .usage = usage,
      .sharingMode = VK_SHARING_MODE_EXCLUSIVE,
      // Mandated by the spec for an explicit plane layout.
      .initialLayout = VK_IMAGE_LAYOUT_PREINITIALIZED};

  VkImage image;
  VkResult r = vkCreateImage(g_device, &image_info, NULL, &image);
  if (r != VK_SUCCESS) {
    printf("    %-8s vkCreateImage FAILED (VkResult %d)\n", label, r);
    return 1;
  }

  // Vulkan takes ownership of the fd it imports, and we import two planes from
  // the same buffer object, so each import gets its own duplicate.
  int fd = dup(dmabuf_fd);
  VkMemoryFdPropertiesKHR fd_props = {
      .sType = VK_STRUCTURE_TYPE_MEMORY_FD_PROPERTIES_KHR};
  g_get_memory_fd_properties(g_device, VK_EXTERNAL_MEMORY_HANDLE_TYPE_DMA_BUF_BIT_EXT,
                             fd, &fd_props);

  VkMemoryRequirements req;
  vkGetImageMemoryRequirements(g_device, image, &req);

  VkPhysicalDeviceMemoryProperties mem_props;
  vkGetPhysicalDeviceMemoryProperties(phys, &mem_props);
  uint32_t type_index = UINT32_MAX;
  const uint32_t candidates = req.memoryTypeBits & fd_props.memoryTypeBits;
  for (uint32_t i = 0; i < mem_props.memoryTypeCount; i++) {
    if (candidates & (1u << i)) { type_index = i; break; }
  }
  if (type_index == UINT32_MAX) {
    printf("    %-8s no memory type accepted by BOTH the image and the dma-buf\n",
           label);
    close(fd);
    vkDestroyImage(g_device, image, NULL);
    return 1;
  }

  VkImportMemoryFdInfoKHR import_info = {
      .sType = VK_STRUCTURE_TYPE_IMPORT_MEMORY_FD_INFO_KHR,
      .handleType = VK_EXTERNAL_MEMORY_HANDLE_TYPE_DMA_BUF_BIT_EXT,
      .fd = fd};
  VkMemoryDedicatedAllocateInfo dedicated = {
      .sType = VK_STRUCTURE_TYPE_MEMORY_DEDICATED_ALLOCATE_INFO,
      .pNext = &import_info,
      .image = image};
  VkMemoryAllocateInfo alloc = {.sType = VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO,
                                .pNext = &dedicated,
                                .allocationSize = req.size,
                                .memoryTypeIndex = type_index};

  VkDeviceMemory memory;
  r = vkAllocateMemory(g_device, &alloc, NULL, &memory);
  if (r != VK_SUCCESS) {
    printf("    %-8s vkAllocateMemory(import) FAILED (VkResult %d)\n", label, r);
    close(fd);
    vkDestroyImage(g_device, image, NULL);
    return 1;
  }

  r = vkBindImageMemory(g_device, image, memory, 0);
  if (r != VK_SUCCESS) {
    printf("    %-8s vkBindImageMemory FAILED (VkResult %d)\n", label, r);
  } else {
    printf("    %-8s IMPORTED and BOUND — %ux%u, offset %" PRIu64 ", pitch %" PRIu64
           ", %" PRIu64 " bytes\n",
           label, w, h, offset, pitch, (uint64_t)req.size);
  }

  vkFreeMemory(g_device, memory, NULL);
  vkDestroyImage(g_device, image, NULL);
  return r == VK_SUCCESS ? 0 : 1;
}

int main(void) {
  VADRMPRIMESurfaceDescriptor desc;
  VADisplay dpy;
  VASurfaceID surface;
  int drm_fd;
  memset(&desc, 0, sizeof(desc));
  if (vaapi_export(&desc, &dpy, &surface, &drm_fd)) return 1;

  const uint64_t modifier = desc.objects[0].drm_format_modifier;
  printf("VAAPI gave us: 1 object, modifier 0x%016" PRIx64 ", %u layers\n\n",
         modifier, desc.num_layers);

  // ── Vulkan instance + the RADV device (never llvmpipe) ──
  VkApplicationInfo app = {.sType = VK_STRUCTURE_TYPE_APPLICATION_INFO,
                           .apiVersion = VK_API_VERSION_1_1};
  VkInstanceCreateInfo ici = {.sType = VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO,
                              .pApplicationInfo = &app};
  VkInstance instance;
  if (vkCreateInstance(&ici, NULL, &instance) != VK_SUCCESS) {
    fprintf(stderr, "vkCreateInstance failed\n");
    return 1;
  }

  uint32_t n = 0;
  vkEnumeratePhysicalDevices(instance, &n, NULL);
  VkPhysicalDevice *devices = calloc(n, sizeof(*devices));
  vkEnumeratePhysicalDevices(instance, &n, devices);

  VkPhysicalDevice phys = VK_NULL_HANDLE;
  for (uint32_t i = 0; i < n; i++) {
    VkPhysicalDeviceProperties p;
    vkGetPhysicalDeviceProperties(devices[i], &p);
    // llvmpipe would happily answer every question and prove nothing: it is a
    // CPU rasteriser and shares no buffer with the video engine.
    if (p.deviceType == VK_PHYSICAL_DEVICE_TYPE_DISCRETE_GPU) {
      phys = devices[i];
      printf("Vulkan device: %s\n\n", p.deviceName);
      break;
    }
  }
  if (!phys) {
    fprintf(stderr, "no discrete GPU found\n");
    return 1;
  }

  printf("== Phase 2: does RADV advertise VAAPI's modifier? ==\n");
  VkFormatFeatureFlags luma_features = 0, chroma_features = 0;
  int ok = modifier_supported(phys, VK_FORMAT_R8_UNORM, modifier, &luma_features);
  ok &= modifier_supported(phys, VK_FORMAT_R8G8_UNORM, modifier, &chroma_features);
  modifier_supported(phys, VK_FORMAT_G8_B8R8_2PLANE_420_UNORM, modifier, NULL);
  if (!ok) {
    printf("\nVERDICT: RADV does not advertise this layout. Option A is dead.\n");
    return 1;
  }

  // ── Device with the import extensions ──
  const char *exts[] = {"VK_KHR_external_memory_fd", "VK_EXT_external_memory_dma_buf",
                        "VK_EXT_image_drm_format_modifier", "VK_KHR_image_format_list",
                        "VK_EXT_queue_family_foreign"};
  float prio = 1.0f;
  VkDeviceQueueCreateInfo q = {.sType = VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO,
                              .queueFamilyIndex = 0,
                              .queueCount = 1,
                              .pQueuePriorities = &prio};
  VkDeviceCreateInfo dci = {.sType = VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO,
                            .queueCreateInfoCount = 1,
                            .pQueueCreateInfos = &q,
                            .enabledExtensionCount = sizeof(exts) / sizeof(*exts),
                            .ppEnabledExtensionNames = exts};
  if (vkCreateDevice(phys, &dci, NULL, &g_device) != VK_SUCCESS) {
    fprintf(stderr, "vkCreateDevice failed\n");
    return 1;
  }
  g_get_memory_fd_properties = (PFN_vkGetMemoryFdPropertiesKHR)vkGetDeviceProcAddr(
      g_device, "vkGetMemoryFdPropertiesKHR");

  // Prefer STORAGE (a compute shader writing NV12 directly); fall back to
  // COLOR_ATTACHMENT (render into it) if the modifier does not allow storage.
  const VkImageUsageFlags luma_usage =
      (luma_features & VK_FORMAT_FEATURE_STORAGE_IMAGE_BIT)
          ? VK_IMAGE_USAGE_STORAGE_BIT
          : VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT;
  const VkImageUsageFlags chroma_usage =
      (chroma_features & VK_FORMAT_FEATURE_STORAGE_IMAGE_BIT)
          ? VK_IMAGE_USAGE_STORAGE_BIT
          : VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT;

  printf("\n== Phase 3: import the actual dma-buf ==\n");
  int rc = 0;
  rc |= import_plane(phys, "luma", VK_FORMAT_R8_UNORM, WIDTH, HEIGHT, modifier,
                     desc.objects[0].fd, desc.layers[0].offset[0],
                     desc.layers[0].pitch[0], luma_usage);
  rc |= import_plane(phys, "chroma", VK_FORMAT_R8G8_UNORM, WIDTH / 2, HEIGHT / 2,
                     modifier, desc.objects[0].fd, desc.layers[1].offset[0],
                     desc.layers[1].pitch[0], chroma_usage);

  printf("\nVERDICT: %s\n",
         rc == 0 ? "the VAAPI encode surface is writable from Vulkan — D5's "
                   "pipeline holds, option A is viable"
                 : "the import failed; see above");

  for (uint32_t i = 0; i < desc.num_objects; i++) close(desc.objects[i].fd);
  vkDestroyDevice(g_device, NULL);
  vkDestroyInstance(instance, NULL);
  vaDestroySurfaces(dpy, &surface, 1);
  vaTerminate(dpy);
  close(drm_fd);
  free(devices);
  return rc;
}
