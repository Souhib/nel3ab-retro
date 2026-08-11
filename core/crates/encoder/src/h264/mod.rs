//! The H.264 headers the driver will not write for us.
//!
//! Traced from `ffmpeg`'s own libva calls (`LIBVA_TRACE`): radeonsi requests
//! nothing and synthesises nothing, so an encoder has to hand it a packed
//! sequence header carrying SPS and PPS, and a packed slice header on every
//! frame.
//!
//! # How this is pinned
//!
//! Against **ffmpeg's bytes**, not against our own reader. The golden vectors in
//! the tests are the exact SPS and PPS ffmpeg produced for a 640x480 stream on
//! this machine, with every field value taken from `-bsf:v trace_headers`. A
//! writer checked only against its own parser proves consistency, which is
//! precisely the property that does not matter when the other end is a decoder
//! nobody here wrote.

pub mod bitstream;

use bitstream::{BitWriter, to_nal_unit};

/// Colour signalling for the VUI.
///
/// Worth carrying rather than omitting: the compute shader converts with BT.709
/// limited range, and a decoder told nothing will often assume BT.601. The
/// result is a picture that looks *almost* right — the exact failure the shader's
/// own tests were written to catch, and it would be a shame to reintroduce it one
/// layer up.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ColourDescription {
    /// `colour_primaries`; 1 is BT.709.
    pub primaries: u8,
    /// `transfer_characteristics`; 1 is BT.709.
    pub transfer: u8,
    /// `matrix_coefficients`; 1 is BT.709.
    pub matrix: u8,
    /// `video_full_range_flag`; false is the limited range the shader writes.
    pub full_range: bool,
}

impl ColourDescription {
    /// BT.709, limited range — what [`crate`]'s shader produces.
    pub const BT709_LIMITED: Self = Self {
        primaries: 1,
        transfer: 1,
        matrix: 1,
        full_range: false,
    };
}

/// The VUI's `bitstream_restriction` block.
///
/// Worth writing rather than omitting, and not for conformance: setting
/// `max_num_reorder_frames` and `max_dec_frame_buffering` to zero tells a decoder
/// that no picture ever arrives out of order, so it may output each frame the
/// moment it decodes one instead of holding a reordering buffer. On a stream
/// whose whole point is latency, that is a frame or more given away by silence.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BitstreamRestriction {
    /// `motion_vectors_over_pic_boundaries_flag`.
    pub motion_vectors_over_pic_boundaries: bool,
    /// `log2_max_mv_length_horizontal`.
    pub log2_max_mv_length_horizontal: u32,
    /// `log2_max_mv_length_vertical`.
    pub log2_max_mv_length_vertical: u32,
    /// `max_num_reorder_frames`; zero means "never reordered".
    pub max_num_reorder_frames: u32,
    /// `max_dec_frame_buffering`.
    pub max_dec_frame_buffering: u32,
}

impl BitstreamRestriction {
    /// What a latency-critical stream should say: nothing is ever reordered, so
    /// output each frame as soon as it decodes.
    pub const NO_REORDERING: Self = Self {
        motion_vectors_over_pic_boundaries: true,
        log2_max_mv_length_horizontal: 16,
        log2_max_mv_length_vertical: 16,
        max_num_reorder_frames: 0,
        max_dec_frame_buffering: 0,
    };
}

/// Everything the sequence parameter set needs.
#[derive(Debug, Clone, Copy)]
pub struct SpsParams {
    /// `profile_idc`; 100 is High, 77 Main, 66 Baseline.
    pub profile_idc: u8,
    /// The six `constraint_setN_flag` bits, most significant first.
    pub constraint_flags: u8,
    /// `level_idc`, ten times the level number.
    pub level_idc: u8,
    /// `seq_parameter_set_id`.
    pub seq_parameter_set_id: u32,
    /// `log2_max_frame_num_minus4`.
    pub log2_max_frame_num_minus4: u32,
    /// `log2_max_pic_order_cnt_lsb_minus4`.
    pub log2_max_pic_order_cnt_lsb_minus4: u32,
    /// `max_num_ref_frames`.
    pub max_num_ref_frames: u32,
    /// Width in macroblocks.
    pub width_in_mbs: u32,
    /// Height in macroblocks.
    pub height_in_mbs: u32,
    /// `aspect_ratio_idc`, or `None` to omit the aspect ratio entirely.
    pub aspect_ratio_idc: Option<u8>,
    /// `video_format`, or `None` to omit the video signal type.
    pub video_format: Option<u8>,
    /// Colour signalling, if any.
    pub colour: Option<ColourDescription>,
    /// `(num_units_in_tick, time_scale)`, or `None` to omit timing info.
    ///
    /// The frame rate is `time_scale / (2 * num_units_in_tick)`, so 60 fps is
    /// `(1, 120)` and ffmpeg's 30 fps output is `(1, 60)`.
    pub timing: Option<(u32, u32)>,
    /// Decoder hints, chiefly the reordering promise.
    pub restriction: Option<BitstreamRestriction>,
}

