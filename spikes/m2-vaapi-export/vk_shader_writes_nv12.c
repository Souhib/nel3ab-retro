// M2 spike, part 6: a compute shader writing NV12 straight into the encode surface.
//
// Part 5 proved the two APIs agree on the bytes, but it wrote them with
// vkCmdCopyBufferToImage. The real pipeline writes them from a SHADER, into
// storage images backed by a tiled dma-buf — and "RADV advertises storage=yes on
// that modifier" is not the same claim as "a shader can write it". This
// milestone has been caught by that distinction more than once.
//
// It also pins the colour conversion. BT.709 limited range gets checked against
// a CPU reference computed independently, because a wrong matrix or a wrong
// range produces a picture that looks *almost* right, which is much harder to
// notice than a broken one.
//
// Build: see README
// Run:   sg render -c ./vk_shader_writes_nv12

#include <fcntl.h>
#include <inttypes.h>
#include <math.h>
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
#define SPIRV_PATH "rgba_to_nv12.spv"

// Shader maths is float, the reference is double, and NV12 quantises to 8 bits.
// One step of disagreement is rounding; more than that is a real difference.
#define TOLERANCE 1

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

// A picture with structure in every channel: gradients that differ per channel,
// so a swapped plane or a wrong matrix cannot cancel out.
static void source_pixel(uint32_t x, uint32_t y, uint8_t rgba[4]) {
  rgba[0] = (uint8_t)((x * 2 + y) & 0xff);
  rgba[1] = (uint8_t)((y * 3) & 0xff);
  rgba[2] = (uint8_t)((x + y * 5) & 0xff);
  rgba[3] = 255;
}

// The reference, in double, from the same BT.709 limited-range definition the
// shader uses — written out longhand rather than shared, so a mistake in one
// does not hide in the other.
static double srgb_luma(double r, double g, double b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

static uint8_t expected_luma(uint32_t x, uint32_t y) {
  uint8_t p[4];
  source_pixel(x, y, p);
  const double y_lin = srgb_luma(p[0] / 255.0, p[1] / 255.0, p[2] / 255.0);
  return (uint8_t)lround(16.0 + 219.0 * y_lin);
}

static void expected_chroma(uint32_t cx, uint32_t cy, uint8_t *cb, uint8_t *cr) {
  double r = 0, g = 0, b = 0;
  for (uint32_t dy = 0; dy < 2; dy++) {
    for (uint32_t dx = 0; dx < 2; dx++) {
      uint8_t p[4];
      source_pixel(cx * 2 + dx, cy * 2 + dy, p);
      r += p[0] / 255.0;
      g += p[1] / 255.0;
      b += p[2] / 255.0;
    }
  }
  r /= 4.0; g /= 4.0; b /= 4.0;
  const double y = srgb_luma(r, g, b);
  *cb = (uint8_t)lround(128.0 + 224.0 * ((b - y) / 1.8556));
  *cr = (uint8_t)lround(128.0 + 224.0 * ((r - y) / 1.5748));
}

static uint32_t pick_memory_type(uint32_t candidates, VkMemoryPropertyFlags required) {
  VkPhysicalDeviceMemoryProperties props;
  vkGetPhysicalDeviceMemoryProperties(g_phys, &props);
  for (uint32_t i = 0; i < props.memoryTypeCount; i++) {
    if (!(candidates & (1u << i))) continue;
    if ((props.memoryTypes[i].propertyFlags & required) == required) return i;
  }
  return UINT32_MAX;
}

static int import_plane(int dmabuf, uint64_t modifier, uint64_t offset, uint64_t pitch,
                        VkFormat format, uint32_t w, uint32_t h, VkImage *out) {
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
                           // STORAGE: the shader writes here directly.
                           .usage = VK_IMAGE_USAGE_STORAGE_BIT,
                           .sharingMode = VK_SHARING_MODE_EXCLUSIVE,
                           .initialLayout = VK_IMAGE_LAYOUT_UNDEFINED};
  CHECK(vkCreateImage(g_device, &ici, NULL, out), "vkCreateImage(plane)");

  PFN_vkGetMemoryFdPropertiesKHR get_fd_props =
      (PFN_vkGetMemoryFdPropertiesKHR)vkGetDeviceProcAddr(g_device, "vkGetMemoryFdPropertiesKHR");
  VkMemoryFdPropertiesKHR fdp = {.sType = VK_STRUCTURE_TYPE_MEMORY_FD_PROPERTIES_KHR};
  CHECK(get_fd_props(g_device, VK_EXTERNAL_MEMORY_HANDLE_TYPE_DMA_BUF_BIT_EXT, dmabuf, &fdp),
        "vkGetMemoryFdPropertiesKHR");
  VkMemoryRequirements req;
  vkGetImageMemoryRequirements(g_device, *out, &req);
  VkImportMemoryFdInfoKHR imp = {.sType = VK_STRUCTURE_TYPE_IMPORT_MEMORY_FD_INFO_KHR,
                                 .handleType = VK_EXTERNAL_MEMORY_HANDLE_TYPE_DMA_BUF_BIT_EXT,
                                 .fd = dup(dmabuf)};
  VkMemoryDedicatedAllocateInfo ded = {.sType = VK_STRUCTURE_TYPE_MEMORY_DEDICATED_ALLOCATE_INFO,
                                       .pNext = &imp,
                                       .image = *out};
  VkMemoryAllocateInfo mai = {
      .sType = VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO,
      .pNext = &ded,
      .allocationSize = req.size,
      .memoryTypeIndex = pick_memory_type(req.memoryTypeBits & fdp.memoryTypeBits, 0)};
  VkDeviceMemory mem;
  CHECK(vkAllocateMemory(g_device, &mai, NULL, &mem), "vkAllocateMemory(import)");
  CHECK(vkBindImageMemory(g_device, *out, mem, 0), "vkBindImageMemory");
  return 0;
}

