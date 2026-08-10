// M2 spike, part 3: the sequence the Dolphin patch will perform.
//
// Parts 1 and 2 settled the DESTINATION: a VAAPI encode surface imports into
// Vulkan and a shader can write its planes. This settles the SOURCE — the half
// that has to live inside Dolphin.
//
// It is written and run here, standalone, on purpose. Every iteration inside
// Dolphin costs a ~25-minute image rebuild; here it costs three seconds. This is
// the same discipline that made M1 work: get the logic right where it is cheap
// to be wrong, then move it.
//
// What it proves, end to end:
//   device A  creates an RGBA8 image with a DRM format modifier + exportable
//             memory, clears it to a known colour, exports a dma-buf fd
//   device B  imports that fd as an image with the SAME modifier and plane
//             layout, copies it to a host buffer, and checks the pixels
//
// Two separate VkDevices from one physical device, which is a faithful stand-in
// for two processes sharing the GPU — Dolphin and the worker.
//
// Build: gcc vk_export.c -o vk_export $(pkg-config --cflags libdrm) -lvulkan
// Run:   sg render -c ./vk_export

#include <inttypes.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include <drm_fourcc.h>
#include <vulkan/vulkan.h>

#define WIDTH 640
#define HEIGHT 528
#define FORMAT VK_FORMAT_R8G8B8A8_UNORM

// A colour no uninitialised buffer would plausibly contain.
static const float CLEAR_R = 0.20f, CLEAR_G = 0.60f, CLEAR_B = 0.90f, CLEAR_A = 1.0f;
static const uint8_t EXPECT[4] = {51, 153, 229, 255};  // the above, 8-bit UNORM

#define CHECK(expr, what)                                                                \
  do {                                                                                   \
    VkResult _r = (expr);                                                                \
    if (_r != VK_SUCCESS) {                                                              \
      fprintf(stderr, "FAIL: %s -> VkResult %d\n", what, _r);                            \
      return 1;                                                                          \
    }                                                                                    \
  } while (0)

static PFN_vkGetImageDrmFormatModifierPropertiesEXT p_get_modifier_props;
static PFN_vkGetMemoryFdKHR p_get_memory_fd;
static PFN_vkGetMemoryFdPropertiesKHR p_get_memory_fd_props;

static uint32_t pick_memory_type(VkPhysicalDevice phys, uint32_t candidates,
                                 VkMemoryPropertyFlags required) {
  VkPhysicalDeviceMemoryProperties props;
  vkGetPhysicalDeviceMemoryProperties(phys, &props);
  for (uint32_t i = 0; i < props.memoryTypeCount; i++) {
    if (!(candidates & (1u << i))) continue;
    if ((props.memoryTypes[i].propertyFlags & required) == required) return i;
  }
  return UINT32_MAX;
}

static VkDevice make_device(VkPhysicalDevice phys, uint32_t queue_family) {
  const char *exts[] = {"VK_KHR_external_memory_fd", "VK_EXT_external_memory_dma_buf",
                        "VK_EXT_image_drm_format_modifier", "VK_KHR_image_format_list",
                        "VK_EXT_queue_family_foreign"};
  float prio = 1.0f;
  VkDeviceQueueCreateInfo q = {.sType = VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO,
                               .queueFamilyIndex = queue_family,
                               .queueCount = 1,
                               .pQueuePriorities = &prio};
  VkDeviceCreateInfo ci = {.sType = VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO,
                           .queueCreateInfoCount = 1,
                           .pQueueCreateInfos = &q,
                           .enabledExtensionCount = sizeof(exts) / sizeof(*exts),
                           .ppEnabledExtensionNames = exts};
  VkDevice dev = VK_NULL_HANDLE;
  if (vkCreateDevice(phys, &ci, NULL, &dev) != VK_SUCCESS) return VK_NULL_HANDLE;
  return dev;
}

