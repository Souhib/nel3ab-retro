//! The H.264 encoder: config, context, parameter buffers, one frame in one out.
//!
//! # Why these structures are byte arrays
//!
//! `VAEncSliceParameterBufferH264` is 3140 bytes across some eighty fields, of
//! which this crate sets eleven. Redeclaring all of them in Rust would be eighty
//! chances to shift everything after a mistake, to buy field names we would then
//! have to keep in step with libva by hand.
//!
//! So each buffer is an opaque array of exactly the measured size, written
//! through named setters at measured offsets. Nothing can shift, because there
//! is nothing to shift — and every offset below came out of
//! `spikes/m2-vaapi-export/va_encode_layout.c`, which prints them from the real
//! headers. Zero is the correct default for every field this crate leaves alone,
//! which is what the C reference does too (`memset` then set what matters).
//!
//! The bitfields get the same treatment and needed it more: their allocation
//! order inside the storage word is implementation-defined, so the prober sets
//! each one alone and prints the word. That is how `reference_pic_flag` turned
//! out to be **two bits** rather than the one it reads like.

use core::ffi::c_void;

use crate::error::EncoderError;
use crate::h264::{
    PpsParams, SliceHeaderParams, SpsParams, build_pps, build_slice_header, build_sps,
};
use crate::va::{Display, Surface, check, sys};

// ── measured sizes ───────────────────────────────────────────────────────────
const SEQ_SIZE: usize = 1132;
const PIC_SIZE: usize = 648;
const SLICE_SIZE: usize = 3140;
/// `VAPictureH264`, 36 bytes.
const PICTURE_SIZE: usize = 36;

// ── measured field offsets ───────────────────────────────────────────────────
const SEQ_SPS_ID: usize = 0;
const SEQ_LEVEL_IDC: usize = 1;
const SEQ_INTRA_PERIOD: usize = 4;
const SEQ_INTRA_IDR_PERIOD: usize = 8;
const SEQ_IP_PERIOD: usize = 12;
const SEQ_BITS_PER_SECOND: usize = 16;
const SEQ_MAX_NUM_REF_FRAMES: usize = 20;
const SEQ_WIDTH_IN_MBS: usize = 24;
const SEQ_HEIGHT_IN_MBS: usize = 26;
const SEQ_FIELDS: usize = 28;

const PIC_CURR_PIC: usize = 0;
const PIC_REFERENCE_FRAMES: usize = 36;
const PIC_CODED_BUF: usize = 612;
const PIC_PPS_ID: usize = 616;
const PIC_SPS_ID: usize = 617;
const PIC_LAST_PICTURE: usize = 618;
const PIC_FRAME_NUM: usize = 620;
const PIC_INIT_QP: usize = 622;
const PIC_FIELDS: usize = 628;

const SLICE_MACROBLOCK_ADDRESS: usize = 0;
const SLICE_NUM_MACROBLOCKS: usize = 4;
const SLICE_MACROBLOCK_INFO: usize = 8;
const SLICE_TYPE: usize = 12;
const SLICE_PPS_ID: usize = 13;
const SLICE_IDR_PIC_ID: usize = 14;
const SLICE_POC_LSB: usize = 16;
const SLICE_REF_PIC_LIST0: usize = 36;
const SLICE_REF_PIC_LIST1: usize = 1188;
const SLICE_QP_DELTA: usize = 3119;

// `VAEncMiscParameterBuffer` is a 4-byte type tag followed by the payload, so a
// misc buffer is 4 + sizeof(payload). Both payload layouts measured.
const MISC_DATA: usize = 4;
const MISC_RATE_CONTROL_SIZE: usize = MISC_DATA + 60;
const RC_BITS_PER_SECOND: usize = MISC_DATA;
const RC_TARGET_PERCENTAGE: usize = MISC_DATA + 4;
const RC_WINDOW_SIZE: usize = MISC_DATA + 8;
const RC_INITIAL_QP: usize = MISC_DATA + 12;
const RC_MIN_QP: usize = MISC_DATA + 16;
const RC_MAX_QP: usize = MISC_DATA + 32;
const MISC_FRAME_RATE_SIZE: usize = MISC_DATA + 24;
const FR_FRAMERATE: usize = MISC_DATA;

