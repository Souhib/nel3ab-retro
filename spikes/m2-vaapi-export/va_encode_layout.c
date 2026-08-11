// Measures the encode structures the Rust FFI redeclares, bitfields included.
//
// The layout probe for the surface structs (`va_layout.c`) only had to get sizes
// and offsets right. These have C **bitfields**, whose allocation order within
// the storage unit is implementation-defined — so "chroma_format_idc is the low
// two bits" is an assumption, not a fact, and a wrong one produces a driver that
// encodes monochrome while every call returns success.
//
// So each bitfield is set alone and the whole word printed. That turns the shift
// and mask into measurements the Rust side can assert against.
//
// Build: gcc va_encode_layout.c -o va_encode_layout $(pkg-config --cflags libva)
// Run:   ./va_encode_layout

#include <stdint.h>
#include <stddef.h>
#include <stdio.h>
#include <string.h>

#include <va/va.h>
#include <va/va_enc_h264.h>

#define SHOW_SIZE(type) printf("%-42s size=%4zu align=%2zu\n", #type, sizeof(type), _Alignof(type))
#define SHOW_OFFSET(type, field)                                                          \
  printf("  %-40s offset=%4zu\n", #field, offsetof(type, field))

// Sets one bitfield to all-ones and prints the storage word, which gives its
// shift and width without trusting any convention.
#define PROBE_SEQ(field)                                                                  \
  do {                                                                                    \
    VAEncSequenceParameterBufferH264 s;                                                    \
    memset(&s, 0, sizeof(s));                                                              \
    s.seq_fields.bits.field = ~0u;                                                         \
    printf("  seq_fields.%-38s = 0x%08x\n", #field, s.seq_fields.value);                   \
  } while (0)

#define PROBE_PIC(field)                                                                  \
  do {                                                                                    \
    VAEncPictureParameterBufferH264 p;                                                     \
    memset(&p, 0, sizeof(p));                                                              \
    p.pic_fields.bits.field = ~0u;                                                         \
    printf("  pic_fields.%-38s = 0x%08x\n", #field, p.pic_fields.value);                   \
  } while (0)

int main(void)
{
  printf("=== sizes ===\n");
  SHOW_SIZE(VAPictureH264);
  SHOW_SIZE(VAEncSequenceParameterBufferH264);
  SHOW_SIZE(VAEncPictureParameterBufferH264);
  SHOW_SIZE(VAEncSliceParameterBufferH264);
  SHOW_SIZE(VAEncPackedHeaderParameterBuffer);
  SHOW_SIZE(VAEncMiscParameterBuffer);
  SHOW_SIZE(VAEncMiscParameterRateControl);
  SHOW_SIZE(VACodedBufferSegment);

  printf("\n=== VAPictureH264 ===\n");
  SHOW_OFFSET(VAPictureH264, picture_id);
  SHOW_OFFSET(VAPictureH264, frame_idx);
  SHOW_OFFSET(VAPictureH264, flags);
  SHOW_OFFSET(VAPictureH264, TopFieldOrderCnt);
  SHOW_OFFSET(VAPictureH264, BottomFieldOrderCnt);

  printf("\n=== VAEncSequenceParameterBufferH264 ===\n");
  SHOW_OFFSET(VAEncSequenceParameterBufferH264, seq_parameter_set_id);
  SHOW_OFFSET(VAEncSequenceParameterBufferH264, level_idc);
  SHOW_OFFSET(VAEncSequenceParameterBufferH264, intra_period);
  SHOW_OFFSET(VAEncSequenceParameterBufferH264, intra_idr_period);
  SHOW_OFFSET(VAEncSequenceParameterBufferH264, ip_period);
  SHOW_OFFSET(VAEncSequenceParameterBufferH264, bits_per_second);
  SHOW_OFFSET(VAEncSequenceParameterBufferH264, max_num_ref_frames);
  SHOW_OFFSET(VAEncSequenceParameterBufferH264, picture_width_in_mbs);
  SHOW_OFFSET(VAEncSequenceParameterBufferH264, picture_height_in_mbs);
  SHOW_OFFSET(VAEncSequenceParameterBufferH264, seq_fields);
  SHOW_OFFSET(VAEncSequenceParameterBufferH264, frame_cropping_flag);
  SHOW_OFFSET(VAEncSequenceParameterBufferH264, vui_parameters_present_flag);
  printf("  bitfields:\n");
  PROBE_SEQ(chroma_format_idc);
  PROBE_SEQ(frame_mbs_only_flag);
  PROBE_SEQ(mb_adaptive_frame_field_flag);
  PROBE_SEQ(seq_scaling_matrix_present_flag);
  PROBE_SEQ(direct_8x8_inference_flag);
  PROBE_SEQ(log2_max_frame_num_minus4);
  PROBE_SEQ(pic_order_cnt_type);
  PROBE_SEQ(log2_max_pic_order_cnt_lsb_minus4);

  printf("\n=== VAEncPictureParameterBufferH264 ===\n");
  SHOW_OFFSET(VAEncPictureParameterBufferH264, CurrPic);
  SHOW_OFFSET(VAEncPictureParameterBufferH264, ReferenceFrames);
  SHOW_OFFSET(VAEncPictureParameterBufferH264, coded_buf);
  SHOW_OFFSET(VAEncPictureParameterBufferH264, pic_parameter_set_id);
  SHOW_OFFSET(VAEncPictureParameterBufferH264, seq_parameter_set_id);
  SHOW_OFFSET(VAEncPictureParameterBufferH264, last_picture);
  SHOW_OFFSET(VAEncPictureParameterBufferH264, frame_num);
  SHOW_OFFSET(VAEncPictureParameterBufferH264, pic_init_qp);
  SHOW_OFFSET(VAEncPictureParameterBufferH264, num_ref_idx_l0_active_minus1);
  SHOW_OFFSET(VAEncPictureParameterBufferH264, pic_fields);
  printf("  bitfields:\n");
  PROBE_PIC(idr_pic_flag);
  PROBE_PIC(reference_pic_flag);
  PROBE_PIC(entropy_coding_mode_flag);
  PROBE_PIC(weighted_pred_flag);
  PROBE_PIC(transform_8x8_mode_flag);
  PROBE_PIC(deblocking_filter_control_present_flag);

  printf("\n=== VAEncSliceParameterBufferH264 ===\n");
  SHOW_OFFSET(VAEncSliceParameterBufferH264, macroblock_address);
  SHOW_OFFSET(VAEncSliceParameterBufferH264, num_macroblocks);
  SHOW_OFFSET(VAEncSliceParameterBufferH264, macroblock_info);
  SHOW_OFFSET(VAEncSliceParameterBufferH264, slice_type);
  SHOW_OFFSET(VAEncSliceParameterBufferH264, pic_parameter_set_id);
  SHOW_OFFSET(VAEncSliceParameterBufferH264, idr_pic_id);
  SHOW_OFFSET(VAEncSliceParameterBufferH264, pic_order_cnt_lsb);
  SHOW_OFFSET(VAEncSliceParameterBufferH264, RefPicList0);
  SHOW_OFFSET(VAEncSliceParameterBufferH264, RefPicList1);
  SHOW_OFFSET(VAEncSliceParameterBufferH264, slice_qp_delta);
  SHOW_OFFSET(VAEncSliceParameterBufferH264, disable_deblocking_filter_idc);

  printf("\n=== VAEncPackedHeaderParameterBuffer ===\n");
  SHOW_OFFSET(VAEncPackedHeaderParameterBuffer, type);
  SHOW_OFFSET(VAEncPackedHeaderParameterBuffer, bit_length);
  SHOW_OFFSET(VAEncPackedHeaderParameterBuffer, has_emulation_bytes);

  printf("\n=== VACodedBufferSegment ===\n");
  SHOW_OFFSET(VACodedBufferSegment, size);
  SHOW_OFFSET(VACodedBufferSegment, bit_offset);
  SHOW_OFFSET(VACodedBufferSegment, status);
  SHOW_OFFSET(VACodedBufferSegment, buf);
  SHOW_OFFSET(VACodedBufferSegment, next);

  printf("\n=== constants ===\n");
  printf("VAProfileH264ConstrainedBaseline    = %d\n", VAProfileH264ConstrainedBaseline);
  printf("VAProfileH264Main                   = %d\n", VAProfileH264Main);
  printf("VAEntrypointEncSlice                = %d\n", VAEntrypointEncSlice);
  printf("VAConfigAttribRTFormat              = %d\n", VAConfigAttribRTFormat);
  printf("VAConfigAttribRateControl           = %d\n", VAConfigAttribRateControl);
  printf("VAConfigAttribEncPackedHeaders      = %d\n", VAConfigAttribEncPackedHeaders);
  printf("VA_RC_CQP                           = 0x%x\n", VA_RC_CQP);
  printf("VA_ENC_PACKED_HEADER_SEQUENCE       = 0x%x\n", VA_ENC_PACKED_HEADER_SEQUENCE);
  printf("VA_ENC_PACKED_HEADER_PICTURE        = 0x%x\n", VA_ENC_PACKED_HEADER_PICTURE);
  printf("VA_ENC_PACKED_HEADER_SLICE          = 0x%x\n", VA_ENC_PACKED_HEADER_SLICE);
  printf("VAEncPackedHeaderSequence           = %d\n", VAEncPackedHeaderSequence);
  printf("VAEncPackedHeaderPicture            = %d\n", VAEncPackedHeaderPicture);
  printf("VAEncPackedHeaderSlice              = %d\n", VAEncPackedHeaderSlice);
  printf("VAEncSequenceParameterBufferType    = %d\n", VAEncSequenceParameterBufferType);
  printf("VAEncPictureParameterBufferType     = %d\n", VAEncPictureParameterBufferType);
  printf("VAEncSliceParameterBufferType       = %d\n", VAEncSliceParameterBufferType);
  printf("VAEncPackedHeaderParameterBufferType= %d\n", VAEncPackedHeaderParameterBufferType);
  printf("VAEncPackedHeaderDataBufferType     = %d\n", VAEncPackedHeaderDataBufferType);
  printf("VAEncCodedBufferType                = %d\n", VAEncCodedBufferType);
  printf("VA_PROGRESSIVE                      = 0x%x\n", VA_PROGRESSIVE);
  printf("VA_INVALID_ID                       = 0x%x\n", VA_INVALID_ID);
  printf("VA_PICTURE_H264_INVALID             = 0x%x\n", VA_PICTURE_H264_INVALID);
  return 0;
}