/// Writes the sequence parameter set as a complete NAL unit.
#[must_use]
pub fn build_sps(params: &SpsParams) -> Vec<u8> {
    let mut w = BitWriter::new();
    w.put_bits(u32::from(params.profile_idc), 8);
    w.put_bits(u32::from(params.constraint_flags), 6);
    w.put_bits(0, 2); // reserved_zero_2bits
    w.put_bits(u32::from(params.level_idc), 8);
    w.put_ue(params.seq_parameter_set_id);

    // High and above carry the chroma format explicitly. Below that it is
    // implicitly 4:2:0 and writing these fields would desynchronise the whole
    // header.
    if matches!(
        params.profile_idc,
        100 | 110 | 122 | 244 | 44 | 83 | 86 | 118 | 128
    ) {
        w.put_ue(1); // chroma_format_idc: 4:2:0
        w.put_ue(0); // bit_depth_luma_minus8
        w.put_ue(0); // bit_depth_chroma_minus8
        w.put_flag(false); // qpprime_y_zero_transform_bypass_flag
        w.put_flag(false); // seq_scaling_matrix_present_flag
    }

    w.put_ue(params.log2_max_frame_num_minus4);
    w.put_ue(0); // pic_order_cnt_type
    w.put_ue(params.log2_max_pic_order_cnt_lsb_minus4);
    w.put_ue(params.max_num_ref_frames);
    w.put_flag(false); // gaps_in_frame_num_value_allowed_flag
    w.put_ue(params.width_in_mbs.saturating_sub(1));
    w.put_ue(params.height_in_mbs.saturating_sub(1));
    w.put_flag(true); // frame_mbs_only_flag
    w.put_flag(true); // direct_8x8_inference_flag
    w.put_flag(false); // frame_cropping_flag

    let has_vui = params.aspect_ratio_idc.is_some()
        || params.video_format.is_some()
        || params.colour.is_some()
        || params.timing.is_some()
        || params.restriction.is_some();
    w.put_flag(has_vui);
    if has_vui {
        w.put_flag(params.aspect_ratio_idc.is_some());
        if let Some(idc) = params.aspect_ratio_idc {
            w.put_bits(u32::from(idc), 8);
        }
        w.put_flag(false); // overscan_info_present_flag

        let signal = params.video_format.is_some() || params.colour.is_some();
        w.put_flag(signal);
        if signal {
            // 5 is "unspecified", which is what a stream says when it is not
            // claiming to be broadcast video of a particular kind.
            w.put_bits(u32::from(params.video_format.unwrap_or(5)), 3);
            w.put_flag(params.colour.is_some_and(|c| c.full_range));
            w.put_flag(params.colour.is_some());
            if let Some(colour) = params.colour {
                w.put_bits(u32::from(colour.primaries), 8);
                w.put_bits(u32::from(colour.transfer), 8);
                w.put_bits(u32::from(colour.matrix), 8);
            }
        }

        w.put_flag(false); // chroma_loc_info_present_flag
        w.put_flag(params.timing.is_some());
        if let Some((num_units_in_tick, time_scale)) = params.timing {
            w.put_bits(num_units_in_tick, 32);
            w.put_bits(time_scale, 32);
            w.put_flag(true); // fixed_frame_rate_flag
        }
        w.put_flag(false); // nal_hrd_parameters_present_flag
        w.put_flag(false); // vcl_hrd_parameters_present_flag
        w.put_flag(false); // pic_struct_present_flag
        w.put_flag(params.restriction.is_some());
        if let Some(r) = params.restriction {
            w.put_flag(r.motion_vectors_over_pic_boundaries);
            w.put_ue(0); // max_bytes_per_pic_denom
            w.put_ue(0); // max_bits_per_mb_denom
            w.put_ue(r.log2_max_mv_length_horizontal);
            w.put_ue(r.log2_max_mv_length_vertical);
            w.put_ue(r.max_num_reorder_frames);
            w.put_ue(r.max_dec_frame_buffering);
        }
    }

    w.put_rbsp_trailing_bits();
    to_nal_unit(3, 7, &w.finish())
}