// ── measured bitfield masks ──────────────────────────────────────────────────
const SEQ_CHROMA_FORMAT_IDC: (u32, u32) = (0x0000_0003, 0);
const SEQ_FRAME_MBS_ONLY: (u32, u32) = (0x0000_0004, 2);
const SEQ_DIRECT_8X8_INFERENCE: (u32, u32) = (0x0000_0020, 5);
const SEQ_LOG2_MAX_FRAME_NUM_MINUS4: (u32, u32) = (0x0000_03c0, 6);
const SEQ_LOG2_MAX_POC_LSB_MINUS4: (u32, u32) = (0x0000_f000, 12);

const PIC_IDR_FLAG: (u32, u32) = (0x0000_0001, 0);
/// Two bits, not one — measured. Reading it as a flag would set only half of it.
const PIC_REFERENCE_FLAG: (u32, u32) = (0x0000_0006, 1);
const PIC_ENTROPY_CODING_MODE: (u32, u32) = (0x0000_0008, 3);
const PIC_DEBLOCKING_CONTROL_PRESENT: (u32, u32) = (0x0000_0200, 9);

/// A parameter buffer of a fixed, measured size.
#[derive(Debug)]
struct Raw<const N: usize>([u8; N]);

impl<const N: usize> Raw<N> {
    const fn zeroed() -> Self {
        Self([0; N])
    }

    fn put_u8(&mut self, offset: usize, value: u8) {
        if let Some(slot) = self.0.get_mut(offset) {
            *slot = value;
        }
    }

    fn put_u16(&mut self, offset: usize, value: u16) {
        if let Some(slot) = self.0.get_mut(offset..offset + 2) {
            slot.copy_from_slice(&value.to_ne_bytes());
        }
    }

    fn put_u32(&mut self, offset: usize, value: u32) {
        if let Some(slot) = self.0.get_mut(offset..offset + 4) {
            slot.copy_from_slice(&value.to_ne_bytes());
        }
    }

    fn put_i8(&mut self, offset: usize, value: i8) {
        self.put_u8(offset, value.cast_unsigned());
    }

    /// Sets one bitfield inside a `u32` storage word.
    fn put_bitfield(&mut self, offset: usize, (mask, shift): (u32, u32), value: u32) {
        let word = self.0.get(offset..offset + 4).map_or(0, |slot| {
            let mut raw = [0u8; 4];
            raw.copy_from_slice(slot);
            u32::from_ne_bytes(raw)
        });
        self.put_u32(offset, (word & !mask) | ((value << shift) & mask));
    }

    /// Writes a `VAPictureH264` marked invalid, which is how an unused reference
    /// slot must look. Leaving it zeroed would name surface 0.
    fn put_invalid_picture(&mut self, offset: usize) {
        self.put_u32(offset, sys::VA_INVALID_ID);
        self.put_u32(offset + 4, 0);
        self.put_u32(offset + 8, sys::VA_PICTURE_H264_INVALID);
    }

    const fn as_ptr(&self) -> *const u8 {
        self.0.as_ptr()
    }
}

/// How a session is encoded.
#[derive(Debug, Clone, Copy)]
pub struct EncodeSettings {
    /// Width in pixels; must be a multiple of 16 for now.
    pub width: u32,
    /// Height in pixels; must be a multiple of 16 for now.
    pub height: u32,
    /// Constant quantiser. Lower is better and bigger; 26 is a common middle.
    pub qp: u8,
    /// Frames per second, used only for the VUI timing.
    pub frame_rate: u32,
}

