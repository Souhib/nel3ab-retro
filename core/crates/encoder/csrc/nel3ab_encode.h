// A small, stable C API over libavcodec's VAAPI H.264 encoder.
//
// Why a shim rather than a direct Rust FFI to libavcodec:
//
// The libva structures this crate talks to have a stable ABI and were bound
// directly, with every offset measured and asserted at compile time.
// `AVCodecContext` is a different proposition — hundreds of fields whose layout
// moves between ffmpeg major versions, and Ubuntu will happily upgrade
// libavcodec60 underneath us. Measured offsets would then be silently wrong,
// which is the failure mode this milestone has spent its whole length avoiding.
//
// So the ABI question is answered where it belongs: in C, by the compiler,
// against the real headers. Rust binds to THIS header, whose layout we own.
// The cost is a `cc` build dependency, which is a great deal lighter than the
// libclang that bindgen would want.

#ifndef NEL3AB_ENCODE_H
#define NEL3AB_ENCODE_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/// Opaque encoder handle.
typedef struct n3_encoder n3_encoder;

/// How one plane of an exported surface is laid out.
typedef struct {
  uint32_t drm_format;
  uint32_t offset;
  uint32_t pitch;
} n3_plane;

/// A surface handed out for the shader to write into.
typedef struct {
  /// dma-buf descriptor. The caller owns it and must close it.
  int fd;
  uint32_t width;
  uint32_t height;
  uint32_t fourcc;
  uint64_t modifier;
  uint32_t plane_count;
  n3_plane planes[4];
} n3_surface;

/// What `n3_layout` can be asked about.
///
/// Rust mirrors the two structures above with `#[repr(C)]`, and `#[repr(C)]`
/// promises to follow the platform ABI — not to follow *this compiler's* choices
/// for padding this particular struct. That is a promise worth checking rather
/// than trusting, so the C side can be asked what it actually built.
enum {
  N3_LAYOUT_SURFACE_SIZE = 0,
  N3_LAYOUT_SURFACE_FD = 1,
  N3_LAYOUT_SURFACE_WIDTH = 2,
  N3_LAYOUT_SURFACE_HEIGHT = 3,
  N3_LAYOUT_SURFACE_FOURCC = 4,
  N3_LAYOUT_SURFACE_MODIFIER = 5,
  N3_LAYOUT_SURFACE_PLANE_COUNT = 6,
  N3_LAYOUT_SURFACE_PLANES = 7,
  N3_LAYOUT_PLANE_SIZE = 8,
  N3_LAYOUT_PLANE_FORMAT = 9,
  N3_LAYOUT_PLANE_OFFSET = 10,
  N3_LAYOUT_PLANE_PITCH = 11,
};

/// Reports a real size or offset, so Rust can assert its mirror is honest.
/// Returns `(size_t)-1` for a question it does not know.
size_t n3_layout(int what);

/// Every way this can fail. Negative values only, so a byte count can share the
/// return type where that reads better.
enum {
  N3_OK = 0,
  N3_ERR_DEVICE = -1,      /* the render node or VA device would not open */
  N3_ERR_POOL = -2,        /* the frame pool would not initialise */
  N3_ERR_NO_ENCODER = -3,  /* libavcodec has no h264_vaapi */
  N3_ERR_OPEN = -4,        /* avcodec_open2 refused the settings */
  N3_ERR_EXPORT = -5,      /* the surface would not export as a dma-buf */
  N3_ERR_ENCODE = -6,      /* send_frame or receive_packet failed */
  N3_ERR_RANGE = -7,       /* a slot index outside the pool */
  N3_ERR_ALLOC = -8,
};

/// Opens an encoder on a DRM render node.
///
/// `qp` is the constant quantiser; `fps` only sets the stream's declared timing.
/// `slots` is how many surfaces the pool holds — the same rotation the frame
/// export uses, for the same reason.
///
/// Returns NULL on failure and writes the reason to `error` when it is non-NULL.
n3_encoder *n3_encoder_open(const char *render_node, uint32_t width, uint32_t height,
                            uint32_t qp, uint32_t fps, uint32_t slots, int *error);

/// How many surfaces the pool holds.
uint32_t n3_encoder_slots(const n3_encoder *encoder);

/// Exports one pooled surface so a Vulkan shader can write NV12 into it.
///
/// The caller owns `out->fd` and must close it. Exporting the same slot twice
/// yields two descriptors for the same buffer, which is legal and wasteful.
int n3_encoder_export(n3_encoder *encoder, uint32_t slot, n3_surface *out);

/// Encodes the frame currently in `slot`.
///
/// On success returns the byte count and points `data` at a buffer owned by the
/// encoder, valid until the next call to this function. Zero means the encoder
/// accepted the frame but has not produced a packet yet.
long n3_encoder_encode(n3_encoder *encoder, uint32_t slot, const uint8_t **data);

/// Makes the next encoded frame an IDR.
///
/// A viewer joining mid-stream can decode nothing until a key frame arrives, and
/// with a one-second GOP that is up to a second of blank screen. Asking for one
/// on demand costs a larger packet once instead.
void n3_encoder_force_key(n3_encoder *encoder);

/// Frees everything.
void n3_encoder_close(n3_encoder *encoder);

#ifdef __cplusplus
}
#endif

#endif /* NEL3AB_ENCODE_H */