/// Everything the picture parameter set needs.
#[derive(Debug, Clone, Copy)]
pub struct PpsParams {
    /// `pic_parameter_set_id`.
    pub pic_parameter_set_id: u32,
    /// `seq_parameter_set_id`.
    pub seq_parameter_set_id: u32,
    /// CABAC when true, CAVLC when false. Baseline has no CABAC.
    pub entropy_coding_mode: bool,
    /// `pic_init_qp_minus26`.
    pub pic_init_qp_minus26: i32,
    /// `deblocking_filter_control_present_flag`.
    pub deblocking_filter_control_present: bool,
    /// The High-profile extension, or `None` to end the PPS early.
    ///
    /// Its presence is decided by `more_rbsp_data()`, so it is genuinely
    /// optional — but a High-profile stream that omits it loses 8x8 transforms,
    /// and ffmpeg always writes it.
    pub transform_8x8_mode: Option<bool>,
}

/// Writes the picture parameter set as a complete NAL unit.
#[must_use]
pub fn build_pps(params: &PpsParams) -> Vec<u8> {
    let mut w = BitWriter::new();
    w.put_ue(params.pic_parameter_set_id);
    w.put_ue(params.seq_parameter_set_id);
    w.put_flag(params.entropy_coding_mode);
    w.put_flag(false); // bottom_field_pic_order_in_frame_present_flag
    w.put_ue(0); // num_slice_groups_minus1
    w.put_ue(0); // num_ref_idx_l0_default_active_minus1
    w.put_ue(0); // num_ref_idx_l1_default_active_minus1
    w.put_flag(false); // weighted_pred_flag
    w.put_bits(0, 2); // weighted_bipred_idc
    w.put_se(params.pic_init_qp_minus26);
    w.put_se(0); // pic_init_qs_minus26
    w.put_se(0); // chroma_qp_index_offset
    w.put_flag(params.deblocking_filter_control_present);
    w.put_flag(false); // constrained_intra_pred_flag
    w.put_flag(false); // redundant_pic_cnt_present_flag
    if let Some(transform_8x8) = params.transform_8x8_mode {
        w.put_flag(transform_8x8);
        w.put_flag(false); // pic_scaling_matrix_present_flag
        w.put_se(0); // second_chroma_qp_index_offset
    }
    w.put_rbsp_trailing_bits();
    to_nal_unit(3, 8, &w.finish())
}

/// Everything an I or IDR slice header needs.
///
/// **I and IDR only.** A P slice adds reference-list handling and
/// `dec_ref_pic_marking`, and writing those wrong desynchronises the slice data
/// that follows — so they are absent rather than half-written. An all-intra
/// stream is wasteful of bitrate and is the right first step regardless: it has
/// no reference state to get wrong.
#[derive(Debug, Clone, Copy)]
pub struct SliceHeaderParams {
    /// First macroblock of this slice.
    pub first_mb_in_slice: u32,
    /// True for an IDR, which changes the NAL type and adds two flags.
    pub idr: bool,
    /// `idr_pic_id`, ignored unless `idr`.
    pub idr_pic_id: u32,
    /// `pic_parameter_set_id`.
    pub pic_parameter_set_id: u32,
    /// `frame_num`, written in `log2_max_frame_num_minus4 + 4` bits.
    pub frame_num: u32,
    /// Must match the SPS, or the field is read at the wrong width and
    /// everything after it shifts.
    pub log2_max_frame_num_minus4: u32,
    /// `pic_order_cnt_lsb`.
    pub pic_order_cnt_lsb: u32,
    /// Must match the SPS, for the same reason.
    pub log2_max_pic_order_cnt_lsb_minus4: u32,
    /// `slice_qp_delta`, relative to the PPS's `pic_init_qp`.
    pub slice_qp_delta: i32,
    /// True when the PPS selected CABAC, which pads the header to a byte
    /// boundary with one bits.
    pub entropy_coding_mode: bool,
}