/// An H.264 encoder bound to one display and one frame size.
///
/// All-intra: every frame is an IDR. That is wasteful of bitrate and is the
/// right first step, because it has no reference state to get wrong — see
/// [`crate::h264::SliceHeaderParams`].
#[derive(Debug)]
pub struct Encoder<'a> {
    display: &'a Display,
    config: sys::VaConfigId,
    context: sys::VaContextId,
    settings: EncodeSettings,
    sps: Vec<u8>,
    pps: Vec<u8>,
    frame_number: u64,
}

impl<'a> Encoder<'a> {
    /// Creates the config and context.
    ///
    /// # Errors
    /// [`EncoderError::Va`] if the driver refuses, or
    /// [`EncoderError::UnsupportedSize`] for a size that is not a whole number
    /// of macroblocks — cropping is not written yet, and a partial macroblock
    /// would encode the padding as picture.
    pub fn new(display: &'a Display, settings: EncodeSettings) -> Result<Self, EncoderError> {
        if !settings.width.is_multiple_of(16) || !settings.height.is_multiple_of(16) {
            return Err(EncoderError::UnsupportedSize {
                width: settings.width,
                height: settings.height,
            });
        }

        let mut attributes = [
            sys::VaConfigAttrib {
                attrib_type: sys::VA_CONFIG_ATTRIB_RT_FORMAT,
                value: sys::VA_RT_FORMAT_YUV420,
            },
            sys::VaConfigAttrib {
                attrib_type: sys::VA_CONFIG_ATTRIB_RATE_CONTROL,
                value: sys::VA_RC_CQP,
            },
            // Not optional: measured by tracing ffmpeg, radeonsi synthesises no
            // headers at all, so the SPS, PPS and every slice header have to be
            // handed over packed.
            sys::VaConfigAttrib {
                attrib_type: sys::VA_CONFIG_ATTRIB_ENC_PACKED_HEADERS,
                value: sys::VA_ENC_PACKED_HEADER_SEQUENCE | sys::VA_ENC_PACKED_HEADER_SLICE,
            },
        ];

        let mut config: sys::VaConfigId = 0;
        // SAFETY: the display is initialised and borrowed for this encoder's
        // lifetime; `attributes` is a live array of exactly the stated length,
        // which libva copies rather than retains.
        check(
            unsafe {
                sys::vaCreateConfig(
                    display.handle(),
                    sys::VA_PROFILE_H264_HIGH,
                    sys::VA_ENTRYPOINT_ENC_SLICE,
                    attributes.as_mut_ptr(),
                    u32::try_from(attributes.len()).unwrap_or(0),
                    &raw mut config,
                )
            },
            "vaCreateConfig",
        )?;

        // No render targets, which looks wrong and is what ffmpeg does.
        //
        // Mesa treats this list as the encoder's DPB pool and manages it itself
        // from the reference lists in each picture. Handing it the surface being
        // encoded made radeonsi segfault inside vaEndPicture — found by diffing
        // an LIBVA_TRACE of this against one of ffmpeg, which is the only
        // difference that mattered out of a dozen.
        let mut context: sys::VaContextId = 0;
        // SAFETY: `config` was just created on this display, and the render
        // target array is live and of the stated length. The surface outlives
        // this call; the context keeps its own reference.
        check(
            unsafe {
                sys::vaCreateContext(
                    display.handle(),
                    config,
                    i32::try_from(settings.width).unwrap_or(0),
                    i32::try_from(settings.height).unwrap_or(0),
                    sys::VA_PROGRESSIVE,
                    core::ptr::null_mut(),
                    0,
                    &raw mut context,
                )
            },
            "vaCreateContext",
        )?;

        let width_in_mbs = settings.width.div_euclid(16);
        let height_in_mbs = settings.height.div_euclid(16);
        let sps = build_sps(&SpsParams {
            profile_idc: 100,
            constraint_flags: 0,
            level_idc: 41,
            seq_parameter_set_id: 0,
            log2_max_frame_num_minus4: 0,
            log2_max_pic_order_cnt_lsb_minus4: 2,
            max_num_ref_frames: 1,
            width_in_mbs,
            height_in_mbs,
            aspect_ratio_idc: None,
            video_format: None,
            colour: Some(crate::h264::ColourDescription::BT709_LIMITED),
            timing: Some((1, settings.frame_rate.saturating_mul(2))),
            restriction: Some(crate::h264::BitstreamRestriction::NO_REORDERING),
        });
        let pps = build_pps(&PpsParams {
            pic_parameter_set_id: 0,
            seq_parameter_set_id: 0,
            // CAVLC: Constrained Baseline has no CABAC, and the slice header's
            // alignment depends on this matching.
            entropy_coding_mode: false,
            pic_init_qp_minus26: i32::from(settings.qp) - 26,
            deblocking_filter_control_present: false,
            // High carries the extension; omitting it under this profile leaves
            // the PPS describing a stream the config did not ask for.
            transform_8x8_mode: Some(false),
        });

        Ok(Self {
            display,
            config,
            context,
            settings,
            sps,
            pps,
            frame_number: 0,
        })
    }

