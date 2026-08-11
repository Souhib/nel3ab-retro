// M2 spike, part 7: who writes the H.264 headers?
//
// ⚠️ STATUS: this program SEGFAULTS inside radeonsi during vaEndPicture, and is
// kept anyway. It is not the encoder; it is the record of how the question was
// answered, and about ninety percent of the parameter set the real one needs.
// Deleting it would mean the next attempt rediscovers all of it.
//
// THE ANSWER, observed rather than guessed:
//
//   The driver does NOT synthesise SPS/PPS. `va_encode_caps` says radeonsi
//   ACCEPTS packed headers, which is not the same as requiring them — so the
//   question was settled by tracing what the reference implementation does:
//
//     LIBVA_TRACE=... ffmpeg -vaapi_device ... -c:v h264_vaapi ...
//
//   ffmpeg requests VAConfigAttribEncPackedHeaders = 0x0d
//   (SEQUENCE | SLICE | MISC) and then supplies, per access unit:
//
//     type 1 (Sequence)  312 bits — SPS and PPS together
//     type 4 (RawData)  1488 bits — SEI
//     type 3 (Slice)      72 bits — the slice header, EVERY frame
//
//   So the crate needs a bitstream writer: exp-Golomb, emulation-prevention
//   bytes, and the SPS/PPS/slice-header syntax. That is the several hundred
//   lines this spike existed to confirm or rule out, and it is confirmed.
//
// This program supplies no packed headers at all, which is very likely why the
// driver walks off the end. Reaching for LIBVA_TRACE earlier would have been
// cheaper than three rounds of guessing at parameter buffers — the same lesson
// as vulkaninfo not being able to answer the modifier question.
//
// Build: see README
// Run:   sg render -c ./va_encode_one_frame /tmp/out.h264

#include <fcntl.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include <va/va.h>
#include <va/va_drm.h>
#include <va/va_enc_h264.h>

#define WIDTH 640
#define HEIGHT 480
#define QP 26

#define VACHECK(expr, what)                                                              \
  do {                                                                                   \
    VAStatus _s = (expr);                                                                \
    if (_s != VA_STATUS_SUCCESS) {                                                       \
      fprintf(stderr, "FAIL: %s -> %s\n", what, vaErrorStr(_s));                         \
      return 1;                                                                          \
    }                                                                                    \
  } while (0)

static const char *nal_name(uint8_t type) {
  switch (type) {
    case 1: return "non-IDR slice";
    case 5: return "IDR slice";
    case 6: return "SEI";
    case 7: return "SPS";
    case 8: return "PPS";
    case 9: return "access unit delimiter";
    default: return "?";
  }
}

