// M2 spike, part 4: the worker side of the Dolphin patch.
//
// Listens on a unix socket, takes the dma-buf descriptor Dolphin sends when it
// creates its export image, imports it into our own Vulkan device, and — after
// a few frames have been announced — copies it out so the pixels can be
// compared against what Dolphin actually rendered.
//
// This is what turns "it compiles" into "it works". Those are unrelated facts:
// every Vulkan call in the patch can succeed while the consumer reads an
// untouched buffer.
//
// Build: gcc receive_frame.c -o receive_frame $(pkg-config --cflags libdrm) -lvulkan
// Run:   sg render -c './receive_frame /tmp/nel3ab.sock /tmp/frame.raw 30'
//
// Then start patched Dolphin with NEL3AB_FRAME_SOCKET=/tmp/nel3ab.sock.

#include <inttypes.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>

#include <vulkan/vulkan.h>

#define HEADER_MAGIC 0x3341424eu  // 'N3AB'
#define FRAME_MAGIC 0x454d5246u   // 'FRME'

#pragma pack(push, 1)
struct Header
{
  uint32_t magic, version, width, height, drm_format, reserved;
  uint64_t modifier, offset, pitch, size;
};
struct FrameReady
{
  uint32_t magic, reserved;
  uint64_t frame_number;
};
#pragma pack(pop)

#define CHECK(expr, what)                                                                \
  do {                                                                                   \
    VkResult _r = (expr);                                                                \
    if (_r != VK_SUCCESS) {                                                              \
      fprintf(stderr, "FAIL: %s -> VkResult %d\n", what, _r);                            \
      return 1;                                                                          \
    }                                                                                    \
  } while (0)

static uint32_t pick_memory_type(VkPhysicalDevice phys, uint32_t candidates,
                                 VkMemoryPropertyFlags required)
{
  VkPhysicalDeviceMemoryProperties props;
  vkGetPhysicalDeviceMemoryProperties(phys, &props);
  for (uint32_t i = 0; i < props.memoryTypeCount; i++)
  {
    if (!(candidates & (1u << i))) continue;
    if ((props.memoryTypes[i].propertyFlags & required) == required) return i;
  }
  return UINT32_MAX;
}

// Receives the descriptor and the file descriptor that goes with it.
static int accept_descriptor(const char* path, struct Header* header, int* dmabuf)
{
  unlink(path);
  const int listener = socket(AF_UNIX, SOCK_STREAM, 0);
  struct sockaddr_un address = {0};
  address.sun_family = AF_UNIX;
  strncpy(address.sun_path, path, sizeof(address.sun_path) - 1);
  if (bind(listener, (struct sockaddr*)&address, sizeof(address)) != 0)
  {
    perror("bind");
    return -1;
  }
  listen(listener, 1);
  printf("listening on %s — start Dolphin now\n", path);
  fflush(stdout);

  const int peer = accept(listener, NULL, NULL);
  close(listener);
  if (peer < 0) return -1;
  printf("Dolphin connected\n");
  fflush(stdout);

  struct iovec iov = {.iov_base = header, .iov_len = sizeof(*header)};
  char control[CMSG_SPACE(sizeof(int))];
  struct msghdr msg = {
      .msg_iov = &iov, .msg_iovlen = 1, .msg_control = control, .msg_controllen = sizeof(control)};

  const ssize_t got = recvmsg(peer, &msg, 0);
  if (got != (ssize_t)sizeof(*header) || header->magic != HEADER_MAGIC)
  {
    fprintf(stderr, "FAIL: bad descriptor (%zd bytes, magic %#x)\n", got, header->magic);
    return -1;
  }
  struct cmsghdr* cmsg = CMSG_FIRSTHDR(&msg);
  if (!cmsg || cmsg->cmsg_type != SCM_RIGHTS)
  {
    fprintf(stderr, "FAIL: no file descriptor came with the descriptor\n");
    return -1;
  }
  memcpy(dmabuf, CMSG_DATA(cmsg), sizeof(int));
  return peer;
}