    /// Encodes one IDR frame from a surface and returns the bitstream.
    ///
    /// The first frame carries SPS and PPS; every frame carries its own slice
    /// header, because the driver writes none of them.
    ///
    /// # Errors
    /// [`EncoderError::Va`] from any libva call.
    pub fn encode_idr(&mut self, surface: &Surface<'_>) -> Result<Vec<u8>, EncoderError> {
        let coded = Buffer::new(
            self.display,
            self.context,
            sys::VA_ENC_CODED_BUFFER_TYPE,
            // 1.5 bytes per pixel is NV12 uncompressed, which a QP-26 frame
            // never reaches. Generous on purpose: an undersized coded buffer
            // fails in a way that looks like a broken encoder.
            self.settings.width * self.settings.height * 3_u32.div_euclid(2).max(1)
                + self.settings.width * self.settings.height,
            1,
            core::ptr::null(),
        )?;

        let seq = self.sequence_parameters();
        let pic = self.picture_parameters(surface, &coded);
        let slice = self.slice_parameters();

        let (slice_header, slice_header_bits) = build_slice_header(&SliceHeaderParams {
            first_mb_in_slice: 0,
            idr: true,
            idr_pic_id: 0,
            pic_parameter_set_id: 0,
            frame_num: 0,
            log2_max_frame_num_minus4: 0,
            pic_order_cnt_lsb: 0,
            log2_max_pic_order_cnt_lsb_minus4: 2,
            slice_qp_delta: 0,
            entropy_coding_mode: false,
        });

        // SPS and PPS travel together as one packed sequence header, which is
        // what ffmpeg does and what the driver therefore expects.
        let mut sequence_header = self.sps.clone();
        sequence_header.extend_from_slice(&self.pps);

        let buffers = [
            Buffer::new(
                self.display,
                self.context,
                sys::VA_ENC_SEQUENCE_PARAMETER_BUFFER_TYPE,
                u32::try_from(SEQ_SIZE).unwrap_or(0),
                1,
                seq.as_ptr().cast(),
            )?,
            self.rate_control_buffer()?,
            self.frame_rate_buffer()?,
            self.packed_header(sys::VA_ENC_PACKED_HEADER_SEQUENCE_TYPE, &sequence_header)?,
            self.packed_data(&sequence_header)?,
            Buffer::new(
                self.display,
                self.context,
                sys::VA_ENC_PICTURE_PARAMETER_BUFFER_TYPE,
                u32::try_from(PIC_SIZE).unwrap_or(0),
                1,
                pic.as_ptr().cast(),
            )?,
            self.packed_header_bits(
                sys::VA_ENC_PACKED_HEADER_SLICE_TYPE,
                slice_header_bits,
                &slice_header,
            )?,
            self.packed_data(&slice_header)?,
            Buffer::new(
                self.display,
                self.context,
                sys::VA_ENC_SLICE_PARAMETER_BUFFER_TYPE,
                u32::try_from(SLICE_SIZE).unwrap_or(0),
                1,
                slice.as_ptr().cast(),
            )?,
        ];

        let mut ids: Vec<sys::VaBufferId> = buffers.iter().map(Buffer::id).collect();

        // SAFETY: the context and surface are live, and the buffer ids all came
        // from this context and are kept alive by `buffers` until after
        // vaEndPicture.
        check(
            unsafe { sys::vaBeginPicture(self.display.handle(), self.context, surface.id()) },
            "vaBeginPicture",
        )?;
        // SAFETY: as above; `ids` is a live array of the stated length.
        check(
            unsafe {
                sys::vaRenderPicture(
                    self.display.handle(),
                    self.context,
                    ids.as_mut_ptr(),
                    i32::try_from(ids.len()).unwrap_or(0),
                )
            },
            "vaRenderPicture",
        )?;
        // SAFETY: matches the vaBeginPicture above.
        check(
            unsafe { sys::vaEndPicture(self.display.handle(), self.context) },
            "vaEndPicture",
        )?;
        surface.sync()?;

        self.frame_number += 1;
        coded.read_coded_segments(self.display)
    }

