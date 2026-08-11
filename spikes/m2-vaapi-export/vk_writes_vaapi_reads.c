// M2 spike, part 5: does the video engine see what Vulkan wrote?
//
// Parts 1-3 proved the plumbing: VAAPI hands out an encode surface, RADV imports
// its planes as writable images, and a frame exports and re-imports intact. None
// of that proves the two APIs agree on what the BYTES MEAN. They share a buffer
// and a modifier; if either side interprets the tiling differently, every call
// still succeeds and the picture is scrambled.
//
// That is ADR D5's premise and the last thing that could invalidate M2's
// architecture, so it is measured here rather than assumed.
//
// The pattern is a gradient, deliberately. A flat fill would read back identical
// under ANY tiling — the same trap as testing against a static screen, which has
// already produced two tests in this milestone that passed while proving nothing.
//
// What it does NOT do is encode. Writing an H.264 encoder is several hundred
// lines of well-trodden libva boilerplate and carries no architectural risk;
// this isolates the part that does.
//
// Build: gcc vk_writes_vaapi_reads.c -o vk_writes_vaapi_reads
//              $(pkg-config --cflags libdrm) -lva -lva-drm -lvulkan
// Run:   sg render -c ./vk_writes_vaapi_reads

#include <fcntl.h>
#include <inttypes.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include <va/va.h>
#include <va/va_drm.h>
#include <va/va_drmcommon.h>
#include <vulkan/vulkan.h>

#define WIDTH 640
#define HEIGHT 480

#define CHECK(expr, what)                                                                \
  do {                                                                                   \
    VkResult _r = (expr);                                                                \
    if (_r != VK_SUCCESS) {                                                              \
      fprintf(stderr, "FAIL: %s -> VkResult %d\n", what, _r);                            \
      return 1;                                                                          \
    }                                                                                    \
  } while (0)

#define VACHECK(expr, what)                                                              \
  do {                                                                                   \
    VAStatus _s = (expr);                                                                \
    if (_s != VA_STATUS_SUCCESS) {                                                       \
      fprintf(stderr, "FAIL: %s -> %s\n", what, vaErrorStr(_s));                         \
      return 1;                                                                          \
    }                                                                                    \
  } while (0)

static VkDevice g_device;
static VkPhysicalDevice g_phys;
static VkQueue g_queue;
static VkCommandPool g_pool;

// Y and UV get different functions of (x, y) so a plane swap is visible too, not
// just a tiling mismatch.
static uint8_t expected_luma(uint32_t x, uint32_t y) { return (uint8_t)((x * 3 + y * 5) & 0xff); }
static uint8_t expected_cb(uint32_t x, uint32_t y) { return (uint8_t)((x * 7 + y) & 0xff); }
static uint8_t expected_cr(uint32_t x, uint32_t y) { return (uint8_t)((x + y * 11) & 0xff); }

static uint32_t pick_memory_type(uint32_t candidates, VkMemoryPropertyFlags required) {
  VkPhysicalDeviceMemoryProperties props;
  vkGetPhysicalDeviceMemoryProperties(g_phys, &props);
  for (uint32_t i = 0; i < props.memoryTypeCount; i++) {
    if (!(candidates & (1u << i))) continue;
    if ((props.memoryTypes[i].propertyFlags & required) == required) return i;
  }
  return UINT32_MAX;
}