// Runs one command buffer to completion. The spike does not need pipelining, and
// a synchronous submit keeps the proof about MEMORY rather than about fences.
static int run_commands(VkDevice dev, uint32_t family, void (*record)(VkCommandBuffer, void *),
                        void *ctx) {
  VkCommandPoolCreateInfo pci = {.sType = VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO,
                                 .queueFamilyIndex = family};
  VkCommandPool pool;
  CHECK(vkCreateCommandPool(dev, &pci, NULL, &pool), "vkCreateCommandPool");

  VkCommandBufferAllocateInfo ai = {.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO,
                                    .commandPool = pool,
                                    .level = VK_COMMAND_BUFFER_LEVEL_PRIMARY,
                                    .commandBufferCount = 1};
  VkCommandBuffer cmd;
  CHECK(vkAllocateCommandBuffers(dev, &ai, &cmd), "vkAllocateCommandBuffers");

  VkCommandBufferBeginInfo bi = {.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO,
                                 .flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT};
  CHECK(vkBeginCommandBuffer(cmd, &bi), "vkBeginCommandBuffer");
  record(cmd, ctx);
  CHECK(vkEndCommandBuffer(cmd), "vkEndCommandBuffer");

  VkQueue queue;
  vkGetDeviceQueue(dev, family, 0, &queue);
  VkSubmitInfo si = {.sType = VK_STRUCTURE_TYPE_SUBMIT_INFO,
                     .commandBufferCount = 1,
                     .pCommandBuffers = &cmd};
  CHECK(vkQueueSubmit(queue, 1, &si, VK_NULL_HANDLE), "vkQueueSubmit");
  CHECK(vkQueueWaitIdle(queue), "vkQueueWaitIdle");
  vkDestroyCommandPool(dev, pool, NULL);
  return 0;
}

struct clear_ctx { VkImage image; };

static void record_clear(VkCommandBuffer cmd, void *p) {
  struct clear_ctx *c = p;
  VkImageMemoryBarrier to_dst = {
      .sType = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER,
      .srcAccessMask = 0,
      .dstAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT,
      .oldLayout = VK_IMAGE_LAYOUT_UNDEFINED,
      .newLayout = VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL,
      .srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED,
      .dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED,
      .image = c->image,
      .subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1}};
  vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT, VK_PIPELINE_STAGE_TRANSFER_BIT, 0,
                       0, NULL, 0, NULL, 1, &to_dst);

  VkClearColorValue colour = {.float32 = {CLEAR_R, CLEAR_G, CLEAR_B, CLEAR_A}};
  VkImageSubresourceRange range = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};
  vkCmdClearColorImage(cmd, c->image, VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL, &colour, 1, &range);

  // Release to FOREIGN: the consumer is another device, and without an explicit
  // ownership transfer the contents are formally undefined on the other side.
  VkImageMemoryBarrier release = {
      .sType = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER,
      .srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT,
      .dstAccessMask = 0,
      .oldLayout = VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL,
      .newLayout = VK_IMAGE_LAYOUT_GENERAL,
      .srcQueueFamilyIndex = 0,
      .dstQueueFamilyIndex = VK_QUEUE_FAMILY_FOREIGN_EXT,
      .image = c->image,
      .subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1}};
  vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_TRANSFER_BIT, VK_PIPELINE_STAGE_BOTTOM_OF_PIPE_BIT,
                       0, 0, NULL, 0, NULL, 1, &release);
}

struct copy_ctx { VkImage image; VkBuffer buffer; };

static void record_copy_to_buffer(VkCommandBuffer cmd, void *p) {
  struct copy_ctx *c = p;
  // Acquire from FOREIGN, preserving contents: oldLayout must match what the
  // producer left, and GENERAL is what it released.
  VkImageMemoryBarrier acquire = {
      .sType = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER,
      .srcAccessMask = 0,
      .dstAccessMask = VK_ACCESS_TRANSFER_READ_BIT,
      .oldLayout = VK_IMAGE_LAYOUT_GENERAL,
      .newLayout = VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL,
      .srcQueueFamilyIndex = VK_QUEUE_FAMILY_FOREIGN_EXT,
      .dstQueueFamilyIndex = 0,
      .image = c->image,
      .subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1}};
  vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT, VK_PIPELINE_STAGE_TRANSFER_BIT, 0,
                       0, NULL, 0, NULL, 1, &acquire);

  VkBufferImageCopy region = {.imageSubresource = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 0, 1},
                              .imageExtent = {WIDTH, HEIGHT, 1}};
  vkCmdCopyImageToBuffer(cmd, c->image, VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL, c->buffer, 1,
                         &region);
}

