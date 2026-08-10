// M2 spike, part 4: the worker side of the Dolphin patch, protocol v2.
//
// Takes the ring of dma-buf descriptors Dolphin sends, imports every slot, and
// then runs the test that matters: hold a slot for half a second and check its
// contents do not change underneath us.
//
// That check is the whole point. Before the ring existed, Dolphin reused one
// image every frame and would happily overwrite the picture a consumer was still
// reading. Everything looked fine while it did — no error, no warning, just a
// torn frame now and then. So the assertion here is not "we received an image",
// it is "the image we were lent stayed ours".
//
// Build: gcc receive_frame.c -o receive_frame $(pkg-config --cflags libdrm) -lvulkan
// Run:   sg render -c './receive_frame /tmp/nel3ab.sock /tmp/frame.raw 300'

#include <inttypes.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#include <poll.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>

#include <vulkan/vulkan.h>

#define HEADER_MAGIC 0x3341424eu
#define FRAME_MAGIC 0x454d5246u
#define RELEASE_MAGIC 0x4c455246u
#define MAX_SLOTS 8

// Long enough that Dolphin renders ~30 frames while we hold the slot.
#define HOLD_MS 500

#pragma pack(push, 1)
struct Header
{
  uint32_t magic, version, slot, slot_count;
  uint32_t width, height, drm_format, reserved;
  uint64_t modifier, offset, pitch, size;
};
struct FrameReady
{
  uint32_t magic, slot;
  uint64_t frame_number;
};
struct Release
{
  uint32_t magic, slot;
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

static VkDevice g_device;
static VkPhysicalDevice g_phys;
static VkQueue g_queue;
static VkCommandPool g_pool;
static VkImage g_images[MAX_SLOTS];
static VkBuffer g_buffer;
static VkDeviceMemory g_buffer_memory;
static VkDeviceSize g_bytes;

static uint32_t pick_memory_type(uint32_t candidates, VkMemoryPropertyFlags required)
{
  VkPhysicalDeviceMemoryProperties props;
  vkGetPhysicalDeviceMemoryProperties(g_phys, &props);
  for (uint32_t i = 0; i < props.memoryTypeCount; i++)
  {
    if (!(candidates & (1u << i))) continue;
    if ((props.memoryTypes[i].propertyFlags & required) == required) return i;
  }
  return UINT32_MAX;
}

int main(int argc, char** argv)
{
  if (argc < 4)
  {
    fprintf(stderr, "usage: %s <socket> <output.raw> <frames-before-capture>\n", argv[0]);
    return 2;
  }
  const char* socket_path = argv[1];
  const char* output_path = argv[2];
  const int settle_frames = atoi(argv[3]);

  unlink(socket_path);
  const int listener = socket(AF_UNIX, SOCK_STREAM, 0);
  struct sockaddr_un address = {0};
  address.sun_family = AF_UNIX;
  strncpy(address.sun_path, socket_path, sizeof(address.sun_path) - 1);
  if (bind(listener, (struct sockaddr*)&address, sizeof(address)) != 0)
  {
    perror("bind");
    return 1;
  }
  listen(listener, 1);
  printf("listening on %s\n", socket_path);
  fflush(stdout);
  const int peer = accept(listener, NULL, NULL);
  close(listener);
  if (peer < 0) return 1;
  printf("Dolphin connected\n");
  fflush(stdout);

  // ── take the whole ring ──
  struct Header header = {0};
  int dmabufs[MAX_SLOTS];
  uint32_t slots_seen = 0, slot_count = 0;
  do
  {
    struct Header h;
    struct iovec iov = {.iov_base = &h, .iov_len = sizeof(h)};
    char control[CMSG_SPACE(sizeof(int))];
    struct msghdr msg = {.msg_iov = &iov,
                         .msg_iovlen = 1,
                         .msg_control = control,
                         .msg_controllen = sizeof(control)};
    if (recvmsg(peer, &msg, 0) != (ssize_t)sizeof(h) || h.magic != HEADER_MAGIC)
    {
      fprintf(stderr, "FAIL: bad descriptor\n");
      return 1;
    }
    struct cmsghdr* cmsg = CMSG_FIRSTHDR(&msg);
    if (!cmsg || cmsg->cmsg_type != SCM_RIGHTS)
    {
      fprintf(stderr, "FAIL: descriptor arrived without an fd\n");
      return 1;
    }
    memcpy(&dmabufs[h.slot], CMSG_DATA(cmsg), sizeof(int));
    header = h;
    slot_count = h.slot_count;
    slots_seen++;
  } while (slots_seen < slot_count && slot_count <= MAX_SLOTS);

  printf("ring: %u slots, %ux%u, modifier %#018" PRIx64 ", pitch %" PRIu64 "\n", slot_count,
         header.width, header.height, header.modifier, header.pitch);

  // ── Vulkan ──
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
  for (uint32_t i = 0; i < n; i++)
  {
    VkPhysicalDeviceProperties p;
    vkGetPhysicalDeviceProperties(all[i], &p);
    if (p.deviceType == VK_PHYSICAL_DEVICE_TYPE_DISCRETE_GPU) { g_phys = all[i]; break; }
  }
  if (!g_phys) { fprintf(stderr, "no discrete GPU\n"); return 1; }

  const char* exts[] = {"VK_KHR_external_memory_fd", "VK_EXT_external_memory_dma_buf",
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
  PFN_vkGetMemoryFdPropertiesKHR get_fd_props =
      (PFN_vkGetMemoryFdPropertiesKHR)vkGetDeviceProcAddr(g_device, "vkGetMemoryFdPropertiesKHR");

  for (uint32_t s = 0; s < slot_count; s++)
  {
    VkSubresourceLayout plane = {.offset = header.offset, .rowPitch = header.pitch};
    VkImageDrmFormatModifierExplicitCreateInfoEXT emod = {
        .sType = VK_STRUCTURE_TYPE_IMAGE_DRM_FORMAT_MODIFIER_EXPLICIT_CREATE_INFO_EXT,
        .drmFormatModifier = header.modifier,
        .drmFormatModifierPlaneCount = 1,
        .pPlaneLayouts = &plane};
    VkExternalMemoryImageCreateInfo ext = {
        .sType = VK_STRUCTURE_TYPE_EXTERNAL_MEMORY_IMAGE_CREATE_INFO,
        .pNext = &emod,
        .handleTypes = VK_EXTERNAL_MEMORY_HANDLE_TYPE_DMA_BUF_BIT_EXT};
    VkImageCreateInfo ii = {.sType = VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO,
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
    CHECK(vkCreateImage(g_device, &ii, NULL, &g_images[s]), "vkCreateImage(import)");

    VkMemoryFdPropertiesKHR fdp = {.sType = VK_STRUCTURE_TYPE_MEMORY_FD_PROPERTIES_KHR};
    CHECK(get_fd_props(g_device, VK_EXTERNAL_MEMORY_HANDLE_TYPE_DMA_BUF_BIT_EXT, dmabufs[s], &fdp),
          "vkGetMemoryFdPropertiesKHR");
    VkMemoryRequirements req;
    vkGetImageMemoryRequirements(g_device, g_images[s], &req);
    VkImportMemoryFdInfoKHR imp = {.sType = VK_STRUCTURE_TYPE_IMPORT_MEMORY_FD_INFO_KHR,
                                   .handleType =
                                       VK_EXTERNAL_MEMORY_HANDLE_TYPE_DMA_BUF_BIT_EXT,
                                   .fd = dup(dmabufs[s])};
    VkMemoryDedicatedAllocateInfo ded = {.sType =
                                             VK_STRUCTURE_TYPE_MEMORY_DEDICATED_ALLOCATE_INFO,
                                         .pNext = &imp,
                                         .image = g_images[s]};
    VkMemoryAllocateInfo mai = {
        .sType = VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO,
        .pNext = &ded,
        .allocationSize = req.size,
        .memoryTypeIndex = pick_memory_type(req.memoryTypeBits & fdp.memoryTypeBits, 0)};
    VkDeviceMemory mem;
    CHECK(vkAllocateMemory(g_device, &mai, NULL, &mem), "vkAllocateMemory(import)");
    CHECK(vkBindImageMemory(g_device, g_images[s], mem, 0), "vkBindImageMemory");
  }
  printf("all %u slots imported\n", slot_count);

  g_bytes = (VkDeviceSize)header.width * header.height * 4;
  VkBufferCreateInfo bci = {.sType = VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO,
                            .size = g_bytes,
                            .usage = VK_BUFFER_USAGE_TRANSFER_DST_BIT};
  CHECK(vkCreateBuffer(g_device, &bci, NULL, &g_buffer), "vkCreateBuffer");
  VkMemoryRequirements breq;
  vkGetBufferMemoryRequirements(g_device, g_buffer, &breq);
  VkMemoryAllocateInfo bmai = {
      .sType = VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO,
      .allocationSize = breq.size,
      .memoryTypeIndex = pick_memory_type(breq.memoryTypeBits,
                                          VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT |
                                              VK_MEMORY_PROPERTY_HOST_COHERENT_BIT)};
  CHECK(vkAllocateMemory(g_device, &bmai, NULL, &g_buffer_memory), "vkAllocateMemory(readback)");
  CHECK(vkBindBufferMemory(g_device, g_buffer, g_buffer_memory, 0), "vkBindBufferMemory");
  VkCommandPoolCreateInfo pci = {.sType = VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO,
                                 .queueFamilyIndex = 0,
                                 .flags = VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT};
  CHECK(vkCreateCommandPool(g_device, &pci, NULL, &g_pool), "vkCreateCommandPool");

  // ── consume, releasing promptly, until the picture has settled ──
  struct FrameReady ready;
  int consumed = 0;
  uint32_t held = UINT32_MAX;
  while (consumed < settle_frames)
  {
    if (read(peer, &ready, sizeof(ready)) != (ssize_t)sizeof(ready)) break;
    if (ready.magic != FRAME_MAGIC) continue;
    consumed++;
    if (consumed == settle_frames) { held = ready.slot; break; }
    struct Release rel = {RELEASE_MAGIC, ready.slot};
    if (write(peer, &rel, sizeof(rel)) != (ssize_t)sizeof(rel)) break;
  }
  if (held == UINT32_MAX)
  {
    fprintf(stderr, "FAIL: never reached frame %d\n", settle_frames);
    return 1;
  }
  printf("holding slot %u from frame %" PRIu64 "\n", held, ready.frame_number);

  // ── THE TEST: read the held slot twice, HOLD_MS apart ──
  uint8_t* first = malloc(g_bytes);
  uint8_t* second = malloc(g_bytes);
  uint8_t* mapped = NULL;

  for (int pass = 0; pass < 2; pass++)
  {
    VkCommandBufferAllocateInfo ai = {.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO,
                                      .commandPool = g_pool,
                                      .level = VK_COMMAND_BUFFER_LEVEL_PRIMARY,
                                      .commandBufferCount = 1};
    VkCommandBuffer cmd;
    CHECK(vkAllocateCommandBuffers(g_device, &ai, &cmd), "vkAllocateCommandBuffers");
    VkCommandBufferBeginInfo bi = {.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO,
                                   .flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT};
    CHECK(vkBeginCommandBuffer(cmd, &bi), "vkBeginCommandBuffer");
    VkImageMemoryBarrier acquire = {
        .sType = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER,
        .dstAccessMask = VK_ACCESS_TRANSFER_READ_BIT,
        .oldLayout = pass == 0 ? VK_IMAGE_LAYOUT_GENERAL : VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL,
        .newLayout = VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL,
        .srcQueueFamilyIndex = pass == 0 ? VK_QUEUE_FAMILY_FOREIGN_EXT : 0,
        .dstQueueFamilyIndex = 0,
        .image = g_images[held],
        .subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1}};
    vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT, VK_PIPELINE_STAGE_TRANSFER_BIT,
                         0, 0, NULL, 0, NULL, 1, &acquire);
    VkBufferImageCopy region = {.imageSubresource = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 0, 1},
                                .imageExtent = {header.width, header.height, 1}};
    vkCmdCopyImageToBuffer(cmd, g_images[held], VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL, g_buffer, 1,
                           &region);
    CHECK(vkEndCommandBuffer(cmd), "vkEndCommandBuffer");
    VkSubmitInfo si = {
        .sType = VK_STRUCTURE_TYPE_SUBMIT_INFO, .commandBufferCount = 1, .pCommandBuffers = &cmd};
    CHECK(vkQueueSubmit(g_queue, 1, &si, VK_NULL_HANDLE), "vkQueueSubmit");
    CHECK(vkQueueWaitIdle(g_queue), "vkQueueWaitIdle");
    CHECK(vkMapMemory(g_device, g_buffer_memory, 0, g_bytes, 0, (void**)&mapped), "vkMapMemory");
    memcpy(pass == 0 ? first : second, mapped, g_bytes);
    vkUnmapMemory(g_device, g_buffer_memory);
    vkFreeCommandBuffers(g_device, g_pool, 1, &cmd);

    if (pass == 0)
    {
      // THE ASSERTION THAT MATTERS.
      //
      // Comparing pixels is not enough and a mutation proved it: with the ring
      // check deliberately removed, Dolphin overwrote the held slot and the
      // pixels were IDENTICAL anyway, because the game sits on a static screen
      // and rewrote the same picture. The test passed while the bug was in.
      //
      // So assert the protocol invariant instead, which needs no help from the
      // game: a slot that is lent must never be announced again until it is
      // given back. Meanwhile the other slots are released promptly, to keep
      // Dolphin producing and give it every chance to violate it.
      struct FrameReady other;
      int reannounced = 0, drained = 0;
      for (int elapsed = 0; elapsed < HOLD_MS; elapsed += 10)
      {
        struct pollfd pfd = {.fd = peer, .events = POLLIN};
        if (poll(&pfd, 1, 10) <= 0) continue;
        if (read(peer, &other, sizeof(other)) != (ssize_t)sizeof(other)) break;
        if (other.magic != FRAME_MAGIC) continue;
        drained++;
        if (other.slot == held)
        {
          reannounced++;
          continue;  // do NOT release it; it is still ours
        }
        struct Release r = {RELEASE_MAGIC, other.slot};
        if (write(peer, &r, sizeof(r)) != (ssize_t)sizeof(r)) break;
      }
      printf("while holding slot %u: %d frames announced on other slots, "
             "%d on the held one\n", held, drained - reannounced, reannounced);
      if (reannounced != 0)
      {
        printf("VERDICT: FAIL — slot %u was handed out again while we held it\n", held);
        return 1;
      }
    }
  }