int main(void) {
  // ── VAAPI allocates the destination first. That ordering is D5. ──
  int drm_fd = open("/dev/dri/renderD128", O_RDWR);
  if (drm_fd < 0) { perror("open renderD128"); return 1; }
  VADisplay dpy = vaGetDisplayDRM(drm_fd);
  int major, minor;
  VACHECK(vaInitialize(dpy, &major, &minor), "vaInitialize");
  printf("%s\n\n", vaQueryVendorString(dpy));

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

  // ── Vulkan ──
  VkApplicationInfo app = {.sType = VK_STRUCTURE_TYPE_APPLICATION_INFO,
                           .apiVersion = VK_API_VERSION_1_1};
  VkInstanceCreateInfo ci = {.sType = VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO,
                             .pApplicationInfo = &app};
  VkInstance instance;
  CHECK(vkCreateInstance(&ci, NULL, &instance), "vkCreateInstance");
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
                                 .queueFamilyIndex = 0};
  CHECK(vkCreateCommandPool(g_device, &pci, NULL, &g_pool), "vkCreateCommandPool");

  // ── the source frame, standing in for Dolphin's export ──
  VkImageCreateInfo sici = {.sType = VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO,
                            .imageType = VK_IMAGE_TYPE_2D,
                            .format = VK_FORMAT_R8G8B8A8_UNORM,
                            .extent = {WIDTH, HEIGHT, 1},
                            .mipLevels = 1,
                            .arrayLayers = 1,
                            .samples = VK_SAMPLE_COUNT_1_BIT,
                            .tiling = VK_IMAGE_TILING_OPTIMAL,
                            .usage = VK_IMAGE_USAGE_TRANSFER_DST_BIT |
                                     VK_IMAGE_USAGE_SAMPLED_BIT,
                            .sharingMode = VK_SHARING_MODE_EXCLUSIVE,
                            .initialLayout = VK_IMAGE_LAYOUT_UNDEFINED};
  VkImage source;
  CHECK(vkCreateImage(g_device, &sici, NULL, &source), "vkCreateImage(source)");
  VkMemoryRequirements sreq;
  vkGetImageMemoryRequirements(g_device, source, &sreq);
  VkMemoryAllocateInfo smai = {
      .sType = VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO,
      .allocationSize = sreq.size,
      .memoryTypeIndex = pick_memory_type(sreq.memoryTypeBits,
                                          VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT)};
  VkDeviceMemory smem;
  CHECK(vkAllocateMemory(g_device, &smai, NULL, &smem), "vkAllocateMemory(source)");
  CHECK(vkBindImageMemory(g_device, source, smem, 0), "vkBindImageMemory(source)");

  const VkDeviceSize src_bytes = (VkDeviceSize)WIDTH * HEIGHT * 4;
  uint8_t *pattern = malloc(src_bytes);
  for (uint32_t y = 0; y < HEIGHT; y++)
    for (uint32_t x = 0; x < WIDTH; x++) source_pixel(x, y, &pattern[(y * WIDTH + x) * 4]);

  VkBufferCreateInfo bci = {.sType = VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO,
                            .size = src_bytes,
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
  void *mapped;
  CHECK(vkMapMemory(g_device, bmem, 0, src_bytes, 0, &mapped), "vkMapMemory");
  memcpy(mapped, pattern, src_bytes);
  vkUnmapMemory(g_device, bmem);

  // ── the two destination planes, imported as storage images ──
  VkImage luma, chroma;
  const uint64_t modifier = desc.objects[0].drm_format_modifier;
  if (import_plane(desc.objects[0].fd, modifier, desc.layers[0].offset[0],
                   desc.layers[0].pitch[0], VK_FORMAT_R8_UNORM, WIDTH, HEIGHT, &luma))
    return 1;
  if (import_plane(desc.objects[0].fd, modifier, desc.layers[1].offset[0],
                   desc.layers[1].pitch[0], VK_FORMAT_R8G8_UNORM, WIDTH / 2, HEIGHT / 2,
                   &chroma))
    return 1;
  printf("planes imported as storage images\n");

  // ── the pipeline ──
  FILE *spv = fopen(SPIRV_PATH, "rb");
  if (!spv) { perror("open " SPIRV_PATH); return 1; }
  fseek(spv, 0, SEEK_END);
  long spv_len = ftell(spv);
  fseek(spv, 0, SEEK_SET);
  uint32_t *code = malloc((size_t)spv_len);
  if (fread(code, 1, (size_t)spv_len, spv) != (size_t)spv_len) return 1;
  fclose(spv);

  VkShaderModuleCreateInfo smci = {.sType = VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO,
                                   .codeSize = (size_t)spv_len,
                                   .pCode = code};
  VkShaderModule module;
  CHECK(vkCreateShaderModule(g_device, &smci, NULL, &module), "vkCreateShaderModule");

  VkDescriptorSetLayoutBinding bindings[3] = {
      {0, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, 1, VK_SHADER_STAGE_COMPUTE_BIT, NULL},
      {1, VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, 1, VK_SHADER_STAGE_COMPUTE_BIT, NULL},
      {2, VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, 1, VK_SHADER_STAGE_COMPUTE_BIT, NULL}};
  VkDescriptorSetLayoutCreateInfo dslci = {
      .sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO,
      .bindingCount = 3,
      .pBindings = bindings};
  VkDescriptorSetLayout dsl;
  CHECK(vkCreateDescriptorSetLayout(g_device, &dslci, NULL, &dsl),
        "vkCreateDescriptorSetLayout");

  VkPushConstantRange push = {VK_SHADER_STAGE_COMPUTE_BIT, 0, sizeof(int32_t) * 2};
  VkPipelineLayoutCreateInfo plci = {.sType = VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO,
                                     .setLayoutCount = 1,
                                     .pSetLayouts = &dsl,
                                     .pushConstantRangeCount = 1,
                                     .pPushConstantRanges = &push};
  VkPipelineLayout layout;
  CHECK(vkCreatePipelineLayout(g_device, &plci, NULL, &layout), "vkCreatePipelineLayout");

  VkComputePipelineCreateInfo cpci = {
      .sType = VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO,
      .stage = {.sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO,
                .stage = VK_SHADER_STAGE_COMPUTE_BIT,
                .module = module,
                .pName = "main"},
      .layout = layout};
  VkPipeline pipeline;
  CHECK(vkCreateComputePipelines(g_device, VK_NULL_HANDLE, 1, &cpci, NULL, &pipeline),
        "vkCreateComputePipelines");

  VkDescriptorPoolSize sizes[2] = {{VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, 1},
                                   {VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, 2}};
  VkDescriptorPoolCreateInfo dpci = {.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO,
                                     .maxSets = 1,
                                     .poolSizeCount = 2,
                                     .pPoolSizes = sizes};
  VkDescriptorPool dpool;
  CHECK(vkCreateDescriptorPool(g_device, &dpci, NULL, &dpool), "vkCreateDescriptorPool");
  VkDescriptorSetAllocateInfo dsai = {.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO,
                                      .descriptorPool = dpool,
                                      .descriptorSetCount = 1,
                                      .pSetLayouts = &dsl};
  VkDescriptorSet dset;
  CHECK(vkAllocateDescriptorSets(g_device, &dsai, &dset), "vkAllocateDescriptorSets");

  VkSamplerCreateInfo saci = {.sType = VK_STRUCTURE_TYPE_SAMPLER_CREATE_INFO,
                              .magFilter = VK_FILTER_NEAREST,
                              .minFilter = VK_FILTER_NEAREST,
                              .addressModeU = VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE,
                              .addressModeV = VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE};
  VkSampler sampler;
  CHECK(vkCreateSampler(g_device, &saci, NULL, &sampler), "vkCreateSampler");

  VkImageView views[3];
  VkImageViewCreateInfo vci = {.sType = VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO,
                               .viewType = VK_IMAGE_VIEW_TYPE_2D,
                               .subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1}};
  vci.image = source;  vci.format = VK_FORMAT_R8G8B8A8_UNORM;
  CHECK(vkCreateImageView(g_device, &vci, NULL, &views[0]), "view(source)");
  vci.image = luma;    vci.format = VK_FORMAT_R8_UNORM;
  CHECK(vkCreateImageView(g_device, &vci, NULL, &views[1]), "view(luma)");
  vci.image = chroma;  vci.format = VK_FORMAT_R8G8_UNORM;
  CHECK(vkCreateImageView(g_device, &vci, NULL, &views[2]), "view(chroma)");

  VkDescriptorImageInfo infos[3] = {
      {sampler, views[0], VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL},
      {VK_NULL_HANDLE, views[1], VK_IMAGE_LAYOUT_GENERAL},
      {VK_NULL_HANDLE, views[2], VK_IMAGE_LAYOUT_GENERAL}};
  VkWriteDescriptorSet writes[3] = {
      {.sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, .dstSet = dset, .dstBinding = 0,
       .descriptorCount = 1, .descriptorType = VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER,
       .pImageInfo = &infos[0]},
      {.sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, .dstSet = dset, .dstBinding = 1,
       .descriptorCount = 1, .descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_IMAGE,
       .pImageInfo = &infos[1]},
      {.sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, .dstSet = dset, .dstBinding = 2,
       .descriptorCount = 1, .descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_IMAGE,
       .pImageInfo = &infos[2]}};
  vkUpdateDescriptorSets(g_device, 3, writes, 0, NULL);

  // ── record: upload the source, convert, hand the planes to the video engine ──
  VkCommandBufferAllocateInfo cai = {.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO,
                                     .commandPool = g_pool,
                                     .level = VK_COMMAND_BUFFER_LEVEL_PRIMARY,
                                     .commandBufferCount = 1};
  VkCommandBuffer cmd;
  CHECK(vkAllocateCommandBuffers(g_device, &cai, &cmd), "vkAllocateCommandBuffers");
  VkCommandBufferBeginInfo cbi = {.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO,
                                  .flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT};
  CHECK(vkBeginCommandBuffer(cmd, &cbi), "vkBeginCommandBuffer");

  VkImageMemoryBarrier pre[3] = {
      {.sType = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER, .dstAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT,
       .oldLayout = VK_IMAGE_LAYOUT_UNDEFINED, .newLayout = VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL,
       .srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED, .dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED,
       .image = source, .subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1}},
      {.sType = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER, .dstAccessMask = VK_ACCESS_SHADER_WRITE_BIT,
       .oldLayout = VK_IMAGE_LAYOUT_UNDEFINED, .newLayout = VK_IMAGE_LAYOUT_GENERAL,
       .srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED, .dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED,
       .image = luma, .subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1}},
      {.sType = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER, .dstAccessMask = VK_ACCESS_SHADER_WRITE_BIT,
       .oldLayout = VK_IMAGE_LAYOUT_UNDEFINED, .newLayout = VK_IMAGE_LAYOUT_GENERAL,
       .srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED, .dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED,
       .image = chroma, .subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1}}};
  vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT,
                       VK_PIPELINE_STAGE_TRANSFER_BIT | VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, 0,
                       0, NULL, 0, NULL, 3, pre);

  VkBufferImageCopy region = {.imageSubresource = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 0, 1},
                              .imageExtent = {WIDTH, HEIGHT, 1}};
  vkCmdCopyBufferToImage(cmd, staging, source, VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL, 1, &region);

  VkImageMemoryBarrier to_read = {
      .sType = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER,
      .srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT, .dstAccessMask = VK_ACCESS_SHADER_READ_BIT,
      .oldLayout = VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL,
      .newLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL,
      .srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED, .dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED,
      .image = source, .subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1}};
  vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_TRANSFER_BIT,
                       VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, 0, 0, NULL, 0, NULL, 1, &to_read);

  vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, pipeline);
  vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, layout, 0, 1, &dset, 0, NULL);
  const int32_t chroma_size[2] = {WIDTH / 2, HEIGHT / 2};
  vkCmdPushConstants(cmd, layout, VK_SHADER_STAGE_COMPUTE_BIT, 0, sizeof(chroma_size),
                     chroma_size);
  vkCmdDispatch(cmd, (WIDTH / 2 + 7) / 8, (HEIGHT / 2 + 7) / 8, 1);

  VkImageMemoryBarrier release[2] = {
      {.sType = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER, .srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT,
       .oldLayout = VK_IMAGE_LAYOUT_GENERAL, .newLayout = VK_IMAGE_LAYOUT_GENERAL,
       .srcQueueFamilyIndex = 0, .dstQueueFamilyIndex = VK_QUEUE_FAMILY_FOREIGN_EXT,
       .image = luma, .subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1}},
      {.sType = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER, .srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT,
       .oldLayout = VK_IMAGE_LAYOUT_GENERAL, .newLayout = VK_IMAGE_LAYOUT_GENERAL,
       .srcQueueFamilyIndex = 0, .dstQueueFamilyIndex = VK_QUEUE_FAMILY_FOREIGN_EXT,
       .image = chroma, .subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1}}};
  vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                       VK_PIPELINE_STAGE_BOTTOM_OF_PIPE_BIT, 0, 0, NULL, 0, NULL, 2, release);
  CHECK(vkEndCommandBuffer(cmd), "vkEndCommandBuffer");

  VkSubmitInfo si = {
      .sType = VK_STRUCTURE_TYPE_SUBMIT_INFO, .commandBufferCount = 1, .pCommandBuffers = &cmd};
  CHECK(vkQueueSubmit(g_queue, 1, &si, VK_NULL_HANDLE), "vkQueueSubmit");
  CHECK(vkQueueWaitIdle(g_queue), "vkQueueWaitIdle");
  printf("shader converted RGBA -> NV12 in place\n");

  // ── ask the driver to detile, and compare against the reference ──
  VACHECK(vaSyncSurface(dpy, surface), "vaSyncSurface");
  VAImage image;
  VAImageFormat fmt = {
      .fourcc = VA_FOURCC_NV12, .byte_order = VA_LSB_FIRST, .bits_per_pixel = 12};
  VACHECK(vaCreateImage(dpy, &fmt, WIDTH, HEIGHT, &image), "vaCreateImage");
  VACHECK(vaGetImage(dpy, surface, 0, 0, WIDTH, HEIGHT, image.image_id), "vaGetImage");
  uint8_t *base = NULL;
  VACHECK(vaMapBuffer(dpy, image.buf, (void **)&base), "vaMapBuffer");

  size_t luma_wrong = 0, chroma_wrong = 0, worst = 0;
  for (uint32_t y = 0; y < HEIGHT; y++) {
    const uint8_t *row = base + image.offsets[0] + (size_t)y * image.pitches[0];
    for (uint32_t x = 0; x < WIDTH; x++) {
      const int diff = abs((int)row[x] - (int)expected_luma(x, y));
      if (diff > TOLERANCE) luma_wrong++;
      if ((size_t)diff > worst) worst = (size_t)diff;
    }
  }
  for (uint32_t y = 0; y < HEIGHT / 2; y++) {
    const uint8_t *row = base + image.offsets[1] + (size_t)y * image.pitches[1];
    for (uint32_t x = 0; x < WIDTH / 2; x++) {
      uint8_t cb, cr;
      expected_chroma(x, y, &cb, &cr);
      const int dcb = abs((int)row[x * 2 + 0] - (int)cb);
      const int dcr = abs((int)row[x * 2 + 1] - (int)cr);
      if (dcb > TOLERANCE) chroma_wrong++;
      if (dcr > TOLERANCE) chroma_wrong++;
      if ((size_t)dcb > worst) worst = (size_t)dcb;
      if ((size_t)dcr > worst) worst = (size_t)dcr;
    }
  }

  printf("\nluma   : %zu outside +/-%d of %d\n", luma_wrong, TOLERANCE, WIDTH * HEIGHT);
  printf("chroma : %zu outside +/-%d of %d\n", chroma_wrong, TOLERANCE, WIDTH * HEIGHT / 2);
  printf("worst single-sample difference: %zu\n", worst);
  vaUnmapBuffer(dpy, image.buf);

  const int ok = luma_wrong == 0 && chroma_wrong == 0;
  printf("\nVERDICT: %s\n",
         ok ? "a compute shader writes BT.709 NV12 straight into the encode surface"
            : "the shader's output does not match the reference conversion");
  return ok ? 0 : 1;
}