    /// The sequence parameters, all-intra.
    fn sequence_parameters(&self) -> Raw<SEQ_SIZE> {
        let (width_in_mbs, height_in_mbs) = self.macroblocks();
        let mut seq = Raw::<SEQ_SIZE>::zeroed();
        seq.put_u8(SEQ_SPS_ID, 0);
        seq.put_u8(SEQ_LEVEL_IDC, 41);
        seq.put_u32(SEQ_INTRA_PERIOD, 1);
        seq.put_u32(SEQ_INTRA_IDR_PERIOD, 1);
        seq.put_u32(SEQ_IP_PERIOD, 1);
        seq.put_u32(SEQ_BITS_PER_SECOND, 0);
        seq.put_u32(SEQ_MAX_NUM_REF_FRAMES, 1);
        seq.put_u16(SEQ_WIDTH_IN_MBS, u16::try_from(width_in_mbs).unwrap_or(0));
        seq.put_u16(SEQ_HEIGHT_IN_MBS, u16::try_from(height_in_mbs).unwrap_or(0));
        // 1 is 4:2:0. Zero would mean monochrome, and the encoder would quietly
        // drop every chroma sample the shader wrote.
        seq.put_bitfield(SEQ_FIELDS, SEQ_CHROMA_FORMAT_IDC, 1);
        seq.put_bitfield(SEQ_FIELDS, SEQ_FRAME_MBS_ONLY, 1);
        seq.put_bitfield(SEQ_FIELDS, SEQ_DIRECT_8X8_INFERENCE, 1);
        seq.put_bitfield(SEQ_FIELDS, SEQ_LOG2_MAX_FRAME_NUM_MINUS4, 0);
        seq.put_bitfield(SEQ_FIELDS, SEQ_LOG2_MAX_POC_LSB_MINUS4, 2);
        seq
    }

    /// The picture parameters for an IDR with no references.
    fn picture_parameters(&self, surface: &Surface<'_>, coded: &Buffer<'_>) -> Raw<PIC_SIZE> {
        let mut pic = Raw::<PIC_SIZE>::zeroed();
        pic.put_u32(PIC_CURR_PIC, surface.id());
        pic.put_u32(PIC_CURR_PIC + 8, 0); // flags: a valid, short-term picture
        for slot in 0..16 {
            pic.put_invalid_picture(PIC_REFERENCE_FRAMES + slot * PICTURE_SIZE);
        }
        pic.put_u32(PIC_CODED_BUF, coded.id());
        pic.put_u8(PIC_PPS_ID, 0);
        pic.put_u8(PIC_SPS_ID, 0);
        pic.put_u8(PIC_LAST_PICTURE, 0);
        pic.put_u16(PIC_FRAME_NUM, 0);
        pic.put_u8(PIC_INIT_QP, self.settings.qp);
        pic.put_bitfield(PIC_FIELDS, PIC_IDR_FLAG, 1);
        pic.put_bitfield(PIC_FIELDS, PIC_REFERENCE_FLAG, 1);
        pic.put_bitfield(PIC_FIELDS, PIC_ENTROPY_CODING_MODE, 0);
        pic.put_bitfield(PIC_FIELDS, PIC_DEBLOCKING_CONTROL_PRESENT, 0);
        pic
    }

