#include "nel3ab_encode.h"

#include <stddef.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include <libavcodec/avcodec.h>
#include <libavutil/hwcontext.h>
#include <libavutil/hwcontext_vaapi.h>
#include <libavutil/opt.h>

#include <va/va.h>
#include <va/va_drmcommon.h>

#define MAX_SLOTS 8

struct n3_encoder {
  AVBufferRef *device;
  AVBufferRef *frames;
  AVCodecContext *codec;
  AVFrame *slots[MAX_SLOTS];
  uint32_t slot_count;
  AVPacket *packet;
  int64_t pts;
  int force_key;
};

static VADisplay display_of(const n3_encoder *encoder) {
  AVHWDeviceContext *device = (AVHWDeviceContext *)encoder->device->data;
  AVVAAPIDeviceContext *va = device->hwctx;
  return va->display;
}

static void fail(int *error, int code) {
  if (error) *error = code;
}

n3_encoder *n3_encoder_open(const char *render_node, uint32_t width, uint32_t height,
                            uint32_t qp, uint32_t fps, uint32_t slots, int *error) {
  if (slots == 0 || slots > MAX_SLOTS) {
    fail(error, N3_ERR_RANGE);
    return NULL;
  }

  n3_encoder *encoder = calloc(1, sizeof(*encoder));
  if (!encoder) {
    fail(error, N3_ERR_ALLOC);
    return NULL;
  }

  if (av_hwdevice_ctx_create(&encoder->device, AV_HWDEVICE_TYPE_VAAPI, render_node, NULL, 0) < 0) {
    fail(error, N3_ERR_DEVICE);
    n3_encoder_close(encoder);
    return NULL;
  }

  encoder->frames = av_hwframe_ctx_alloc(encoder->device);
  if (!encoder->frames) {
    fail(error, N3_ERR_POOL);
    n3_encoder_close(encoder);
    return NULL;
  }
  AVHWFramesContext *frames = (AVHWFramesContext *)encoder->frames->data;
  frames->format = AV_PIX_FMT_VAAPI;
  frames->sw_format = AV_PIX_FMT_NV12;
  frames->width = (int)width;
  frames->height = (int)height;
  /* The pool must outlive every slot we hand out, so it is sized here rather
     than grown on demand — a pool that reallocates would invalidate surfaces a
     Vulkan import is still holding. */
  frames->initial_pool_size = (int)slots;
  if (av_hwframe_ctx_init(encoder->frames) < 0) {
    fail(error, N3_ERR_POOL);
    n3_encoder_close(encoder);
    return NULL;
  }

  for (uint32_t i = 0; i < slots; i++) {
    encoder->slots[i] = av_frame_alloc();
    if (!encoder->slots[i] || av_hwframe_get_buffer(encoder->frames, encoder->slots[i], 0) < 0) {
      fail(error, N3_ERR_POOL);
      n3_encoder_close(encoder);
      return NULL;
    }
  }
  encoder->slot_count = slots;

  const AVCodec *codec = avcodec_find_encoder_by_name("h264_vaapi");
  if (!codec) {
    fail(error, N3_ERR_NO_ENCODER);
    n3_encoder_close(encoder);
    return NULL;
  }
  encoder->codec = avcodec_alloc_context3(codec);
  if (!encoder->codec) {
    fail(error, N3_ERR_ALLOC);
    n3_encoder_close(encoder);
    return NULL;
  }
  encoder->codec->width = (int)width;
  encoder->codec->height = (int)height;
  encoder->codec->time_base = (AVRational){1, (int)fps};
  encoder->codec->framerate = (AVRational){(int)fps, 1};
  encoder->codec->pix_fmt = AV_PIX_FMT_VAAPI;
  encoder->codec->hw_frames_ctx = av_buffer_ref(encoder->frames);
  /* Latency. ADR D7 gave up direct control of submission timing and promised to
     measure what that costs; these are the settings that make the measurement
     fair. No B-frames means no reordering, so a frame never waits for a later
     one, and async_depth 1 means the encoder holds none back. */
  encoder->codec->max_b_frames = 0;
  encoder->codec->gop_size = (int)fps;
  av_opt_set_int(encoder->codec->priv_data, "async_depth", 1, 0);
  av_opt_set(encoder->codec->priv_data, "rc_mode", "CQP", 0);
  av_opt_set_int(encoder->codec->priv_data, "qp", (int64_t)qp, 0);

  if (avcodec_open2(encoder->codec, codec, NULL) < 0) {
    fail(error, N3_ERR_OPEN);
    n3_encoder_close(encoder);
    return NULL;
  }

  encoder->packet = av_packet_alloc();
  if (!encoder->packet) {
    fail(error, N3_ERR_ALLOC);
    n3_encoder_close(encoder);
    return NULL;
  }

  fail(error, N3_OK);
  return encoder;
}

uint32_t n3_encoder_slots(const n3_encoder *encoder) {
  return encoder ? encoder->slot_count : 0;
}