  size_t differing = 0;
  for (size_t i = 0; i < g_bytes; i++)
    if (first[i] != second[i]) differing++;

  int uniform = 1;
  uint32_t px0 = ((uint32_t*)first)[0];
  for (size_t i = 0; i < g_bytes / 4; i++)
    if (((uint32_t*)first)[i] != px0) { uniform = 0; break; }

  printf("first pixel RGBA: %u %u %u %u\n", first[0], first[1], first[2], first[3]);
  printf("frame is %s\n", uniform ? "UNIFORM — suspicious" : "NOT uniform — it carries an image");
  printf("bytes that changed while we held the slot: %zu of %" PRIu64 "\n", differing,
         (uint64_t)g_bytes);

  FILE* out = fopen(output_path, "wb");
  fwrite(first, 1, g_bytes, out);
  fclose(out);
  printf("wrote %s\n", output_path);

  struct Release rel = {RELEASE_MAGIC, held};
  (void)!write(peer, &rel, sizeof(rel));

  if (uniform)
  {
    printf("VERDICT: FAIL — nothing was written into the slot\n");
    return 1;
  }
  if (differing != 0)
  {
    printf("VERDICT: FAIL — the slot changed under us; the ring is not protecting it\n");
    return 1;
  }
  printf("VERDICT: PASS — a lent slot is stable and carries a real frame\n");
  return 0;
}
