// M2 spike, part 8: can libavcodec encode a surface WE control?
//
// The hand-written libva encoder segfaults inside radeonsi at vaEndPicture, and
// four rounds of matching ffmpeg's traced call sequence did not move it. ffmpeg
// itself encodes on this card without complaint, so the question worth asking is
// no longer "why does ours crash" but "do we need ours at all".
//
// Two things have to hold for libavcodec to replace it, and neither is obvious:
//
//   1. The surface it encodes must be one we can still WRITE with a compute
//      shader — that is ADR D5's whole pipeline. So the surface has to come out
//      of libavcodec's pool and still export as a DCC-free dma-buf.
//   2. The encode must produce a stream a decoder accepts.
//
// This checks both. It fills the surface from the CPU rather than the shader,
// because the shader path is already proven on its own (part 6) and mixing them
// would make a failure ambiguous.
//
// Build: gcc av_encode_our_surface.c -o av_encode_our_surface \
//            $(pkg-config --cflags --libs libavcodec libavutil) -lva -lva-drm
// Run:   sg render -c './av_encode_our_surface /tmp/av.h264'

#include <inttypes.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

#include <libavcodec/avcodec.h>
#include <libavutil/hwcontext.h>
#include <libavutil/hwcontext_vaapi.h>
#include <libavutil/opt.h>

#include <va/va.h>
#include <va/va_drmcommon.h>

#define WIDTH 640
#define HEIGHT 480

#define AVCHECK(expr, what)                                                              \
  do {                                                                                   \
    int _r = (expr);                                                                      \
    if (_r < 0) {                                                                         \
      char _e[128];                                                                        \
      av_strerror(_r, _e, sizeof(_e));                                                     \
      fprintf(stderr, "FAIL: %s: %s\n", what, _e);                                          \
      return 1;                                                                            \
    }                                                                                      \
  } while (0)