int main(int argc, char **argv) {
  const char *out_path = argc > 1 ? argv[1] : "/tmp/nel3ab-one-frame.h264";

  int fd = open("/dev/dri/renderD128", O_RDWR);
  if (fd < 0) { perror("open renderD128"); return 1; }
  VADisplay dpy = vaGetDisplayDRM(fd);
  int major, minor;
  VACHECK(vaInitialize(dpy, &major, &minor), "vaInitialize");
  printf("%s\n\n", vaQueryVendorString(dpy));

  // ── config: constrained baseline, constant QP, no rate control to tune ──
  VAConfigAttrib config_attrs[3] = {
      {.type = VAConfigAttribRTFormat, .value = VA_RT_FORMAT_YUV420},
      {.type = VAConfigAttribRateControl, .value = VA_RC_CQP},
      // Stated explicitly: we supply no packed headers. Left unset, the driver
      // may assume the application will provide them.
      {.type = VAConfigAttribEncPackedHeaders, .value = 0},
  };
  VAConfigID config;
  VACHECK(vaCreateConfig(dpy, VAProfileH264Main, VAEntrypointEncSlice,
                         config_attrs, 3, &config),
          "vaCreateConfig");

  // ── the surface being encoded ──
  VASurfaceAttrib surf_attr = {
      .type = VASurfaceAttribPixelFormat,
      .flags = VA_SURFACE_ATTRIB_SETTABLE,
      .value = {.type = VAGenericValueTypeInteger, .value = {.i = VA_FOURCC_NV12}}};
  VASurfaceID surface;
  VACHECK(vaCreateSurfaces(dpy, VA_RT_FORMAT_YUV420, WIDTH, HEIGHT, &surface, 1, &surf_attr, 1),
          "vaCreateSurfaces");

  // Fill it with something an encoder cannot trivially collapse: a gradient, so
  // the coded size says whether it actually looked at the pixels.
  {
    VAImage image;
    VAImageFormat fmt = {
        .fourcc = VA_FOURCC_NV12, .byte_order = VA_LSB_FIRST, .bits_per_pixel = 12};
    VACHECK(vaCreateImage(dpy, &fmt, WIDTH, HEIGHT, &image), "vaCreateImage");
    uint8_t *base = NULL;
    VACHECK(vaMapBuffer(dpy, image.buf, (void **)&base), "vaMapBuffer");
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
    VACHECK(vaUnmapBuffer(dpy, image.buf), "vaUnmapBuffer");
    VACHECK(vaPutImage(dpy, surface, image.image_id, 0, 0, WIDTH, HEIGHT, 0, 0, WIDTH, HEIGHT),
            "vaPutImage");
    vaDestroyImage(dpy, image.image_id);
  }

  VAContextID context;
  VACHECK(vaCreateContext(dpy, config, WIDTH, HEIGHT, VA_PROGRESSIVE, &surface, 1, &context),
          "vaCreateContext");

  // ── parameter buffers ──
  const uint32_t mbs_w = (WIDTH + 15) / 16;
  const uint32_t mbs_h = (HEIGHT + 15) / 16;

  VAEncSequenceParameterBufferH264 seq = {0};
  seq.seq_parameter_set_id = 0;
  seq.level_idc = 41;
  seq.intra_period = 1;      // every frame an I-frame; no reference management
  seq.intra_idr_period = 1;
  seq.ip_period = 1;
  seq.max_num_ref_frames = 1;
  seq.picture_width_in_mbs = mbs_w;
  seq.picture_height_in_mbs = mbs_h;
  seq.seq_fields.bits.chroma_format_idc = 1;  // 4:2:0 — zero would mean monochrome
  seq.seq_fields.bits.frame_mbs_only_flag = 1;
  seq.seq_fields.bits.direct_8x8_inference_flag = 1;
  seq.seq_fields.bits.log2_max_frame_num_minus4 = 0;
  seq.seq_fields.bits.log2_max_pic_order_cnt_lsb_minus4 = 2;
  seq.seq_fields.bits.pic_order_cnt_type = 0;
  // The picture is a whole number of macroblocks here, so no cropping.
  seq.frame_cropping_flag = 0;
  seq.vui_parameters_present_flag = 0;

  VAEncPictureParameterBufferH264 pic = {0};
  pic.CurrPic.picture_id = surface;
  pic.CurrPic.frame_idx = 0;
  pic.CurrPic.flags = 0;
  pic.CurrPic.TopFieldOrderCnt = 0;
  pic.CurrPic.BottomFieldOrderCnt = 0;
  for (int i = 0; i < 16; i++) {
    pic.ReferenceFrames[i].picture_id = VA_INVALID_ID;
    pic.ReferenceFrames[i].flags = VA_PICTURE_H264_INVALID;
  }
  pic.pic_parameter_set_id = 0;
  pic.seq_parameter_set_id = 0;
  pic.last_picture = 0;
  pic.frame_num = 0;
  pic.pic_init_qp = QP;
  pic.num_ref_idx_l0_active_minus1 = 0;
  pic.pic_fields.bits.idr_pic_flag = 1;
  pic.pic_fields.bits.reference_pic_flag = 1;
  pic.pic_fields.bits.entropy_coding_mode_flag = 0;  // CAVLC: baseline has no CABAC
  pic.pic_fields.bits.deblocking_filter_control_present_flag = 1;

  // The coded buffer. Generous: a QP-26 IDR of a gradient is far smaller, and an
  // undersized buffer fails in a way that looks like a broken encoder.
  const uint32_t coded_size = WIDTH * HEIGHT * 3 / 2;
  VABufferID coded_buf;
  VACHECK(vaCreateBuffer(dpy, context, VAEncCodedBufferType, coded_size, 1, NULL, &coded_buf),
          "vaCreateBuffer(coded)");
  pic.coded_buf = coded_buf;

  VAEncSliceParameterBufferH264 slice = {0};
  slice.macroblock_address = 0;
  slice.num_macroblocks = mbs_w * mbs_h;
  slice.macroblock_info = VA_INVALID_ID;
  slice.slice_type = 2;  // I
  slice.pic_parameter_set_id = 0;
  slice.idr_pic_id = 0;
  slice.pic_order_cnt_lsb = 0;
  slice.num_ref_idx_active_override_flag = 0;
  for (int i = 0; i < 32; i++) {
    slice.RefPicList0[i].picture_id = VA_INVALID_ID;
    slice.RefPicList0[i].flags = VA_PICTURE_H264_INVALID;
    slice.RefPicList1[i].picture_id = VA_INVALID_ID;
    slice.RefPicList1[i].flags = VA_PICTURE_H264_INVALID;
  }
  slice.slice_qp_delta = 0;
  slice.disable_deblocking_filter_idc = 0;

  // radeonsi reads the rate-control and frame-rate misc buffers even under CQP;
  // without them its encoder state is zeroed and vaEndPicture walks off.
  VABufferID rc_buf, fr_buf;
  VACHECK(vaCreateBuffer(dpy, context, VAEncMiscParameterBufferType,
                         sizeof(VAEncMiscParameterBuffer) +
                             sizeof(VAEncMiscParameterRateControl),
                         1, NULL, &rc_buf),
          "vaCreateBuffer(rc)");
  {
    VAEncMiscParameterBuffer *misc = NULL;
    VACHECK(vaMapBuffer(dpy, rc_buf, (void **)&misc), "vaMapBuffer(rc)");
    misc->type = VAEncMiscParameterTypeRateControl;
    VAEncMiscParameterRateControl *rc = (VAEncMiscParameterRateControl *)misc->data;
    memset(rc, 0, sizeof(*rc));
    rc->bits_per_second = 5000000;
    rc->target_percentage = 100;
    rc->window_size = 1000;
    rc->initial_qp = QP;
    rc->min_qp = QP;
    rc->max_qp = QP;
    VACHECK(vaUnmapBuffer(dpy, rc_buf), "vaUnmapBuffer(rc)");
  }
  VACHECK(vaCreateBuffer(dpy, context, VAEncMiscParameterBufferType,
                         sizeof(VAEncMiscParameterBuffer) +
                             sizeof(VAEncMiscParameterFrameRate),
                         1, NULL, &fr_buf),
          "vaCreateBuffer(framerate)");
  {
    VAEncMiscParameterBuffer *misc = NULL;
    VACHECK(vaMapBuffer(dpy, fr_buf, (void **)&misc), "vaMapBuffer(framerate)");
    misc->type = VAEncMiscParameterTypeFrameRate;
    VAEncMiscParameterFrameRate *fr = (VAEncMiscParameterFrameRate *)misc->data;
    memset(fr, 0, sizeof(*fr));
    fr->framerate = 60;
    VACHECK(vaUnmapBuffer(dpy, fr_buf), "vaUnmapBuffer(framerate)");
  }

  VABufferID seq_buf, pic_buf, slice_buf;
  VACHECK(vaCreateBuffer(dpy, context, VAEncSequenceParameterBufferType, sizeof(seq), 1, &seq,
                         &seq_buf),
          "vaCreateBuffer(seq)");
  VACHECK(vaCreateBuffer(dpy, context, VAEncPictureParameterBufferType, sizeof(pic), 1, &pic,
                         &pic_buf),
          "vaCreateBuffer(pic)");
  VACHECK(vaCreateBuffer(dpy, context, VAEncSliceParameterBufferType, sizeof(slice), 1, &slice,
                         &slice_buf),
          "vaCreateBuffer(slice)");

  // ── encode. NOTE: no packed headers are supplied, on purpose. ──
  VACHECK(vaBeginPicture(dpy, context, surface), "vaBeginPicture");
  VABufferID params[5] = {seq_buf, rc_buf, fr_buf, pic_buf, slice_buf};
  VACHECK(vaRenderPicture(dpy, context, params, 5), "vaRenderPicture");
  VACHECK(vaEndPicture(dpy, context), "vaEndPicture");
  VACHECK(vaSyncSurface(dpy, surface), "vaSyncSurface");

  VACodedBufferSegment *segment = NULL;
  VACHECK(vaMapBuffer(dpy, coded_buf, (void **)&segment), "vaMapBuffer(coded)");

  FILE *out = fopen(out_path, "wb");
  size_t total = 0;
  uint8_t first_bytes[64] = {0};
  size_t captured = 0;
  for (VACodedBufferSegment *s = segment; s; s = s->next) {
    fwrite(s->buf, 1, s->size, out);
    if (captured < sizeof(first_bytes)) {
      const size_t take = s->size < sizeof(first_bytes) - captured ? s->size
                                                                   : sizeof(first_bytes) - captured;
      memcpy(first_bytes + captured, s->buf, take);
      captured += take;
    }
    total += s->size;
  }
  fclose(out);
  VACHECK(vaUnmapBuffer(dpy, coded_buf), "vaUnmapBuffer(coded)");

  printf("coded %zu bytes -> %s\n\n", total, out_path);
  if (total == 0) {
    printf("VERDICT: the encoder produced nothing\n");
    return 1;
  }

  // ── who wrote the headers? ──
  printf("first NAL units:\n");
  int saw_sps = 0, saw_pps = 0, saw_idr = 0, found = 0;
  for (size_t i = 0; i + 4 < captured && found < 5; i++) {
    if (first_bytes[i] == 0 && first_bytes[i + 1] == 0 && first_bytes[i + 2] == 1) {
      const uint8_t type = first_bytes[i + 3] & 0x1f;
      printf("  offset %2zu: type %2u (%s)\n", i, type, nal_name(type));
      if (type == 7) saw_sps = 1;
      if (type == 8) saw_pps = 1;
      if (type == 5) saw_idr = 1;
      found++;
    }
  }

  printf("\nVERDICT: %s\n",
         (saw_sps && saw_pps)
             ? "the driver emits SPS and PPS itself — the crate needs no bitstream writer"
             : "no SPS/PPS in the output — packed headers must be supplied by us");
  printf("         IDR slice present: %s\n", saw_idr ? "yes" : "NO");

  vaDestroyBuffer(dpy, coded_buf);
  vaDestroyContext(dpy, context);
  vaDestroyConfig(dpy, config);
  vaDestroySurfaces(dpy, &surface, 1);
  vaTerminate(dpy);
  close(fd);
  return (saw_sps && saw_pps && saw_idr) ? 0 : 1;
}