int main(void) {
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
  VkPhysicalDevice phys = VK_NULL_HANDLE;
  for (uint32_t i = 0; i < n; i++) {
    VkPhysicalDeviceProperties p;
    vkGetPhysicalDeviceProperties(all[i], &p);
    if (p.deviceType == VK_PHYSICAL_DEVICE_TYPE_DISCRETE_GPU) {
      phys = all[i];
      printf("device: %s\n\n", p.deviceName);
      break;
    }
  }
  if (!phys) { fprintf(stderr, "no discrete GPU\n"); return 1; }

  // ── which modifiers can hold an RGBA8 colour attachment we can also copy? ──
  VkDrmFormatModifierPropertiesListEXT list = {
      .sType = VK_STRUCTURE_TYPE_DRM_FORMAT_MODIFIER_PROPERTIES_LIST_EXT};
  VkFormatProperties2 fp = {.sType = VK_STRUCTURE_TYPE_FORMAT_PROPERTIES_2, .pNext = &list};
  vkGetPhysicalDeviceFormatProperties2(phys, FORMAT, &fp);
  VkDrmFormatModifierPropertiesEXT *mods = calloc(list.drmFormatModifierCount, sizeof(*mods));
  list.pDrmFormatModifierProperties = mods;
  vkGetPhysicalDeviceFormatProperties2(phys, FORMAT, &fp);

  uint64_t *usable = calloc(list.drmFormatModifierCount, sizeof(uint64_t));
  uint32_t usable_count = 0;
  const VkFormatFeatureFlags need =
      VK_FORMAT_FEATURE_COLOR_ATTACHMENT_BIT | VK_FORMAT_FEATURE_TRANSFER_SRC_BIT |
      VK_FORMAT_FEATURE_TRANSFER_DST_BIT;
  printf("== modifiers RADV offers for RGBA8 ==\n");
  for (uint32_t i = 0; i < list.drmFormatModifierCount; i++) {
    const int ok = (mods[i].drmFormatModifierTilingFeatures & need) == need &&
                   mods[i].drmFormatModifierPlaneCount == 1;
    printf("  0x%016" PRIx64 "  planes=%u  %s\n", mods[i].drmFormatModifier,
           mods[i].drmFormatModifierPlaneCount, ok ? "usable" : "-");
    if (ok) usable[usable_count++] = mods[i].drmFormatModifier;
  }
  if (!usable_count) { fprintf(stderr, "\nno usable modifier\n"); return 1; }

  uint32_t family = 0;  // family 0 is graphics+compute on RADV
  VkDevice dev_a = make_device(phys, family);
  VkDevice dev_b = make_device(phys, family);
  if (!dev_a || !dev_b) { fprintf(stderr, "vkCreateDevice failed\n"); return 1; }
  p_get_modifier_props = (PFN_vkGetImageDrmFormatModifierPropertiesEXT)vkGetDeviceProcAddr(
      dev_a, "vkGetImageDrmFormatModifierPropertiesEXT");
  p_get_memory_fd = (PFN_vkGetMemoryFdKHR)vkGetDeviceProcAddr(dev_a, "vkGetMemoryFdKHR");
  p_get_memory_fd_props =
      (PFN_vkGetMemoryFdPropertiesKHR)vkGetDeviceProcAddr(dev_b, "vkGetMemoryFdPropertiesKHR");

  // ── DEVICE A: this is what the Dolphin patch has to do ──
  printf("\n== device A: create exportable image, clear it, export the fd ==\n");
  VkImageDrmFormatModifierListCreateInfoEXT mod_list = {
      .sType = VK_STRUCTURE_TYPE_IMAGE_DRM_FORMAT_MODIFIER_LIST_CREATE_INFO_EXT,
      .drmFormatModifierCount = usable_count,
      .pDrmFormatModifiers = usable};
  VkExternalMemoryImageCreateInfo ext_img = {
      .sType = VK_STRUCTURE_TYPE_EXTERNAL_MEMORY_IMAGE_CREATE_INFO,
      .pNext = &mod_list,
      .handleTypes = VK_EXTERNAL_MEMORY_HANDLE_TYPE_DMA_BUF_BIT_EXT};
  VkImageCreateInfo img_ci = {.sType = VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO,
                              .pNext = &ext_img,
                              .imageType = VK_IMAGE_TYPE_2D,
                              .format = FORMAT,
                              .extent = {WIDTH, HEIGHT, 1},
                              .mipLevels = 1,
                              .arrayLayers = 1,
                              .samples = VK_SAMPLE_COUNT_1_BIT,
                              .tiling = VK_IMAGE_TILING_DRM_FORMAT_MODIFIER_EXT,
                              .usage = VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT |
                                       VK_IMAGE_USAGE_TRANSFER_SRC_BIT |
                                       VK_IMAGE_USAGE_TRANSFER_DST_BIT,
                              .sharingMode = VK_SHARING_MODE_EXCLUSIVE,
                              .initialLayout = VK_IMAGE_LAYOUT_UNDEFINED};
  VkImage image_a;
  CHECK(vkCreateImage(dev_a, &img_ci, NULL, &image_a), "vkCreateImage(A)");

  VkMemoryRequirements req;
  vkGetImageMemoryRequirements(dev_a, image_a, &req);
  // Dolphin allocates every other texture through VMA; this one is allocated by
  // hand precisely so the export info can be attached without touching VMA's
  // pools, which keeps the fork small.
  VkExportMemoryAllocateInfo export_info = {
      .sType = VK_STRUCTURE_TYPE_EXPORT_MEMORY_ALLOCATE_INFO,
      .handleTypes = VK_EXTERNAL_MEMORY_HANDLE_TYPE_DMA_BUF_BIT_EXT};
  VkMemoryDedicatedAllocateInfo dedicated = {
      .sType = VK_STRUCTURE_TYPE_MEMORY_DEDICATED_ALLOCATE_INFO,
      .pNext = &export_info,
      .image = image_a};
  VkMemoryAllocateInfo mai = {
      .sType = VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO,
      .pNext = &dedicated,
      .allocationSize = req.size,
      .memoryTypeIndex =
          pick_memory_type(phys, req.memoryTypeBits, VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT)};
  VkDeviceMemory mem_a;
  CHECK(vkAllocateMemory(dev_a, &mai, NULL, &mem_a), "vkAllocateMemory(A, exportable)");
  CHECK(vkBindImageMemory(dev_a, image_a, mem_a, 0), "vkBindImageMemory(A)");

  VkImageDrmFormatModifierPropertiesEXT chosen = {
      .sType = VK_STRUCTURE_TYPE_IMAGE_DRM_FORMAT_MODIFIER_PROPERTIES_EXT};
  CHECK(p_get_modifier_props(dev_a, image_a, &chosen), "vkGetImageDrmFormatModifierProperties");
  VkImageSubresource sub = {.aspectMask = VK_IMAGE_ASPECT_MEMORY_PLANE_0_BIT_EXT};
  VkSubresourceLayout layout;
  vkGetImageSubresourceLayout(dev_a, image_a, &sub, &layout);
  printf("  chosen modifier 0x%016" PRIx64 "\n", chosen.drmFormatModifier);
  printf("  offset %" PRIu64 "  rowPitch %" PRIu64 "  size %" PRIu64 "\n", layout.offset,
         layout.rowPitch, (uint64_t)req.size);

  struct clear_ctx cc = {.image = image_a};
  if (run_commands(dev_a, family, record_clear, &cc)) return 1;
  printf("  cleared to (%.2f %.2f %.2f)\n", CLEAR_R, CLEAR_G, CLEAR_B);

  VkMemoryGetFdInfoKHR fd_info = {.sType = VK_STRUCTURE_TYPE_MEMORY_GET_FD_INFO_KHR,
                                  .memory = mem_a,
                                  .handleType =
                                      VK_EXTERNAL_MEMORY_HANDLE_TYPE_DMA_BUF_BIT_EXT};
  int fd = -1;
  CHECK(p_get_memory_fd(dev_a, &fd_info, &fd), "vkGetMemoryFdKHR");
  printf("  exported dma-buf fd=%d\n", fd);

  // ── DEVICE B: this is what the worker has to do ──
  printf("\n== device B: import the fd and read the pixels back ==\n");
  VkSubresourceLayout plane = {.offset = layout.offset, .rowPitch = layout.rowPitch};
  VkImageDrmFormatModifierExplicitCreateInfoEXT explicit_mod = {
      .sType = VK_STRUCTURE_TYPE_IMAGE_DRM_FORMAT_MODIFIER_EXPLICIT_CREATE_INFO_EXT,
      .drmFormatModifier = chosen.drmFormatModifier,
      .drmFormatModifierPlaneCount = 1,
      .pPlaneLayouts = &plane};
  VkExternalMemoryImageCreateInfo ext_img_b = {
      .sType = VK_STRUCTURE_TYPE_EXTERNAL_MEMORY_IMAGE_CREATE_INFO,
      .pNext = &explicit_mod,
      .handleTypes = VK_EXTERNAL_MEMORY_HANDLE_TYPE_DMA_BUF_BIT_EXT};
  VkImageCreateInfo img_b = img_ci;
  img_b.pNext = &ext_img_b;
  img_b.initialLayout = VK_IMAGE_LAYOUT_PREINITIALIZED;
  VkImage image_b;
  CHECK(vkCreateImage(dev_b, &img_b, NULL, &image_b), "vkCreateImage(B, import)");

  VkMemoryFdPropertiesKHR fd_props = {.sType = VK_STRUCTURE_TYPE_MEMORY_FD_PROPERTIES_KHR};
  CHECK(p_get_memory_fd_props(dev_b, VK_EXTERNAL_MEMORY_HANDLE_TYPE_DMA_BUF_BIT_EXT, fd,
                              &fd_props),
        "vkGetMemoryFdPropertiesKHR");
  VkMemoryRequirements req_b;
  vkGetImageMemoryRequirements(dev_b, image_b, &req_b);
  VkImportMemoryFdInfoKHR import_info = {
      .sType = VK_STRUCTURE_TYPE_IMPORT_MEMORY_FD_INFO_KHR,
      .handleType = VK_EXTERNAL_MEMORY_HANDLE_TYPE_DMA_BUF_BIT_EXT,
      .fd = fd};
  VkMemoryDedicatedAllocateInfo dedicated_b = {
      .sType = VK_STRUCTURE_TYPE_MEMORY_DEDICATED_ALLOCATE_INFO,
      .pNext = &import_info,
      .image = image_b};
  VkMemoryAllocateInfo mai_b = {
      .sType = VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO,
      .pNext = &dedicated_b,
      .allocationSize = req_b.size,
      .memoryTypeIndex = pick_memory_type(phys, req_b.memoryTypeBits & fd_props.memoryTypeBits, 0)};
  VkDeviceMemory mem_b;
  CHECK(vkAllocateMemory(dev_b, &mai_b, NULL, &mem_b), "vkAllocateMemory(B, import)");
  CHECK(vkBindImageMemory(dev_b, image_b, mem_b, 0), "vkBindImageMemory(B)");
  printf("  imported and bound\n");

  const VkDeviceSize bytes = (VkDeviceSize)WIDTH * HEIGHT * 4;
  VkBufferCreateInfo bci = {.sType = VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO,
                            .size = bytes,
                            .usage = VK_BUFFER_USAGE_TRANSFER_DST_BIT,
                            .sharingMode = VK_SHARING_MODE_EXCLUSIVE};
  VkBuffer buffer;
  CHECK(vkCreateBuffer(dev_b, &bci, NULL, &buffer), "vkCreateBuffer");
  VkMemoryRequirements breq;
  vkGetBufferMemoryRequirements(dev_b, buffer, &breq);
  VkMemoryAllocateInfo bmai = {
      .sType = VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO,
      .allocationSize = breq.size,
      .memoryTypeIndex = pick_memory_type(phys, breq.memoryTypeBits,
                                          VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT |
                                              VK_MEMORY_PROPERTY_HOST_COHERENT_BIT)};
  VkDeviceMemory bmem;
  CHECK(vkAllocateMemory(dev_b, &bmai, NULL, &bmem), "vkAllocateMemory(readback)");
  CHECK(vkBindBufferMemory(dev_b, buffer, bmem, 0), "vkBindBufferMemory");

  struct copy_ctx cp = {.image = image_b, .buffer = buffer};
  if (run_commands(dev_b, family, record_copy_to_buffer, &cp)) return 1;

  uint8_t *pixels = NULL;
  CHECK(vkMapMemory(dev_b, bmem, 0, bytes, 0, (void **)&pixels), "vkMapMemory");

  // Check every pixel, not a sample: a tiling mismatch corrupts SOME of the
  // image, and a spot check on the first pixel would happily miss it.
  size_t wrong = 0;
  for (size_t i = 0; i < (size_t)WIDTH * HEIGHT; i++) {
    const uint8_t *p = pixels + i * 4;
    for (int c = 0; c < 4; c++) {
      // ±1 for UNORM rounding, nothing more.
      if (p[c] < EXPECT[c] - 1 || p[c] > EXPECT[c] + 1) { wrong++; break; }
    }
  }
  printf("  first pixel   : %u %u %u %u (expected %u %u %u %u)\n", pixels[0], pixels[1],
         pixels[2], pixels[3], EXPECT[0], EXPECT[1], EXPECT[2], EXPECT[3]);
  printf("  wrong pixels  : %zu of %d\n", wrong, WIDTH * HEIGHT);
  vkUnmapMemory(dev_b, bmem);

  printf("\nVERDICT: %s\n",
         wrong == 0
             ? "device B read back exactly what device A drew — the export "
               "sequence is correct and can be moved into Dolphin"
             : "PIXELS DIFFER — the layout agreed on paper but not in memory");
  close(fd);
  return wrong == 0 ? 0 : 1;
}