int main(int argc, char** argv)
{
  if (argc < 4)
  {
    fprintf(stderr, "usage: %s <socket> <output.raw> <frames-to-wait>\n", argv[0]);
    return 2;
  }
  const char* socket_path = argv[1];
  const char* output_path = argv[2];
  const int wait_frames = atoi(argv[3]);

  struct Header header = {0};
  int dmabuf = -1;
  const int peer = accept_descriptor(socket_path, &header, &dmabuf);
  if (peer < 0) return 1;

  printf("descriptor: %ux%u  modifier %#018" PRIx64 "  offset %" PRIu64 "  pitch %" PRIu64
         "  size %" PRIu64 "  fd=%d\n",
         header.width, header.height, header.modifier, header.offset, header.pitch, header.size,
         dmabuf);

  // Let the emulator get past the first frames, so what we read is a settled
  // picture rather than whatever was on screen at connect time.
  struct FrameReady ready;
  int seen = 0;
  while (seen < wait_frames && read(peer, &ready, sizeof(ready)) == (ssize_t)sizeof(ready))
  {
    if (ready.magic == FRAME_MAGIC) seen++;
  }
  printf("saw %d frame notifications (last #%" PRIu64 ")\n", seen, ready.frame_number);
  if (seen == 0)
  {
    fprintf(stderr, "FAIL: Dolphin never announced a frame\n");
    return 1;
  }

  // ── import ──
  VkApplicationInfo app = {.sType = VK_STRUCTURE_TYPE_APPLICATION_INFO,
                           .apiVersion = VK_API_VERSION_1_1};
  VkInstanceCreateInfo ici = {.sType = VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO,
                              .pApplicationInfo = &app};
  VkInstance instance;
  CHECK(vkCreateInstance(&ici, NULL, &instance), "vkCreateInstance");

  uint32_t n = 0;
  vkEnumeratePhysicalDevices(instance, &n, NULL);
  VkPhysicalDevice* all = calloc(n, sizeof(*all));
  vkEnumeratePhysicalDevices(instance, &n, all);
  VkPhysicalDevice phys = VK_NULL_HANDLE;
  for (uint32_t i = 0; i < n; i++)
  {
    VkPhysicalDeviceProperties p;
    vkGetPhysicalDeviceProperties(all[i], &p);
    if (p.deviceType == VK_PHYSICAL_DEVICE_TYPE_DISCRETE_GPU) { phys = all[i]; break; }
  }
  if (!phys) { fprintf(stderr, "no discrete GPU\n"); return 1; }

  const char* exts[] = {"VK_KHR_external_memory_fd", "VK_EXT_external_memory_dma_buf",
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
  VkDevice device;
  CHECK(vkCreateDevice(phys, &dci, NULL, &device), "vkCreateDevice");
  PFN_vkGetMemoryFdPropertiesKHR get_fd_props =
      (PFN_vkGetMemoryFdPropertiesKHR)vkGetDeviceProcAddr(device, "vkGetMemoryFdPropertiesKHR");

  VkSubresourceLayout plane = {.offset = header.offset, .rowPitch = header.pitch};
  VkImageDrmFormatModifierExplicitCreateInfoEXT explicit_mod = {
      .sType = VK_STRUCTURE_TYPE_IMAGE_DRM_FORMAT_MODIFIER_EXPLICIT_CREATE_INFO_EXT,
      .drmFormatModifier = header.modifier,
      .drmFormatModifierPlaneCount = 1,
      .pPlaneLayouts = &plane};
  VkExternalMemoryImageCreateInfo ext = {
      .sType = VK_STRUCTURE_TYPE_EXTERNAL_MEMORY_IMAGE_CREATE_INFO,
      .pNext = &explicit_mod,
      .handleTypes = VK_EXTERNAL_MEMORY_HANDLE_TYPE_DMA_BUF_BIT_EXT};
  VkImageCreateInfo ici2 = {.sType = VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO,
                            .pNext = &ext,
                            .imageType = VK_IMAGE_TYPE_2D,
                            .format = VK_FORMAT_R8G8B8A8_UNORM,
                            .extent = {header.width, header.height, 1},
                            .mipLevels = 1,
                            .arrayLayers = 1,
                            .samples = VK_SAMPLE_COUNT_1_BIT,
                            .tiling = VK_IMAGE_TILING_DRM_FORMAT_MODIFIER_EXT,
                            .usage = VK_IMAGE_USAGE_TRANSFER_SRC_BIT | VK_IMAGE_USAGE_SAMPLED_BIT,
                            .sharingMode = VK_SHARING_MODE_EXCLUSIVE,
                            .initialLayout = VK_IMAGE_LAYOUT_PREINITIALIZED};
  VkImage image;
  CHECK(vkCreateImage(device, &ici2, NULL, &image), "vkCreateImage(import)");

  VkMemoryFdPropertiesKHR fd_props = {.sType = VK_STRUCTURE_TYPE_MEMORY_FD_PROPERTIES_KHR};
  CHECK(get_fd_props(device, VK_EXTERNAL_MEMORY_HANDLE_TYPE_DMA_BUF_BIT_EXT, dmabuf, &fd_props),
        "vkGetMemoryFdPropertiesKHR");
  VkMemoryRequirements req;
  vkGetImageMemoryRequirements(device, image, &req);
  VkImportMemoryFdInfoKHR import = {.sType = VK_STRUCTURE_TYPE_IMPORT_MEMORY_FD_INFO_KHR,
                                    .handleType =
                                        VK_EXTERNAL_MEMORY_HANDLE_TYPE_DMA_BUF_BIT_EXT,
                                    .fd = dup(dmabuf)};
  VkMemoryDedicatedAllocateInfo dedicated = {
      .sType = VK_STRUCTURE_TYPE_MEMORY_DEDICATED_ALLOCATE_INFO,
      .pNext = &import,
      .image = image};
  VkMemoryAllocateInfo mai = {
      .sType = VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO,
      .pNext = &dedicated,
      .allocationSize = req.size,
      .memoryTypeIndex = pick_memory_type(phys, req.memoryTypeBits & fd_props.memoryTypeBits, 0)};
  VkDeviceMemory memory;
  CHECK(vkAllocateMemory(device, &mai, NULL, &memory), "vkAllocateMemory(import)");
  CHECK(vkBindImageMemory(device, image, memory, 0), "vkBindImageMemory");
  printf("imported and bound\n");

  // ── copy out ──
  const VkDeviceSize bytes = (VkDeviceSize)header.width * header.height * 4;
  VkBufferCreateInfo bci = {.sType = VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO,
                            .size = bytes,
                            .usage = VK_BUFFER_USAGE_TRANSFER_DST_BIT};
  VkBuffer buffer;
  CHECK(vkCreateBuffer(device, &bci, NULL, &buffer), "vkCreateBuffer");
  VkMemoryRequirements breq;
  vkGetBufferMemoryRequirements(device, buffer, &breq);
  VkMemoryAllocateInfo bmai = {
      .sType = VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO,
      .allocationSize = breq.size,
      .memoryTypeIndex = pick_memory_type(phys, breq.memoryTypeBits,
                                          VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT |
                                              VK_MEMORY_PROPERTY_HOST_COHERENT_BIT)};
  VkDeviceMemory bmem;
  CHECK(vkAllocateMemory(device, &bmai, NULL, &bmem), "vkAllocateMemory(readback)");
  CHECK(vkBindBufferMemory(device, buffer, bmem, 0), "vkBindBufferMemory");

  VkCommandPoolCreateInfo pci = {.sType = VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO,
                                 .queueFamilyIndex = 0};
  VkCommandPool pool;
  CHECK(vkCreateCommandPool(device, &pci, NULL, &pool), "vkCreateCommandPool");
  VkCommandBufferAllocateInfo cai = {.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO,
                                     .commandPool = pool,
                                     .level = VK_COMMAND_BUFFER_LEVEL_PRIMARY,
                                     .commandBufferCount = 1};
  VkCommandBuffer cmd;
  CHECK(vkAllocateCommandBuffers(device, &cai, &cmd), "vkAllocateCommandBuffers");
  VkCommandBufferBeginInfo cbi = {.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO,
                                  .flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT};
  CHECK(vkBeginCommandBuffer(cmd, &cbi), "vkBeginCommandBuffer");

  // Acquire from FOREIGN with the layout Dolphin released it in. Anything else
  // and the contents are formally undefined on this side.
  VkImageMemoryBarrier acquire = {
      .sType = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER,
      .dstAccessMask = VK_ACCESS_TRANSFER_READ_BIT,
      .oldLayout = VK_IMAGE_LAYOUT_GENERAL,
      .newLayout = VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL,
      .srcQueueFamilyIndex = VK_QUEUE_FAMILY_FOREIGN_EXT,
      .dstQueueFamilyIndex = 0,
      .image = image,
      .subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1}};
  vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT, VK_PIPELINE_STAGE_TRANSFER_BIT, 0,
                       0, NULL, 0, NULL, 1, &acquire);
  VkBufferImageCopy region = {.imageSubresource = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 0, 1},
                              .imageExtent = {header.width, header.height, 1}};
  vkCmdCopyImageToBuffer(cmd, image, VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL, buffer, 1, &region);
  CHECK(vkEndCommandBuffer(cmd), "vkEndCommandBuffer");

  VkQueue queue;
  vkGetDeviceQueue(device, 0, 0, &queue);
  VkSubmitInfo si = {
      .sType = VK_STRUCTURE_TYPE_SUBMIT_INFO, .commandBufferCount = 1, .pCommandBuffers = &cmd};
  CHECK(vkQueueSubmit(queue, 1, &si, VK_NULL_HANDLE), "vkQueueSubmit");
  CHECK(vkQueueWaitIdle(queue), "vkQueueWaitIdle");

  uint8_t* pixels = NULL;
  CHECK(vkMapMemory(device, bmem, 0, bytes, 0, (void**)&pixels), "vkMapMemory");

  // A frame nobody wrote reads as a single flat value. Saying so here means the
  // difference between "we imported a buffer" and "we imported a PICTURE".
  size_t distinct = 0;
  uint32_t first = ((uint32_t*)pixels)[0];
  for (size_t i = 0; i < (size_t)header.width * header.height; i++)
  {
    if (((uint32_t*)pixels)[i] != first) { distinct = 1; break; }
  }
  printf("first pixel RGBA: %u %u %u %u\n", pixels[0], pixels[1], pixels[2], pixels[3]);
  printf("frame is %s\n", distinct ? "NOT uniform — it carries an image" : "UNIFORM — suspicious");

  FILE* out = fopen(output_path, "wb");
  fwrite(pixels, 1, bytes, out);
  fclose(out);
  printf("wrote %s (%ux%u RGBA)\n", output_path, header.width, header.height);
  vkUnmapMemory(device, bmem);
  return distinct ? 0 : 1;
}