/// Writes an I or IDR slice header as a NAL unit.
///
/// The result is deliberately **not** terminated with `rbsp_trailing_bits`: the
/// encoder continues this same bitstream with the slice data, so the header ends
/// mid-byte unless CABAC alignment fills it. The returned bit length is what the
/// driver must be told; the final byte's spare bits are padding it will overwrite.
#[must_use]
pub fn build_slice_header(params: &SliceHeaderParams) -> (Vec<u8>, usize) {
    let mut w = BitWriter::new();
    w.put_ue(params.first_mb_in_slice);
    // 7 is "I, and every slice in this picture is I", which lets a decoder skip
    // reference handling entirely.
    w.put_ue(7);
    w.put_ue(params.pic_parameter_set_id);
    w.put_bits(params.frame_num, params.log2_max_frame_num_minus4 + 4);
    if params.idr {
        w.put_ue(params.idr_pic_id);
    }
    w.put_bits(
        params.pic_order_cnt_lsb,
        params.log2_max_pic_order_cnt_lsb_minus4 + 4,
    );
    if params.idr {
        w.put_flag(false); // no_output_of_prior_pics_flag
        w.put_flag(false); // long_term_reference_flag
    }
    w.put_se(params.slice_qp_delta);
    if params.entropy_coding_mode {
        // cabac_alignment_one_bit: ones, not zeros, to the byte boundary.
        while !w.bit_length().is_multiple_of(8) {
            w.put_flag(true);
        }
    }

    let payload_bits = w.bit_length();
    let nal = to_nal_unit(3, if params.idr { 5 } else { 1 }, &w.finish());
    (nal, payload_bits + 8)
}

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    clippy::expect_used,
    reason = "a panic IS the failure signal in a test"
)]
mod tests {
    use super::*;

    /// Exactly what ffmpeg emitted for a 640x480 30 fps stream on the RX 6650 XT,
    /// captured with `-bsf:v trace_headers` for the field values and read out of
    /// the elementary stream for the bytes. Note `00 00 03 00` near the end —
    /// a real emulation-prevention insertion, not a synthetic one.
    const FFMPEG_SPS: &[u8] = &[
        0x67, 0x64, 0x08, 0x1e, 0xac, 0x2c, 0xac, 0x0a, 0x03, 0xdb, 0x01, 0x68, 0x80, 0x00, 0x00,
        0x03, 0x00, 0x80, 0x00, 0x00, 0x1e, 0x47, 0x84, 0x42, 0x29, 0xc0,
    ];
    const FFMPEG_PPS: &[u8] = &[0x68, 0xee, 0x38, 0x30];

    /// The same stream asked for BT.709 limited range, which is what our shader
    /// produces. Colour signalling is the one VUI field this project cannot
    /// afford to get wrong, so it gets its own vector rather than an assertion
    /// about our own output.
    const FFMPEG_SPS_BT709: &[u8] = &[
        0x67, 0x64, 0x08, 0x1e, 0xac, 0x2c, 0xac, 0x0a, 0x03, 0xdb, 0x01, 0x6a, 0x02, 0x02, 0x02,
        0x80, 0x00, 0x00, 0x03, 0x00, 0x80, 0x00, 0x00, 0x1e, 0x47, 0x84, 0x42, 0x29, 0xc0,
    ];

    #[test]
    fn the_sps_is_byte_identical_to_ffmpegs() {
        // The strongest check available without a decoder: same parameters, same
        // bytes, against an implementation nobody here wrote.
        let params = SpsParams {
            profile_idc: 100,
            // set0..set5, most significant first: only constraint_set4_flag.
            constraint_flags: 0b00_0010,
            level_idc: 30,
            seq_parameter_set_id: 0,
            log2_max_frame_num_minus4: 4,
            log2_max_pic_order_cnt_lsb_minus4: 4,
            max_num_ref_frames: 2,
            width_in_mbs: 40,
            height_in_mbs: 30,
            aspect_ratio_idc: Some(1),
            video_format: Some(5),
            colour: None,
            timing: Some((1, 60)),
            restriction: Some(BitstreamRestriction {
                motion_vectors_over_pic_boundaries: true,
                log2_max_mv_length_horizontal: 16,
                log2_max_mv_length_vertical: 16,
                max_num_reorder_frames: 1,
                max_dec_frame_buffering: 2,
            }),
        };
        assert_eq!(build_sps(&params), FFMPEG_SPS);
    }