// Imports one plane of the exported surface and uploads `pixels` into it.
static int upload_plane(int dmabuf, uint64_t modifier, uint64_t offset, uint64_t pitch,
                        VkFormat format, uint32_t w, uint32_t h, uint32_t bytes_per_pixel,
                        const uint8_t *pixels) {
  VkSubresourceLayout plane = {.offset = offset, .rowPitch = pitch};
  VkImageDrmFormatModifierExplicitCreateInfoEXT emod = {
      .sType = VK_STRUCTURE_TYPE_IMAGE_DRM_FORMAT_MODIFIER_EXPLICIT_CREATE_INFO_EXT,
      .drmFormatModifier = modifier,
      .drmFormatModifierPlaneCount = 1,
      .pPlaneLayouts = &plane};
  VkExternalMemoryImageCreateInfo ext = {
      .sType = VK_STRUCTURE_TYPE_EXTERNAL_MEMORY_IMAGE_CREATE_INFO,
      .pNext = &emod,
      .handleTypes = VK_EXTERNAL_MEMORY_HANDLE_TYPE_DMA_BUF_BIT_EXT};
  VkImageCreateInfo ici = {.sType = VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO,
                           .pNext = &ext,
                           .imageType = VK_IMAGE_TYPE_2D,
                           .format = format,
                           .extent = {w, h, 1},
                           .mipLevels = 1,
                           .arrayLayers = 1,
                           .samples = VK_SAMPLE_COUNT_1_BIT,
                           .tiling = VK_IMAGE_TILING_DRM_FORMAT_MODIFIER_EXT,
                           .usage = VK_IMAGE_USAGE_TRANSFER_DST_BIT,
                           .sharingMode = VK_SHARING_MODE_EXCLUSIVE,
                           .initialLayout = VK_IMAGE_LAYOUT_UNDEFINED};
  VkImage image;
  CHECK(vkCreateImage(g_device, &ici, NULL, &image), "vkCreateImage(plane)");

  PFN_vkGetMemoryFdPropertiesKHR get_fd_props =
      (PFN_vkGetMemoryFdPropertiesKHR)vkGetDeviceProcAddr(g_device, "vkGetMemoryFdPropertiesKHR");
  VkMemoryFdPropertiesKHR fdp = {.sType = VK_STRUCTURE_TYPE_MEMORY_FD_PROPERTIES_KHR};
  CHECK(get_fd_props(g_device, VK_EXTERNAL_MEMORY_HANDLE_TYPE_DMA_BUF_BIT_EXT, dmabuf, &fdp),
        "vkGetMemoryFdPropertiesKHR");
  VkMemoryRequirements req;
  vkGetImageMemoryRequirements(g_device, image, &req);
  VkImportMemoryFdInfoKHR imp = {.sType = VK_STRUCTURE_TYPE_IMPORT_MEMORY_FD_INFO_KHR,
                                 .handleType = VK_EXTERNAL_MEMORY_HANDLE_TYPE_DMA_BUF_BIT_EXT,
                                 .fd = dup(dmabuf)};
  VkMemoryDedicatedAllocateInfo ded = {.sType = VK_STRUCTURE_TYPE_MEMORY_DEDICATED_ALLOCATE_INFO,
                                       .pNext = &imp,
                                       .image = image};
  VkMemoryAllocateInfo mai = {
      .sType = VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO,
      .pNext = &ded,
      .allocationSize = req.size,
      .memoryTypeIndex = pick_memory_type(req.memoryTypeBits & fdp.memoryTypeBits, 0)};
  VkDeviceMemory mem;
  CHECK(vkAllocateMemory(g_device, &mai, NULL, &mem), "vkAllocateMemory(import)");
  CHECK(vkBindImageMemory(g_device, image, mem, 0), "vkBindImageMemory");

  // Staging buffer holding the pattern, tightly packed.
  const VkDeviceSize bytes = (VkDeviceSize)w * h * bytes_per_pixel;
  VkBufferCreateInfo bci = {.sType = VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO,
                            .size = bytes,
                            .usage = VK_BUFFER_USAGE_TRANSFER_SRC_BIT};
  VkBuffer staging;
  CHECK(vkCreateBuffer(g_device, &bci, NULL, &staging), "vkCreateBuffer");
  VkMemoryRequirements breq;
  vkGetBufferMemoryRequirements(g_device, staging, &breq);
  VkMemoryAllocateInfo bmai = {
      .sType = VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO,
      .allocationSize = breq.size,
      .memoryTypeIndex = pick_memory_type(breq.memoryTypeBits,
                                          VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT |
                                              VK_MEMORY_PROPERTY_HOST_COHERENT_BIT)};
  VkDeviceMemory bmem;
  CHECK(vkAllocateMemory(g_device, &bmai, NULL, &bmem), "vkAllocateMemory(staging)");
  CHECK(vkBindBufferMemory(g_device, staging, bmem, 0), "vkBindBufferMemory");
  void *mapped = NULL;
  CHECK(vkMapMemory(g_device, bmem, 0, bytes, 0, &mapped), "vkMapMemory");
  memcpy(mapped, pixels, bytes);
  vkUnmapMemory(g_device, bmem);

  VkCommandBufferAllocateInfo cai = {.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO,
                                     .commandPool = g_pool,
                                     .level = VK_COMMAND_BUFFER_LEVEL_PRIMARY,
                                     .commandBufferCount = 1};
  VkCommandBuffer cmd;
  CHECK(vkAllocateCommandBuffers(g_device, &cai, &cmd), "vkAllocateCommandBuffers");
  VkCommandBufferBeginInfo cbi = {.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO,
                                  .flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT};
  CHECK(vkBeginCommandBuffer(cmd, &cbi), "vkBeginCommandBuffer");

  VkImageMemoryBarrier to_dst = {.sType = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER,
                                 .dstAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT,
                                 .oldLayout = VK_IMAGE_LAYOUT_UNDEFINED,
                                 .newLayout = VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL,
                                 .srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED,
                                 .dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED,
                                 .image = image,
                                 .subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1}};
  vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT, VK_PIPELINE_STAGE_TRANSFER_BIT, 0,
                       0, NULL, 0, NULL, 1, &to_dst);
  VkBufferImageCopy region = {.imageSubresource = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 0, 1},
                              .imageExtent = {w, h, 1}};
  vkCmdCopyBufferToImage(cmd, staging, image, VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL, 1, &region);

  // Hand the plane to the video engine, which is a foreign queue family as far
  // as Vulkan is concerned.
  VkImageMemoryBarrier release = {.sType = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER,
                                  .srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT,
                                  .oldLayout = VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL,
                                  .newLayout = VK_IMAGE_LAYOUT_GENERAL,
                                  .srcQueueFamilyIndex = 0,
                                  .dstQueueFamilyIndex = VK_QUEUE_FAMILY_FOREIGN_EXT,
                                  .image = image,
                                  .subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1}};
  vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_TRANSFER_BIT, VK_PIPELINE_STAGE_BOTTOM_OF_PIPE_BIT,
                       0, 0, NULL, 0, NULL, 1, &release);
  CHECK(vkEndCommandBuffer(cmd), "vkEndCommandBuffer");

  VkSubmitInfo si = {
      .sType = VK_STRUCTURE_TYPE_SUBMIT_INFO, .commandBufferCount = 1, .pCommandBuffers = &cmd};
  CHECK(vkQueueSubmit(g_queue, 1, &si, VK_NULL_HANDLE), "vkQueueSubmit");
  CHECK(vkQueueWaitIdle(g_queue), "vkQueueWaitIdle");
  return 0;
}