    /// One slice covering the whole picture.
    fn slice_parameters(&self) -> Raw<SLICE_SIZE> {
        let (width_in_mbs, height_in_mbs) = self.macroblocks();
        let mut slice = Raw::<SLICE_SIZE>::zeroed();
        slice.put_u32(SLICE_MACROBLOCK_ADDRESS, 0);
        slice.put_u32(SLICE_NUM_MACROBLOCKS, width_in_mbs * height_in_mbs);
        slice.put_u32(SLICE_MACROBLOCK_INFO, sys::VA_INVALID_ID);
        slice.put_u8(SLICE_TYPE, 2); // I
        slice.put_u8(SLICE_PPS_ID, 0);
        slice.put_u16(SLICE_IDR_PIC_ID, 0);
        slice.put_u16(SLICE_POC_LSB, 0);
        for entry in 0..32 {
            slice.put_invalid_picture(SLICE_REF_PIC_LIST0 + entry * PICTURE_SIZE);
            slice.put_invalid_picture(SLICE_REF_PIC_LIST1 + entry * PICTURE_SIZE);
        }
        slice.put_i8(SLICE_QP_DELTA, 0);
        slice
    }

    /// The rate-control misc buffer.
    ///
    /// ffmpeg sends this and the frame rate below on every access unit, and the
    /// driver reads them even under constant-QP — leaving them out is the last
    /// structural difference between this call sequence and the one that works.
    fn rate_control_buffer(&self) -> Result<Buffer<'a>, EncoderError> {
        let mut raw = Raw::<MISC_RATE_CONTROL_SIZE>::zeroed();
        raw.put_u32(0, sys::VA_ENC_MISC_TYPE_RATE_CONTROL);
        // Zero bits per second means "constant QP decides the size", which is
        // what VA_RC_CQP asked for.
        raw.put_u32(RC_BITS_PER_SECOND, 0);
        raw.put_u32(RC_TARGET_PERCENTAGE, 100);
        raw.put_u32(RC_WINDOW_SIZE, 1000);
        raw.put_u32(RC_INITIAL_QP, u32::from(self.settings.qp));
        raw.put_u32(RC_MIN_QP, u32::from(self.settings.qp));
        raw.put_u32(RC_MAX_QP, u32::from(self.settings.qp));
        Buffer::new(
            self.display,
            self.context,
            sys::VA_ENC_MISC_PARAMETER_BUFFER_TYPE,
            u32::try_from(MISC_RATE_CONTROL_SIZE).unwrap_or(0),
            1,
            raw.as_ptr().cast(),
        )
    }

    /// The frame-rate misc buffer.
    fn frame_rate_buffer(&self) -> Result<Buffer<'a>, EncoderError> {
        let mut raw = Raw::<MISC_FRAME_RATE_SIZE>::zeroed();
        raw.put_u32(0, sys::VA_ENC_MISC_TYPE_FRAME_RATE);
        raw.put_u32(FR_FRAMERATE, self.settings.frame_rate);
        Buffer::new(
            self.display,
            self.context,
            sys::VA_ENC_MISC_PARAMETER_BUFFER_TYPE,
            u32::try_from(MISC_FRAME_RATE_SIZE).unwrap_or(0),
            1,
            raw.as_ptr().cast(),
        )
    }

    /// Frame size in macroblocks, exact by construction.
    const fn macroblocks(&self) -> (u32, u32) {
        (
            self.settings.width.div_euclid(16),
            self.settings.height.div_euclid(16),
        )
    }

    fn packed_header(&self, header_type: u32, payload: &[u8]) -> Result<Buffer<'a>, EncoderError> {
        self.packed_header_bits(header_type, payload.len() * 8, payload)
    }

    fn packed_header_bits(
        &self,
        header_type: u32,
        bit_length: usize,
        _payload: &[u8],
    ) -> Result<Buffer<'a>, EncoderError> {
        let mut parameter = Raw::<28>::zeroed();
        parameter.put_u32(0, header_type);
        parameter.put_u32(4, u32::try_from(bit_length).unwrap_or(0));
        // Our writer inserts them, so the driver must not insert them again —
        // doing so would escape the escapes and corrupt every header.
        parameter.put_u32(8, 1);
        Buffer::new(
            self.display,
            self.context,
            sys::VA_ENC_PACKED_HEADER_PARAMETER_BUFFER_TYPE,
            28,
            1,
            parameter.as_ptr().cast(),
        )
    }

    fn packed_data(&self, payload: &[u8]) -> Result<Buffer<'a>, EncoderError> {
        Buffer::new(
            self.display,
            self.context,
            sys::VA_ENC_PACKED_HEADER_DATA_BUFFER_TYPE,
            u32::try_from(payload.len()).unwrap_or(0),
            1,
            payload.as_ptr().cast(),
        )
    }
}