    #[test]
    fn the_pps_is_byte_identical_to_ffmpegs() {
        let params = PpsParams {
            pic_parameter_set_id: 0,
            seq_parameter_set_id: 0,
            entropy_coding_mode: true,
            pic_init_qp_minus26: 0,
            deblocking_filter_control_present: false,
            transform_8x8_mode: Some(false),
        };
        assert_eq!(build_pps(&params), FFMPEG_PPS);
    }

    /// Negative twin of the two above: identical output for the right parameters
    /// is worthless if the writer also produces it for the wrong ones.
    #[test]
    fn changing_any_parameter_changes_the_bytes() {
        let base = SpsParams {
            profile_idc: 100,
            constraint_flags: 0b00_0010,
            level_idc: 30,
            seq_parameter_set_id: 0,
            log2_max_frame_num_minus4: 4,
            log2_max_pic_order_cnt_lsb_minus4: 4,
            max_num_ref_frames: 2,
            width_in_mbs: 40,
            height_in_mbs: 30,
            aspect_ratio_idc: Some(1),
            video_format: Some(5),
            colour: None,
            timing: Some((1, 60)),
            restriction: None,
        };
        let reference = build_sps(&base);

        let mut level = base;
        level.level_idc = 41;
        assert_ne!(build_sps(&level), reference, "level_idc");

        let mut size = base;
        size.width_in_mbs = 120;
        assert_ne!(build_sps(&size), reference, "width");

        let mut refs = base;
        refs.max_num_ref_frames = 1;
        assert_ne!(build_sps(&refs), reference, "max_num_ref_frames");

        let mut colour = base;
        colour.colour = Some(ColourDescription::BT709_LIMITED);
        assert_ne!(build_sps(&colour), reference, "colour description");
    }

    #[test]
    fn only_high_profiles_carry_the_chroma_format_fields() {
        // Writing those five elements below High desynchronises everything after
        // them, and a decoder reports a corrupt stream rather than a wrong field.
        //
        // Comparing a Baseline SPS against a High one would prove nothing — the
        // profile byte differs anyway. So compare two profiles that are BOTH
        // below High: they must come out the same length and differ in exactly
        // the one byte that carries profile_idc.
        let mut params = SpsParams {
            profile_idc: 66,
            constraint_flags: 0,
            level_idc: 30,
            seq_parameter_set_id: 0,
            log2_max_frame_num_minus4: 4,
            log2_max_pic_order_cnt_lsb_minus4: 4,
            max_num_ref_frames: 1,
            width_in_mbs: 40,
            height_in_mbs: 30,
            aspect_ratio_idc: None,
            video_format: None,
            colour: None,
            timing: None,
            restriction: None,
        };
        let baseline = build_sps(&params);
        params.profile_idc = 77;
        let main = build_sps(&params);
        assert_eq!(baseline.len(), main.len());
        let differing = baseline.iter().zip(&main).filter(|(a, b)| a != b).count();
        assert_eq!(differing, 1, "only profile_idc should differ");

        // The other direction — that High DOES write them — is not asserted here
        // on length: the five elements are seven bits and need not cross a byte
        // boundary. It is covered exactly, by the two golden tests above, which
        // reproduce a profile-100 SPS byte for byte.
    }

    #[test]
    fn bt709_limited_signalling_is_byte_identical_to_ffmpegs() {
        // The one VUI field the product cannot afford to be wrong about: the
        // shader converts with BT.709 limited range, and a decoder told nothing
        // often assumes BT.601. The result looks *almost* right — the same
        // failure the shader's own tests exist to catch, reintroduced one layer
        // up. Pinned against ffmpeg asked for the same thing.
        let params = SpsParams {
            profile_idc: 100,
            constraint_flags: 0b00_0010,
            level_idc: 30,
            seq_parameter_set_id: 0,
            log2_max_frame_num_minus4: 4,
            log2_max_pic_order_cnt_lsb_minus4: 4,
            max_num_ref_frames: 2,
            width_in_mbs: 40,
            height_in_mbs: 30,
            aspect_ratio_idc: Some(1),
            video_format: Some(5),
            colour: Some(ColourDescription::BT709_LIMITED),
            timing: Some((1, 60)),
            restriction: Some(BitstreamRestriction {
                motion_vectors_over_pic_boundaries: true,
                log2_max_mv_length_horizontal: 16,
                log2_max_mv_length_vertical: 16,
                max_num_reorder_frames: 1,
                max_dec_frame_buffering: 2,
            }),
        };
        assert_eq!(build_sps(&params), FFMPEG_SPS_BT709);

        // Negative twin: dropping the colour description must change the bytes,
        // or the field was never written in the first place.
        let mut without = params;
        without.colour = None;
        assert_ne!(build_sps(&without), FFMPEG_SPS_BT709);
    }