int main(int argc, char **argv) {
  const char *out_path = argc > 1 ? argv[1] : "/tmp/nel3ab-av.h264";

  // ── the VAAPI device, on the render node the rest of the project uses ──
  AVBufferRef *device = NULL;
  AVCHECK(av_hwdevice_ctx_create(&device, AV_HWDEVICE_TYPE_VAAPI,
                                 "/dev/dri/renderD128", NULL, 0),
          "av_hwdevice_ctx_create");
  AVVAAPIDeviceContext *va_device =
      ((AVHWDeviceContext *)device->data)->hwctx;
  printf("VA display in libavcodec's hands: %p\n", (void *)va_device->display);

  // ── a pool of NV12 surfaces, allocated by libavcodec ──
  AVBufferRef *frames = av_hwframe_ctx_alloc(device);
  if (!frames) { fprintf(stderr, "FAIL: av_hwframe_ctx_alloc\n"); return 1; }
  AVHWFramesContext *frames_ctx = (AVHWFramesContext *)frames->data;
  frames_ctx->format = AV_PIX_FMT_VAAPI;
  frames_ctx->sw_format = AV_PIX_FMT_NV12;
  frames_ctx->width = WIDTH;
  frames_ctx->height = HEIGHT;
  frames_ctx->initial_pool_size = 4;
  AVCHECK(av_hwframe_ctx_init(frames), "av_hwframe_ctx_init");

  AVFrame *frame = av_frame_alloc();
  AVCHECK(av_hwframe_get_buffer(frames, frame, 0), "av_hwframe_get_buffer");
  const VASurfaceID surface = (VASurfaceID)(uintptr_t)frame->data[3];
  printf("surface from libavcodec's pool: 0x%08x\n", surface);

  // ── QUESTION 1: is that surface still ours to write? ──
  //
  // If it does not export as a DCC-free dma-buf, the compute shader cannot
  // write NV12 into it and D5's pipeline is broken — which would make
  // libavcodec a worse trade, not a better one.
  VADRMPRIMESurfaceDescriptor desc;
  memset(&desc, 0, sizeof(desc));
  VAStatus st = vaExportSurfaceHandle(
      va_device->display, surface, VA_SURFACE_ATTRIB_MEM_TYPE_DRM_PRIME_2,
      VA_EXPORT_SURFACE_WRITE_ONLY | VA_EXPORT_SURFACE_SEPARATE_LAYERS, &desc);
  if (st != VA_STATUS_SUCCESS) {
    fprintf(stderr, "FAIL: the pool's surface does not export: %s\n", vaErrorStr(st));
    return 1;
  }
  const uint64_t modifier = desc.objects[0].drm_format_modifier;
  const int dcc = (int)((modifier >> 13) & 1);
  printf("exported: modifier %#018" PRIx64 ", %u layers, DCC=%d\n", modifier,
         desc.num_layers, dcc);
  for (uint32_t i = 0; i < desc.num_layers; i++)
    printf("  layer %u: offset %u pitch %u\n", i, desc.layers[i].offset[0],
           desc.layers[i].pitch[0]);
  for (uint32_t i = 0; i < desc.num_objects; i++) close(desc.objects[i].fd);

  // ── fill it with a gradient, so the coded size proves it saw pixels ──
  VAImage image;
  VAImageFormat fmt = {
      .fourcc = VA_FOURCC_NV12, .byte_order = VA_LSB_FIRST, .bits_per_pixel = 12};
  if (vaCreateImage(va_device->display, &fmt, WIDTH, HEIGHT, &image) != VA_STATUS_SUCCESS) {
    fprintf(stderr, "FAIL: vaCreateImage\n");
    return 1;
  }
  uint8_t *base = NULL;
  vaMapBuffer(va_device->display, image.buf, (void **)&base);
  for (uint32_t y = 0; y < HEIGHT; y++) {
    uint8_t *row = base + image.offsets[0] + (size_t)y * image.pitches[0];
    for (uint32_t x = 0; x < WIDTH; x++) row[x] = (uint8_t)((x * 2 + y * 3) & 0xff);
  }
  for (uint32_t y = 0; y < HEIGHT / 2; y++) {
    uint8_t *row = base + image.offsets[1] + (size_t)y * image.pitches[1];
    for (uint32_t x = 0; x < WIDTH / 2; x++) {
      row[x * 2 + 0] = (uint8_t)((x * 4) & 0xff);
      row[x * 2 + 1] = (uint8_t)((y * 4) & 0xff);
    }
  }
  vaUnmapBuffer(va_device->display, image.buf);
  vaPutImage(va_device->display, surface, image.image_id, 0, 0, WIDTH, HEIGHT, 0, 0,
             WIDTH, HEIGHT);
  vaDestroyImage(va_device->display, image.image_id);

  // ── QUESTION 2: does it encode? ──
  const AVCodec *codec = avcodec_find_encoder_by_name("h264_vaapi");
  if (!codec) { fprintf(stderr, "FAIL: no h264_vaapi encoder\n"); return 1; }
  AVCodecContext *ctx = avcodec_alloc_context3(codec);
  ctx->width = WIDTH;
  ctx->height = HEIGHT;
  ctx->time_base = (AVRational){1, 60};
  ctx->framerate = (AVRational){60, 1};
  ctx->pix_fmt = AV_PIX_FMT_VAAPI;
  ctx->hw_frames_ctx = av_buffer_ref(frames);
  // Latency, which is the one thing hand-rolled libva would have bought:
  // one frame in, one frame out, no reordering, no lookahead.
  ctx->max_b_frames = 0;
  ctx->gop_size = 60;
  av_opt_set_int(ctx->priv_data, "async_depth", 1, 0);
  av_opt_set(ctx->priv_data, "rc_mode", "CQP", 0);
  av_opt_set_int(ctx->priv_data, "qp", 26, 0);
  AVCHECK(avcodec_open2(ctx, codec, NULL), "avcodec_open2");

  frame->pts = 0;
  AVCHECK(avcodec_send_frame(ctx, frame), "avcodec_send_frame");
  AVCHECK(avcodec_send_frame(ctx, NULL), "flush");

  AVPacket *packet = av_packet_alloc();
  FILE *out = fopen(out_path, "wb");
  size_t total = 0;
  int packets = 0;
  while (avcodec_receive_packet(ctx, packet) == 0) {
    fwrite(packet->data, 1, packet->size, out);
    total += packet->size;
    packets++;
    av_packet_unref(packet);
  }
  fclose(out);

  printf("\ncoded %zu bytes in %d packet(s) -> %s\n", total, packets, out_path);
  const int ok = total > 0 && dcc == 0 && desc.num_layers == 2;
  printf("\nVERDICT: %s\n",
         ok ? "libavcodec encodes a surface that is still ours to write — "
              "the hand-rolled libva encoder is not needed"
            : "something did not hold; see above");

  av_packet_free(&packet);
  avcodec_free_context(&ctx);
  av_frame_free(&frame);
  av_buffer_unref(&frames);
  av_buffer_unref(&device);
  return ok ? 0 : 1;
}
