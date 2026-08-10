// M2 spike: what layout does VAAPI hand us for an encode surface, and can
// Vulkan take it?
//
// ADR 0001 D5 says: allocate the VAAPI surface FIRST, export it, and let a
// shader write NV12 into it — because Mesa rejects DCC modifiers for the video
// engine on everything before RDNA4, and the target GPU is RDNA2. That claim
// decides M2's whole architecture, so this measures it instead of trusting it.
//
// The question is narrow on purpose: which DRM format modifier does the
// radeonsi VAAPI driver choose for an NV12 surface hinted for the ENCODER, and
// how is it laid out? If it comes back LINEAR, importing into Vulkan is easy.
// If it comes back tiled with DCC, the naive pipeline is exactly the one D5
// warns about.
//
// It also allocates the same surface WITHOUT the encoder hint, because if the
// two differ then the hint is load-bearing and forgetting it later would be a
// silent corruption rather than an error.
//
// Build:  gcc spike.c -o spike -lva -lva-drm
// Run:    sg render -c ./spike        (souhib needs the render group)

#include <fcntl.h>
#include <inttypes.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

#include <drm_fourcc.h>
#include <va/va.h>
#include <va/va_drm.h>
#include <va/va_drmcommon.h>

#define WIDTH 1920
#define HEIGHT 1080

static int fail(const char *what, VAStatus st) {
  fprintf(stderr, "FAIL: %s: %s (0x%x)\n", what, vaErrorStr(st), st);
  return 1;
}

static void print_fourcc(const char *label, uint32_t f) {
  printf("%s%c%c%c%c (0x%08x)\n", label, f & 0xff, (f >> 8) & 0xff,
         (f >> 16) & 0xff, (f >> 24) & 0xff, f);
}

// Decodes just enough of the modifier to answer the question D5 raises.
static void explain_modifier(uint64_t mod) {
  printf("      modifier   : 0x%016" PRIx64 "\n", mod);
  if (mod == DRM_FORMAT_MOD_LINEAR) {
    printf("      -> LINEAR. No tiling, no compression: the easiest thing a\n"
           "         Vulkan import can be handed.\n");
    return;
  }
  if (mod == DRM_FORMAT_MOD_INVALID) {
    printf("      -> INVALID: the driver refused to describe a layout.\n");
    return;
  }
#ifdef IS_AMD_FMT_MOD
  if (IS_AMD_FMT_MOD(mod)) {
    const uint64_t tile_version = AMD_FMT_MOD_GET(TILE_VERSION, mod);
    const uint64_t tile = AMD_FMT_MOD_GET(TILE, mod);
    const uint64_t dcc = AMD_FMT_MOD_GET(DCC, mod);
    printf("      -> AMD tiled: TILE_VERSION=%" PRIu64 " TILE=%" PRIu64
           " DCC=%" PRIu64 "\n",
           tile_version, tile, dcc);
    printf("      -> DCC (delta colour compression) is %s. This is the exact\n"
           "         bit ADR D5 is about: the video engine cannot read it on\n"
           "         RDNA2.\n",
           dcc ? "ON" : "OFF");
    return;
  }
#endif
  printf("      -> vendor 0x%02" PRIx64 ", not decoded here.\n", mod >> 56);
}

static int export_and_report(VADisplay dpy, const char *label, int with_hint) {
  VASurfaceAttrib attrs[2];
  int n_attrs = 0;

  attrs[n_attrs].type = VASurfaceAttribPixelFormat;
  attrs[n_attrs].flags = VA_SURFACE_ATTRIB_SETTABLE;
  attrs[n_attrs].value.type = VAGenericValueTypeInteger;
  attrs[n_attrs].value.value.i = VA_FOURCC_NV12;
  n_attrs++;

  if (with_hint) {
    attrs[n_attrs].type = VASurfaceAttribUsageHint;
    attrs[n_attrs].flags = VA_SURFACE_ATTRIB_SETTABLE;
    attrs[n_attrs].value.type = VAGenericValueTypeInteger;
    attrs[n_attrs].value.value.i = VA_SURFACE_ATTRIB_USAGE_HINT_ENCODER;
    n_attrs++;
  }

  VASurfaceID surface = VA_INVALID_ID;
  VAStatus st = vaCreateSurfaces(dpy, VA_RT_FORMAT_YUV420, WIDTH, HEIGHT,
                                 &surface, 1, attrs, n_attrs);
  if (st != VA_STATUS_SUCCESS) return fail("vaCreateSurfaces", st);

  VADRMPRIMESurfaceDescriptor desc;
  memset(&desc, 0, sizeof(desc));
  // WRITE_ONLY: we intend a shader to WRITE into this surface, which is the
  // direction D5 prescribes — not to read a rendered frame out of it.
  st = vaExportSurfaceHandle(dpy, surface, VA_SURFACE_ATTRIB_MEM_TYPE_DRM_PRIME_2,
                             VA_EXPORT_SURFACE_WRITE_ONLY |
                                 VA_EXPORT_SURFACE_SEPARATE_LAYERS,
                             &desc);
  if (st != VA_STATUS_SUCCESS) {
    vaDestroySurfaces(dpy, &surface, 1);
    return fail("vaExportSurfaceHandle", st);
  }

  printf("\n== %s ==\n", label);
  print_fourcc("  surface fourcc: ", desc.fourcc);
  printf("  size          : %ux%u\n", desc.width, desc.height);
  printf("  objects       : %u\n", desc.num_objects);
  for (uint32_t i = 0; i < desc.num_objects; i++) {
    printf("    [%u] fd=%d size=%u\n", i, desc.objects[i].fd,
           desc.objects[i].size);
    explain_modifier(desc.objects[i].drm_format_modifier);
  }
  printf("  layers        : %u\n", desc.num_layers);
  for (uint32_t i = 0; i < desc.num_layers; i++) {
    print_fourcc("    layer format: ", desc.layers[i].drm_format);
    for (uint32_t p = 0; p < desc.layers[i].num_planes; p++) {
      printf("      plane %u: object=%u offset=%u pitch=%u\n", p,
             desc.layers[i].object_index[p], desc.layers[i].offset[p],
             desc.layers[i].pitch[p]);
    }
  }

  uint64_t modifier = desc.num_objects ? desc.objects[0].drm_format_modifier : 0;
  for (uint32_t i = 0; i < desc.num_objects; i++) close(desc.objects[i].fd);
  vaDestroySurfaces(dpy, &surface, 1);

  // Printed last so it is the line a reader takes away.
  printf("  VERDICT       : %s\n",
         modifier == DRM_FORMAT_MOD_LINEAR
             ? "LINEAR — a Vulkan import needs no modifier gymnastics"
             : "TILED — the Vulkan side must accept this exact modifier");
  return 0;
}

int main(void) {
  int fd = open("/dev/dri/renderD128", O_RDWR);
  if (fd < 0) {
    perror("open /dev/dri/renderD128");
    return 1;
  }

  VADisplay dpy = vaGetDisplayDRM(fd);
  int major, minor;
  VAStatus st = vaInitialize(dpy, &major, &minor);
  if (st != VA_STATUS_SUCCESS) return fail("vaInitialize", st);
  printf("VA-API %d.%d — %s\n", major, minor, vaQueryVendorString(dpy));

  int rc = 0;
  rc |= export_and_report(dpy, "NV12 surface WITH the encoder usage hint (D5's order)",
                          1);
  rc |= export_and_report(dpy, "NV12 surface WITHOUT the hint (control)", 0);

  vaTerminate(dpy);
  close(fd);
  return rc;
}