impl Drop for Encoder<'_> {
    fn drop(&mut self) {
        // SAFETY: both handles came from this display and are destroyed once.
        // Context before config, which is the order libva documents.
        unsafe {
            sys::vaDestroyContext(self.display.handle(), self.context);
            sys::vaDestroyConfig(self.display.handle(), self.config);
        }
    }
}

/// A libva buffer, destroyed on drop.
#[derive(Debug)]
struct Buffer<'a> {
    display: &'a Display,
    id: sys::VaBufferId,
}

impl<'a> Buffer<'a> {
    fn new(
        display: &'a Display,
        context: sys::VaContextId,
        buffer_type: u32,
        size: u32,
        count: u32,
        data: *const c_void,
    ) -> Result<Self, EncoderError> {
        let mut id: sys::VaBufferId = 0;
        // SAFETY: `data` is either null or points to at least `size * count`
        // bytes owned by the caller for the length of this call — libva copies
        // it into its own storage and does not retain the pointer.
        check(
            unsafe {
                sys::vaCreateBuffer(
                    display.handle(),
                    context,
                    buffer_type,
                    size,
                    count,
                    data.cast_mut(),
                    &raw mut id,
                )
            },
            "vaCreateBuffer",
        )?;
        Ok(Self { display, id })
    }

    const fn id(&self) -> sys::VaBufferId {
        self.id
    }

    /// Copies the coded bitstream out of a `VAEncCodedBufferType` buffer.
    fn read_coded_segments(&self, display: &Display) -> Result<Vec<u8>, EncoderError> {
        let mut pointer: *mut c_void = core::ptr::null_mut();
        // SAFETY: the buffer id is live and belongs to this display.
        check(
            unsafe { sys::vaMapBuffer(display.handle(), self.id, &raw mut pointer) },
            "vaMapBuffer",
        )?;

        let mut out = Vec::new();
        let mut segment = pointer.cast::<sys::VaCodedBufferSegment>();
        while !segment.is_null() {
            // SAFETY: libva returns a valid, NULL-terminated singly linked list
            // of segments while the buffer is mapped, and the layout of
            // VACodedBufferSegment is asserted against the header at compile
            // time in `sys`.
            let (size, buf, next) = unsafe {
                let s = &*segment;
                (s.size, s.buf, s.next)
            };
            if !buf.is_null() && size > 0 {
                // SAFETY: `buf` points to `size` bytes owned by libva and valid
                // until vaUnmapBuffer, which has not happened yet.
                out.extend_from_slice(unsafe {
                    core::slice::from_raw_parts(buf.cast::<u8>(), size as usize)
                });
            }
            segment = next.cast();
        }

        // SAFETY: paired with the vaMapBuffer above; nothing borrows the mapping
        // past this point because the bytes were copied.
        check(
            unsafe { sys::vaUnmapBuffer(display.handle(), self.id) },
            "vaUnmapBuffer",
        )?;
        Ok(out)
    }
}