    #[test]
    fn the_idr_slice_header_is_byte_identical_to_ffmpegs() {
        // ffmpeg's first slice, read out of the elementary stream. Its 8-bit
        // frame_num and pic_order_cnt_lsb come from the SPS above, and getting
        // either width wrong shifts every field after it — which is why they are
        // parameters here rather than constants.
        let params = SliceHeaderParams {
            first_mb_in_slice: 0,
            idr: true,
            idr_pic_id: 0,
            pic_parameter_set_id: 0,
            frame_num: 0,
            log2_max_frame_num_minus4: 4,
            pic_order_cnt_lsb: 0,
            log2_max_pic_order_cnt_lsb_minus4: 4,
            slice_qp_delta: -6,
            entropy_coding_mode: true,
        };
        let (nal, bits) = build_slice_header(&params);
        assert_eq!(nal, vec![0x65, 0x88, 0x80, 0x40, 0x01, 0xbf]);
        assert_eq!(
            bits, 48,
            "the driver is told the length, not the byte count"
        );
    }

    #[test]
    fn the_field_widths_come_from_the_sps_and_matter() {
        // Negative twin: a header that ignored the SPS widths would produce the
        // same bytes for different widths, and a decoder would read every later
        // field from the wrong place.
        let base = SliceHeaderParams {
            first_mb_in_slice: 0,
            idr: true,
            idr_pic_id: 0,
            pic_parameter_set_id: 0,
            frame_num: 0,
            log2_max_frame_num_minus4: 4,
            pic_order_cnt_lsb: 0,
            log2_max_pic_order_cnt_lsb_minus4: 4,
            slice_qp_delta: -6,
            entropy_coding_mode: true,
        };
        let mut narrower = base;
        narrower.log2_max_frame_num_minus4 = 0;
        assert_ne!(build_slice_header(&narrower).1, build_slice_header(&base).1);

        let mut poc = base;
        poc.log2_max_pic_order_cnt_lsb_minus4 = 0;
        assert_ne!(build_slice_header(&poc).1, build_slice_header(&base).1);
    }

    #[test]
    fn cavlc_leaves_the_header_unaligned() {
        // The alignment ones exist only for CABAC. Adding them under CAVLC would
        // insert bits the decoder reads as slice data.
        let params = SliceHeaderParams {
            first_mb_in_slice: 0,
            idr: true,
            idr_pic_id: 0,
            pic_parameter_set_id: 0,
            frame_num: 0,
            log2_max_frame_num_minus4: 4,
            pic_order_cnt_lsb: 0,
            log2_max_pic_order_cnt_lsb_minus4: 4,
            slice_qp_delta: -6,
            entropy_coding_mode: false,
        };
        let (_, bits) = build_slice_header(&params);
        assert_eq!(bits, 43, "43 bits of syntax, no padding");
        assert_ne!(bits % 8, 0);
    }

    #[test]
    fn promising_no_reordering_changes_the_stream() {
        // max_num_reorder_frames = 0 is what lets a decoder emit each frame as it
        // arrives. If the field were not actually written, this would pass by
        // being identical.
        let base = SpsParams {
            profile_idc: 100,
            constraint_flags: 0,
            level_idc: 41,
            seq_parameter_set_id: 0,
            log2_max_frame_num_minus4: 0,
            log2_max_pic_order_cnt_lsb_minus4: 2,
            max_num_ref_frames: 1,
            width_in_mbs: 40,
            height_in_mbs: 30,
            aspect_ratio_idc: None,
            video_format: None,
            colour: Some(ColourDescription::BT709_LIMITED),
            timing: Some((1, 120)),
            restriction: Some(BitstreamRestriction::NO_REORDERING),
        };
        let mut reordering = base;
        reordering.restriction = Some(BitstreamRestriction {
            max_num_reorder_frames: 2,
            ..BitstreamRestriction::NO_REORDERING
        });
        assert_ne!(build_sps(&base), build_sps(&reordering));

        let mut absent = base;
        absent.restriction = None;
        assert_ne!(build_sps(&base), build_sps(&absent));
    }
}