int n3_encoder_export(n3_encoder *encoder, uint32_t slot, n3_surface *out) {
  if (!encoder || !out || slot >= encoder->slot_count) return N3_ERR_RANGE;

  const VASurfaceID surface = (VASurfaceID)(uintptr_t)encoder->slots[slot]->data[3];
  VADRMPRIMESurfaceDescriptor desc;
  memset(&desc, 0, sizeof(desc));
  /* WRITE_ONLY and SEPARATE_LAYERS are not adjustable: the shader writes NV12
     in, and the planes must arrive separately because a single NV12 image is
     not writable by a shader on this hardware. Measured; see the spikes. */
  const VAStatus status = vaExportSurfaceHandle(
      display_of(encoder), surface, VA_SURFACE_ATTRIB_MEM_TYPE_DRM_PRIME_2,
      VA_EXPORT_SURFACE_WRITE_ONLY | VA_EXPORT_SURFACE_SEPARATE_LAYERS, &desc);
  if (status != VA_STATUS_SUCCESS) return N3_ERR_EXPORT;
  if (desc.num_objects != 1 || desc.num_layers > 4) {
    for (uint32_t i = 0; i < desc.num_objects; i++) close(desc.objects[i].fd);
    return N3_ERR_EXPORT;
  }

  memset(out, 0, sizeof(*out));
  out->fd = desc.objects[0].fd;
  out->width = desc.width;
  out->height = desc.height;
  out->fourcc = desc.fourcc;
  out->modifier = desc.objects[0].drm_format_modifier;
  out->plane_count = desc.num_layers;
  for (uint32_t i = 0; i < desc.num_layers; i++) {
    out->planes[i].drm_format = desc.layers[i].drm_format;
    out->planes[i].offset = desc.layers[i].offset[0];
    out->planes[i].pitch = desc.layers[i].pitch[0];
  }
  return N3_OK;
}

long n3_encoder_encode(n3_encoder *encoder, uint32_t slot, const uint8_t **data) {
  if (!encoder || !data || slot >= encoder->slot_count) return N3_ERR_RANGE;

  av_packet_unref(encoder->packet);
  encoder->slots[slot]->pts = encoder->pts++;
  /* Cleared whether or not the encoder honours it: a request left set would turn
     every later frame into an IDR and multiply the bitrate. */
  encoder->slots[slot]->pict_type =
      encoder->force_key ? AV_PICTURE_TYPE_I : AV_PICTURE_TYPE_NONE;
  encoder->force_key = 0;
  if (avcodec_send_frame(encoder->codec, encoder->slots[slot]) < 0) return N3_ERR_ENCODE;

  const int got = avcodec_receive_packet(encoder->codec, encoder->packet);
  if (got == AVERROR(EAGAIN)) {
    /* Accepted, nothing out yet. With async_depth 1 and no B-frames this should
       not happen, and saying zero rather than erroring lets a caller notice. */
    *data = NULL;
    return 0;
  }
  if (got < 0) return N3_ERR_ENCODE;

  *data = encoder->packet->data;
  return encoder->packet->size;
}

void n3_encoder_force_key(n3_encoder *encoder) {
  if (encoder) encoder->force_key = 1;
}

size_t n3_layout(int what) {
  switch (what) {
    case N3_LAYOUT_SURFACE_SIZE: return sizeof(n3_surface);
    case N3_LAYOUT_SURFACE_FD: return offsetof(n3_surface, fd);
    case N3_LAYOUT_SURFACE_WIDTH: return offsetof(n3_surface, width);
    case N3_LAYOUT_SURFACE_HEIGHT: return offsetof(n3_surface, height);
    case N3_LAYOUT_SURFACE_FOURCC: return offsetof(n3_surface, fourcc);
    case N3_LAYOUT_SURFACE_MODIFIER: return offsetof(n3_surface, modifier);
    case N3_LAYOUT_SURFACE_PLANE_COUNT: return offsetof(n3_surface, plane_count);
    case N3_LAYOUT_SURFACE_PLANES: return offsetof(n3_surface, planes);
    case N3_LAYOUT_PLANE_SIZE: return sizeof(n3_plane);
    case N3_LAYOUT_PLANE_FORMAT: return offsetof(n3_plane, drm_format);
    case N3_LAYOUT_PLANE_OFFSET: return offsetof(n3_plane, offset);
    case N3_LAYOUT_PLANE_PITCH: return offsetof(n3_plane, pitch);
    default: return (size_t)-1;
  }
}

void n3_encoder_close(n3_encoder *encoder) {
  if (!encoder) return;
  if (encoder->packet) av_packet_free(&encoder->packet);
  if (encoder->codec) avcodec_free_context(&encoder->codec);
  for (uint32_t i = 0; i < MAX_SLOTS; i++) {
    if (encoder->slots[i]) av_frame_free(&encoder->slots[i]);
  }
  if (encoder->frames) av_buffer_unref(&encoder->frames);
  if (encoder->device) av_buffer_unref(&encoder->device);
  free(encoder);
}
