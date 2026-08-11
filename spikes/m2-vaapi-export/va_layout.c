// Prints the memory layout of every libva structure the Rust FFI redeclares.
//
// Hand-written `extern "C"` declarations are a silent-corruption hazard: a field
// in the wrong place still compiles, still runs, and returns plausible garbage.
// bindgen would avoid that but adds a build dependency and a libclang to every
// CI machine for about eighty lines of declarations, so the trade taken instead
// is this — measure the layout once, assert it in a Rust test, and regenerate
// with this program if libva ever moves.
//
// Build: gcc va_layout.c -o va_layout $(pkg-config --cflags libva)
// Run:   ./va_layout

#include <stdint.h>
#include <stddef.h>
#include <stdio.h>

#include <va/va.h>
#include <va/va_drmcommon.h>

#define SHOW_SIZE(type) printf("%-40s size=%3zu align=%2zu\n", #type, sizeof(type), _Alignof(type))
#define SHOW_OFFSET(type, field)                                                          \
  printf("  %-38s offset=%3zu\n", #type "." #field, offsetof(type, field))

int main(void)
{
  printf("=== scalars ===\n");
  SHOW_SIZE(VAStatus);
  SHOW_SIZE(VASurfaceID);
  SHOW_SIZE(VAGenericID);
  SHOW_SIZE(VADisplay);

  printf("\n=== VASurfaceAttrib ===\n");
  SHOW_SIZE(VASurfaceAttrib);
  SHOW_OFFSET(VASurfaceAttrib, type);
  SHOW_OFFSET(VASurfaceAttrib, flags);
  SHOW_OFFSET(VASurfaceAttrib, value);
  SHOW_SIZE(VAGenericValue);
  SHOW_OFFSET(VAGenericValue, type);
  SHOW_OFFSET(VAGenericValue, value);

  printf("\n=== VADRMPRIMESurfaceDescriptor ===\n");
  SHOW_SIZE(VADRMPRIMESurfaceDescriptor);
  SHOW_OFFSET(VADRMPRIMESurfaceDescriptor, fourcc);
  SHOW_OFFSET(VADRMPRIMESurfaceDescriptor, width);
  SHOW_OFFSET(VADRMPRIMESurfaceDescriptor, height);
  SHOW_OFFSET(VADRMPRIMESurfaceDescriptor, num_objects);
  SHOW_OFFSET(VADRMPRIMESurfaceDescriptor, objects);
  SHOW_OFFSET(VADRMPRIMESurfaceDescriptor, num_layers);
  SHOW_OFFSET(VADRMPRIMESurfaceDescriptor, layers);
  printf("  objects[0].fd                          offset=%zu\n",
         offsetof(VADRMPRIMESurfaceDescriptor, objects[0].fd));
  printf("  objects[0].size                        offset=%zu\n",
         offsetof(VADRMPRIMESurfaceDescriptor, objects[0].size));
  printf("  objects[0].drm_format_modifier         offset=%zu\n",
         offsetof(VADRMPRIMESurfaceDescriptor, objects[0].drm_format_modifier));
  printf("  objects[1]                             offset=%zu\n",
         offsetof(VADRMPRIMESurfaceDescriptor, objects[1]));
  printf("  layers[0].drm_format                   offset=%zu\n",
         offsetof(VADRMPRIMESurfaceDescriptor, layers[0].drm_format));
  printf("  layers[0].num_planes                   offset=%zu\n",
         offsetof(VADRMPRIMESurfaceDescriptor, layers[0].num_planes));
  printf("  layers[0].object_index                 offset=%zu\n",
         offsetof(VADRMPRIMESurfaceDescriptor, layers[0].object_index));
  printf("  layers[0].offset                       offset=%zu\n",
         offsetof(VADRMPRIMESurfaceDescriptor, layers[0].offset));
  printf("  layers[0].pitch                        offset=%zu\n",
         offsetof(VADRMPRIMESurfaceDescriptor, layers[0].pitch));
  printf("  layers[1]                              offset=%zu\n",
         offsetof(VADRMPRIMESurfaceDescriptor, layers[1]));

  printf("\n=== constants the FFI hard-codes ===\n");
  printf("VA_FOURCC_NV12                         = 0x%08x\n", VA_FOURCC_NV12);
  printf("VA_RT_FORMAT_YUV420                    = 0x%08x\n", VA_RT_FORMAT_YUV420);
  printf("VASurfaceAttribPixelFormat             = %d\n", VASurfaceAttribPixelFormat);
  printf("VASurfaceAttribUsageHint               = %d\n", VASurfaceAttribUsageHint);
  printf("VA_SURFACE_ATTRIB_SETTABLE             = 0x%08x\n", VA_SURFACE_ATTRIB_SETTABLE);
  printf("VA_SURFACE_ATTRIB_USAGE_HINT_ENCODER   = 0x%08x\n",
         VA_SURFACE_ATTRIB_USAGE_HINT_ENCODER);
  printf("VA_SURFACE_ATTRIB_MEM_TYPE_DRM_PRIME_2 = 0x%08x\n",
         VA_SURFACE_ATTRIB_MEM_TYPE_DRM_PRIME_2);
  printf("VA_EXPORT_SURFACE_WRITE_ONLY           = 0x%08x\n", VA_EXPORT_SURFACE_WRITE_ONLY);
  printf("VA_EXPORT_SURFACE_SEPARATE_LAYERS      = 0x%08x\n",
         VA_EXPORT_SURFACE_SEPARATE_LAYERS);
  printf("VAGenericValueTypeInteger              = %d\n", VAGenericValueTypeInteger);
  printf("VA_STATUS_SUCCESS                      = 0x%08x\n", VA_STATUS_SUCCESS);
  return 0;
}