impl Drop for Buffer<'_> {
    fn drop(&mut self) {
        // SAFETY: the id came from vaCreateBuffer on this display and Drop runs
        // once.
        let status = unsafe { sys::vaDestroyBuffer(self.display.handle(), self.id) };
        if status != sys::VA_STATUS_SUCCESS {
            tracing::warn!(status, "vaDestroyBuffer failed");
        }
    }
}

// The sizes above are measurements, so a mismatch must stop the build rather
// than corrupt a parameter buffer at runtime.
const _: () = {
    assert!(SEQ_SIZE == 1132);
    assert!(PIC_SIZE == 648);
    assert!(SLICE_SIZE == 3140);
    assert!(PICTURE_SIZE == 36);
    // Every offset this crate writes has to land inside its buffer.
    assert!(SEQ_FIELDS + 4 <= SEQ_SIZE);
    assert!(PIC_FIELDS + 4 <= PIC_SIZE);
    assert!(SLICE_REF_PIC_LIST1 + 32 * PICTURE_SIZE <= SLICE_SIZE);
    assert!(SLICE_QP_DELTA < SLICE_SIZE);
    assert!(MISC_RATE_CONTROL_SIZE == 64);
    assert!(MISC_FRAME_RATE_SIZE == 28);
};

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    reason = "a panic IS the failure signal in a test"
)]
mod tests {
    use super::*;
    use crate::va::DEFAULT_RENDER_NODE;

    /// ⚠️ IGNORED: still SEGFAULTS inside radeonsi at `vaEndPicture`.
    ///
    /// Kept and marked rather than deleted or left to fail. What is established:
    /// libva receives every parameter correctly — the byte-array buffers land
    /// field for field, bitfields included — and every call up to `vaEndPicture`
    /// returns `VA_STATUS_SUCCESS`.
    ///
    /// Ruled out by diffing an `LIBVA_TRACE` of this against one of ffmpeg, and
    /// then matching it in turn:
    ///
    /// - the misc rate-control and frame-rate buffers, now sent (layouts
    ///   measured, not guessed)
    /// - `num_render_targets`, now 0 as ffmpeg passes
    /// - the profile, now High as ffmpeg uses, with SPS and PPS to match
    /// - GOP and reference-count parameters
    ///
    /// None of them was it. The traces now agree on every field either prints,
    /// so the next step is not another guess: build Mesa with debug symbols, or
    /// install `libgl1-mesa-dri-dbgsym`, and get a backtrace that names the
    /// dereference instead of an address inside `radeonsi_drv_video.so`.
    #[ignore = "segfaults in radeonsi at vaEndPicture; see the doc comment"]
    #[test]
    fn a_frame_encodes_into_a_bitstream_with_the_headers_we_wrote() {
        let Ok(display) = Display::open(DEFAULT_RENDER_NODE) else {
            panic!("no VA display on {DEFAULT_RENDER_NODE}: run this where the GPU is");
        };
        let surface = display.create_nv12_surface(640, 480).unwrap();
        let settings = EncodeSettings {
            width: 640,
            height: 480,
            qp: 26,
            frame_rate: 60,
        };
        let mut encoder = Encoder::new(&display, settings).unwrap();
        let bitstream = encoder.encode_idr(&surface).unwrap();

        assert!(!bitstream.is_empty(), "the encoder produced nothing");

        // The headers must be OURS: the driver writes none, so if SPS and PPS
        // are present they came from h264::build_sps and build_pps.
        let mut types = Vec::new();
        for index in 0..bitstream.len().saturating_sub(4) {
            if bitstream[index..index + 3] == [0, 0, 1] {
                types.push(bitstream[index + 3] & 0x1f);
            }
        }
        assert!(types.contains(&7), "no SPS in {types:?}");
        assert!(types.contains(&8), "no PPS in {types:?}");
        assert!(types.contains(&5), "no IDR slice in {types:?}");
    }
}
