// What does radeonsi's H.264 encoder actually require?
//
// One question decides how much code the encoder needs: must we hand it packed
// SPS/PPS headers, or does the driver emit them? If it is the former, the crate
// needs a bitstream writer and an SPS/PPS builder — several hundred lines with
// real room to be subtly wrong. If the latter, the encode is mostly parameter
// buffers.
//
// Asking is a minute. Guessing is a rewrite.
//
// Build: gcc va_encode_caps.c -o va_encode_caps $(pkg-config --cflags libva) -lva -lva-drm
// Run:   sg render -c ./va_encode_caps

#include <fcntl.h>
#include <string.h>
#include <stdio.h>
#include <unistd.h>

#include <va/va.h>
#include <va/va_drm.h>

static const char *packed_headers(uint32_t v) {
  static char buf[128];
  if (v == VA_ATTRIB_NOT_SUPPORTED) return "NOT SUPPORTED — the driver emits its own";
  buf[0] = '\0';
  if (v & VA_ENC_PACKED_HEADER_SEQUENCE) snprintf(buf + strlen(buf), 64, "SEQUENCE(SPS) ");
  if (v & VA_ENC_PACKED_HEADER_PICTURE) snprintf(buf + strlen(buf), 64, "PICTURE(PPS) ");
  if (v & VA_ENC_PACKED_HEADER_SLICE) snprintf(buf + strlen(buf), 64, "SLICE ");
  if (v & VA_ENC_PACKED_HEADER_MISC) snprintf(buf + strlen(buf), 64, "MISC ");
  if (v & VA_ENC_PACKED_HEADER_RAW_DATA) snprintf(buf + strlen(buf), 64, "RAW_DATA ");
  if (buf[0] == '\0') snprintf(buf, 64, "NONE (value 0)");
  return buf;
}

static void rate_control(uint32_t v) {
  if (v == VA_ATTRIB_NOT_SUPPORTED) { printf("not supported\n"); return; }
  if (v & VA_RC_CQP) printf("CQP ");
  if (v & VA_RC_CBR) printf("CBR ");
  if (v & VA_RC_VBR) printf("VBR ");
  if (v & VA_RC_VCM) printf("VCM ");
  if (v & VA_RC_CFS) printf("CFS ");
  printf("\n");
}

static void probe(VADisplay dpy, VAProfile profile, const char *name) {
  VAConfigAttrib attrs[] = {
      {VAConfigAttribRTFormat, 0},        {VAConfigAttribRateControl, 0},
      {VAConfigAttribEncPackedHeaders, 0}, {VAConfigAttribEncMaxRefFrames, 0},
      {VAConfigAttribEncQualityRange, 0}, {VAConfigAttribMaxPictureWidth, 0},
      {VAConfigAttribMaxPictureHeight, 0},
  };
  const int n = (int)(sizeof(attrs) / sizeof(attrs[0]));
  VAStatus s = vaGetConfigAttributes(dpy, profile, VAEntrypointEncSlice, attrs, n);
  if (s != VA_STATUS_SUCCESS) {
    printf("%-32s unavailable (%s)\n", name, vaErrorStr(s));
    return;
  }
  printf("\n== %s / VAEntrypointEncSlice ==\n", name);
  printf("  RT formats        : %#x%s\n", attrs[0].value,
         (attrs[0].value & VA_RT_FORMAT_YUV420) ? "  (YUV420 yes)" : "  (NO YUV420)");
  printf("  rate control      : ");
  rate_control(attrs[1].value);
  printf("  PACKED HEADERS    : %s\n", packed_headers(attrs[2].value));
  printf("  max ref frames    : %#x\n", attrs[3].value);
  printf("  quality range     : %u\n", attrs[4].value);
  printf("  max picture       : %ux%u\n", attrs[5].value, attrs[6].value);
}

int main(void) {
  int fd = open("/dev/dri/renderD128", O_RDWR);
  if (fd < 0) { perror("open renderD128"); return 1; }
  VADisplay dpy = vaGetDisplayDRM(fd);
  int major, minor;
  if (vaInitialize(dpy, &major, &minor) != VA_STATUS_SUCCESS) return 1;
  printf("%s\n", vaQueryVendorString(dpy));

  probe(dpy, VAProfileH264ConstrainedBaseline, "H264 ConstrainedBaseline");
  probe(dpy, VAProfileH264Main, "H264 Main");
  probe(dpy, VAProfileH264High, "H264 High");
  probe(dpy, VAProfileHEVCMain, "HEVC Main");

  vaTerminate(dpy);
  close(fd);
  return 0;
}