int main(void) {
  // ── VAAPI allocates first. That ordering is the whole of D5. ──
  int drm_fd = open("/dev/dri/renderD128", O_RDWR);
  if (drm_fd < 0) { perror("open renderD128"); return 1; }
  VADisplay dpy = vaGetDisplayDRM(drm_fd);
  int major, minor;
  VACHECK(vaInitialize(dpy, &major, &minor), "vaInitialize");
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
  VACHECK(vaCreateSurfaces(dpy, VA_RT_FORMAT_YUV420, WIDTH, HEIGHT, &surface, 1, attrs, 2),
          "vaCreateSurfaces");

  VADRMPRIMESurfaceDescriptor desc = {0};
  VACHECK(vaExportSurfaceHandle(dpy, surface, VA_SURFACE_ATTRIB_MEM_TYPE_DRM_PRIME_2,
                                VA_EXPORT_SURFACE_WRITE_ONLY | VA_EXPORT_SURFACE_SEPARATE_LAYERS,
                                &desc),
          "vaExportSurfaceHandle");
  printf("surface: modifier %#018" PRIx64 ", %u layers\n", desc.objects[0].drm_format_modifier,
         desc.num_layers);
  for (uint32_t i = 0; i < desc.num_layers; i++)
    printf("  layer %u: offset %u pitch %u\n", i, desc.layers[i].offset[0],
           desc.layers[i].pitch[0]);

  // ── Vulkan writes a gradient into both planes ──
  VkApplicationInfo app = {.sType = VK_STRUCTURE_TYPE_APPLICATION_INFO,
                           .apiVersion = VK_API_VERSION_1_1};
  VkInstanceCreateInfo ici = {.sType = VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO,
                              .pApplicationInfo = &app};
  VkInstance instance;
  CHECK(vkCreateInstance(&ici, NULL, &instance), "vkCreateInstance");
  uint32_t n = 0;
  vkEnumeratePhysicalDevices(instance, &n, NULL);
  VkPhysicalDevice *all = calloc(n, sizeof(*all));
  vkEnumeratePhysicalDevices(instance, &n, all);
  for (uint32_t i = 0; i < n; i++) {
    VkPhysicalDeviceProperties p;
    vkGetPhysicalDeviceProperties(all[i], &p);
    if (p.deviceType == VK_PHYSICAL_DEVICE_TYPE_DISCRETE_GPU) { g_phys = all[i]; break; }
  }
  if (!g_phys) { fprintf(stderr, "no discrete GPU\n"); return 1; }

  const char *exts[] = {"VK_KHR_external_memory_fd", "VK_EXT_external_memory_dma_buf",
                        "VK_EXT_image_drm_format_modifier", "VK_KHR_image_format_list",
                        "VK_EXT_queue_family_foreign"};
  float prio = 1.0f;
  VkDeviceQueueCreateInfo qci = {.sType = VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO,
                                 .queueFamilyIndex = 0,
                                 .queueCount = 1,
                                 .pQueuePriorities = &prio};
  VkDeviceCreateInfo dci = {.sType = VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO,
                            .queueCreateInfoCount = 1,
                            .pQueueCreateInfos = &qci,
                            .enabledExtensionCount = sizeof(exts) / sizeof(*exts),
                            .ppEnabledExtensionNames = exts};
  CHECK(vkCreateDevice(g_phys, &dci, NULL, &g_device), "vkCreateDevice");
  vkGetDeviceQueue(g_device, 0, 0, &g_queue);
  VkCommandPoolCreateInfo pci = {.sType = VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO,
                                 .queueFamilyIndex = 0,
                                 .flags = VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT};
  CHECK(vkCreateCommandPool(g_device, &pci, NULL, &g_pool), "vkCreateCommandPool");

  uint8_t *luma = malloc((size_t)WIDTH * HEIGHT);
  for (uint32_t y = 0; y < HEIGHT; y++)
    for (uint32_t x = 0; x < WIDTH; x++) luma[y * WIDTH + x] = expected_luma(x, y);

  uint8_t *chroma = malloc((size_t)(WIDTH / 2) * (HEIGHT / 2) * 2);
  for (uint32_t y = 0; y < HEIGHT / 2; y++) {
    for (uint32_t x = 0; x < WIDTH / 2; x++) {
      chroma[(y * (WIDTH / 2) + x) * 2 + 0] = expected_cb(x, y);
      chroma[(y * (WIDTH / 2) + x) * 2 + 1] = expected_cr(x, y);
    }
  }

  const uint64_t modifier = desc.objects[0].drm_format_modifier;
  if (upload_plane(desc.objects[0].fd, modifier, desc.layers[0].offset[0],
                   desc.layers[0].pitch[0], VK_FORMAT_R8_UNORM, WIDTH, HEIGHT, 1, luma))
    return 1;
  if (upload_plane(desc.objects[0].fd, modifier, desc.layers[1].offset[0],
                   desc.layers[1].pitch[0], VK_FORMAT_R8G8_UNORM, WIDTH / 2, HEIGHT / 2, 2,
                   chroma))
    return 1;
  printf("\nVulkan wrote a gradient into both planes\n");

  // ── Now ask VAAPI what it sees. This is the whole experiment. ──
  VACHECK(vaSyncSurface(dpy, surface), "vaSyncSurface");

  // vaDeriveImage is deliberately NOT used, and the first version of this spike
  // failed because it was.
  //
  // It succeeds on this driver and then describes a LINEAR layout — chroma pitch
  // 768 at offset 368640 — for a surface the export describes as tiled with
  // chroma pitch 1024 at offset 393216. Reading the tiled bytes through linear
  // strides scrambles them, and 99.6% of the image "disagreed". VAAPI was
  // contradicting itself, and the wrong description won.
  //
  // vaGetImage instead asks the DRIVER to detile into a linear image. That is the
  // driver's authoritative view of the surface, which is the only thing worth
  // comparing against.
  VAImage derived;
  if (vaDeriveImage(dpy, surface, &derived) == VA_STATUS_SUCCESS) {
    printf("(vaDeriveImage claims pitches %u/%u, offsets %u/%u — it does NOT "
           "describe the exported buffer; ignored)\n",
           derived.pitches[0], derived.pitches[1], derived.offsets[0], derived.offsets[1]);
    vaDestroyImage(dpy, derived.image_id);
  }

  VAImage image;
  VAImageFormat fmt = {
      .fourcc = VA_FOURCC_NV12, .byte_order = VA_LSB_FIRST, .bits_per_pixel = 12};
  VACHECK(vaCreateImage(dpy, &fmt, WIDTH, HEIGHT, &image), "vaCreateImage");
  VACHECK(vaGetImage(dpy, surface, 0, 0, WIDTH, HEIGHT, image.image_id), "vaGetImage");
  printf("VAAPI's view: %ux%u, %u planes, pitches %u/%u, offsets %u/%u\n", image.width,
         image.height, image.num_planes, image.pitches[0], image.pitches[1], image.offsets[0],
         image.offsets[1]);

  uint8_t *base = NULL;
  VACHECK(vaMapBuffer(dpy, image.buf, (void **)&base), "vaMapBuffer");

  size_t luma_wrong = 0, chroma_wrong = 0;
  for (uint32_t y = 0; y < HEIGHT; y++) {
    const uint8_t *row = base + image.offsets[0] + (size_t)y * image.pitches[0];
    for (uint32_t x = 0; x < WIDTH; x++)
      if (row[x] != expected_luma(x, y)) luma_wrong++;
  }
  for (uint32_t y = 0; y < HEIGHT / 2; y++) {
    const uint8_t *row = base + image.offsets[1] + (size_t)y * image.pitches[1];
    for (uint32_t x = 0; x < WIDTH / 2; x++) {
      if (row[x * 2 + 0] != expected_cb(x, y)) chroma_wrong++;
      if (row[x * 2 + 1] != expected_cr(x, y)) chroma_wrong++;
    }
  }

  printf("\nluma   : %zu wrong of %d\n", luma_wrong, WIDTH * HEIGHT);
  printf("chroma : %zu wrong of %d\n", chroma_wrong, WIDTH * HEIGHT / 2);
  vaUnmapBuffer(dpy, image.buf);
  vaDestroyImage(dpy, image.image_id);

  const int ok = luma_wrong == 0 && chroma_wrong == 0;
  printf("\nVERDICT: %s\n",
         ok ? "the video engine reads exactly what Vulkan wrote — D5's pipeline is sound"
            : "the two APIs disagree about the surface; the tiling is being "
              "reinterpreted somewhere");

  for (uint32_t i = 0; i < desc.num_objects; i++) close(desc.objects[i].fd);
  vaDestroySurfaces(dpy, &surface, 1);
  vaTerminate(dpy);
  close(drm_fd);
  return ok ? 0 : 1;
}
