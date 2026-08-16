//! The picture and the words a disc carries about itself.
//!
//! # Why the disc rather than a database
//!
//! Every `GameCube` disc holds a file called `opening.bnr`: a 96 by 32 image and,
//! beside it, the game's long name, its developer and a sentence of description,
//! written by whoever published it. That is exactly the metadata a menu wants,
//! and it is already on this machine.
//!
//! An online cover database was the other option and it loses on every count.
//! It needs the network from a box that is only on a tailnet, it needs a third
//! party to stay up, and the images are not ours to serve. The decisive one is
//! smaller and more concrete: this collection contains `GM4E08`, a hack called
//! *Retro Track Grand Prix*. No database has heard of it. Its disc, however,
//! carries its own banner and its own description, because the people who made
//! it wrote them.
//!
//! # What this module does and does not do
//!
//! [`parse`] is pure: bytes in, picture and words out. It is where the format
//! lives and where the tests are. [`gather`] is the part that touches the world
//! — it runs `dolphin-tool` and keeps a cache — and it is deliberately thin.
//!
//! # The image format
//!
//! RGB5A3, tiled in four-by-four blocks. Two things about it are worth stating
//! because both are easy to get wrong in a way that still produces a picture:
//!
//! - **Two encodings share one type.** The top bit selects them. Set means five
//!   bits per colour and no transparency; clear means four bits per colour and
//!   three of alpha. Reading only the first branch gives a plausible, wrong
//!   image, and most of these banners are mostly in the second one.
//! - **The pixels are not in reading order.** They arrive as 4x4 tiles, left to
//!   right then top to bottom. Copying them straight into a raster gives a
//!   picture that looks shredded rather than blank, so a test has to pin a pixel
//!   at a known position rather than check that something was written.

use std::path::{Path, PathBuf};
use std::process::Command;

use crate::library::Rom;

/// A banner is always this wide. Every disc, no exception: the size is part of
/// the format rather than a property of the file.
pub const WIDTH: u32 = 96;
/// A banner is always this tall.
pub const HEIGHT: u32 = 32;

const W: usize = WIDTH as usize;
const H: usize = HEIGHT as usize;
/// The side of one tile, in pixels.
const TILE: usize = 4;
/// Where the image starts: after the magic and its padding.
const IMAGE_AT: usize = 0x20;
/// Two bytes a pixel.
const IMAGE_BYTES: usize = W * H * 2;
/// Where the words start.
const TEXT_AT: usize = IMAGE_AT + IMAGE_BYTES;
/// How long one language's block of words is.
const BLOCK: usize = 320;
/// Inside a block: the long name, the developer, the sentence.
const LONG_NAME_AT: usize = 0x40;
const LONG_MAKER_AT: usize = 0x80;
const ABOUT_AT: usize = 0xC0;
/// Which block of a six-language banner to read, and what to fall back to.
///
/// French, because the room is in French and the disc already has the sentence
/// translated. The order is fixed by the format: English, German, French,
/// Spanish, Italian, Dutch. Verified against seven PAL discs on 2026-08-16.
const FRENCH: usize = 2;
const ENGLISH: usize = 0;

/// The file a `GameCube` disc keeps its banner in.
const INSIDE_THE_DISC: &str = "opening.bnr";

/// A banner, read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Banner {
    /// The picture, RGBA, row by row. Always `WIDTH * HEIGHT * 4` bytes.
    pub pixels: Vec<u8>,
    /// The name the disc gives itself, which is not always the file's name.
    pub name: String,
    /// Who made it.
    pub maker: String,
    /// The sentence the publisher wrote. May contain a newline: these were laid
    /// out for a two-line display, and the break is theirs rather than ours.
    pub about: String,
}

/// A banner ready for a browser: the picture encoded, the words kept.
///
/// The pixels are dropped once encoded. Holding both would keep twelve kilobytes
/// per game alive for the life of the process to no purpose.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Art {
    /// The picture, as PNG.
    pub png: Vec<u8>,
    /// Who made it.
    pub maker: String,
    /// The sentence the publisher wrote.
    pub about: String,
}

/// What can go wrong between a disc and a banner.
#[derive(Debug, thiserror::Error)]
pub enum BannerError {
    /// The bytes do not start with `BNR1` or `BNR2`.
    #[error("not a GameCube banner: it starts with {0:?}")]
    NotABanner(String),
    /// The file is shorter than the format allows.
    #[error("a banner needs at least {want} bytes and this one has {got}")]
    TooShort {
        /// How many bytes the format requires.
        want: usize,
        /// How many the file had.
        got: usize,
    },
    /// The extraction tool could not be started.
    #[error("starting {tool} failed")]
    ToolFailed {
        /// What we tried to run.
        tool: PathBuf,
        /// Why it did not start.
        #[source]
        source: std::io::Error,
    },
    /// The tool ran and refused.
    #[error("{tool} refused {rom}: {status}")]
    ToolRefused {
        /// What we ran.
        tool: PathBuf,
        /// Which disc it was pointed at.
        rom: PathBuf,
        /// What it exited with.
        status: String,
    },
    /// The tool reported success and wrote nothing.
    #[error("{path} was not written")]
    NothingWritten {
        /// Where the file was expected.
        path: PathBuf,
    },
    /// The picture could not be encoded.
    #[error("encoding the banner failed")]
    NotEncodable(#[source] png::EncodingError),
}

/// Reads a banner.
///
/// Rejects anything that is not one rather than guessing: a disc with no banner
/// and a truncated download must not both produce a picture of noise.
pub fn parse(blob: &[u8]) -> Result<Banner, BannerError> {
    let magic = blob.get(..4).unwrap_or_default();
    let languages = match magic {
        b"BNR1" => 1,
        b"BNR2" => 6,
        other => {
            return Err(BannerError::NotABanner(
                String::from_utf8_lossy(other).into_owned(),
            ));
        }
    };
    let want = TEXT_AT + languages * BLOCK;
    if blob.len() < want {
        return Err(BannerError::TooShort {
            want,
            got: blob.len(),
        });
    }
    let words = words_of(blob, languages);
    Ok(Banner {
        pixels: untile(blob),
        name: text(words, LONG_NAME_AT, 64),
        maker: text(words, LONG_MAKER_AT, 64),
        about: text(words, ABOUT_AT, 128),
    })
}

/// Encodes a banner for a browser.
pub fn encode(banner: &Banner) -> Result<Vec<u8>, BannerError> {
    let mut png = Vec::new();
    let mut encoder = png::Encoder::new(&mut png, WIDTH, HEIGHT);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder.write_header().map_err(BannerError::NotEncodable)?;
    writer
        .write_image_data(&banner.pixels)
        .map_err(BannerError::NotEncodable)?;
    writer.finish().map_err(BannerError::NotEncodable)?;
    Ok(png)
}

/// Which language's block of words to read.
///
/// A six-language banner is asked for French first. A disc that left that block
/// empty falls back to English rather than showing a blank line, which is the
/// only case where the fallback matters and the reason it exists.
fn words_of(blob: &[u8], languages: usize) -> &[u8] {
    let block = |which: usize| {
        let at = TEXT_AT + which * BLOCK;
        blob.get(at..at + BLOCK).unwrap_or_default()
    };
    if languages > FRENCH {
        let french = block(FRENCH);
        if !text(french, LONG_NAME_AT, 64).is_empty() {
            return french;
        }
    }
    block(ENGLISH)
}

/// Turns the tiled RGB5A3 image into RGBA, row by row.
fn untile(blob: &[u8]) -> Vec<u8> {
    let image = blob
        .get(IMAGE_AT..IMAGE_AT + IMAGE_BYTES)
        .unwrap_or_default();
    let mut out = vec![0_u8; W * H * 4];
    let mut at = 0_usize;
    for tile_y in (0..H).step_by(TILE) {
        for tile_x in (0..W).step_by(TILE) {
            for y in 0..TILE {
                for x in 0..TILE {
                    let Some([high, low]) = image.get(at..at + 2) else {
                        return out;
                    };
                    at += 2;
                    let into = ((tile_y + y) * W + tile_x + x) * 4;
                    if let Some(slot) = out.get_mut(into..into + 4) {
                        slot.copy_from_slice(&rgb5a3(u16::from_be_bytes([*high, *low])));
                    }
                }
            }
        }
    }
    out
}

/// One pixel, in whichever of the two encodings its top bit selects.
///
/// The shifts rather than a multiply so that full means full: `7` has to become
/// `255` and not `252`, or a picture the artist drew opaque arrives slightly
/// see-through and every banner sits on a faint haze.
/// Each value is masked to at most five bits before the cast, so `u8` cannot
/// lose anything and `try_from` would add a branch that can never be taken.
const fn rgb5a3(value: u16) -> [u8; 4] {
    if value & 0x8000 == 0 {
        let alpha = ((value >> 12) & 0x7) as u8;
        let red = ((value >> 8) & 0xF) as u8;
        let green = ((value >> 4) & 0xF) as u8;
        let blue = (value & 0xF) as u8;
        [
            (red << 4) | red,
            (green << 4) | green,
            (blue << 4) | blue,
            (alpha << 5) | (alpha << 2) | (alpha >> 1),
        ]
    } else {
        let red = ((value >> 10) & 0x1F) as u8;
        let green = ((value >> 5) & 0x1F) as u8;
        let blue = (value & 0x1F) as u8;
        [
            (red << 3) | (red >> 2),
            (green << 3) | (green >> 2),
            (blue << 3) | (blue >> 2),
            0xFF,
        ]
    }
}

/// Reads one of the fixed-width strings, in the encoding these discs used.
///
/// Windows-1252 rather than plain Latin-1, and the difference is visible: Mario
/// Party 5 writes "more mayhem\u{85}" where `0x85` is an ellipsis in one and a
/// control character in the other.
fn text(words: &[u8], at: usize, len: usize) -> String {
    /// What Windows-1252 puts where Latin-1 has controls.
    const HIGH: [char; 32] = [
        '€', '\u{81}', '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ', '‰', 'Š', '‹', 'Œ', '\u{8d}', 'Ž',
        '\u{8f}', '\u{90}', '\u{2018}', '\u{2019}', '“', '”', '•', '–', '—', '˜', '™', 'š', '›',
        'œ', '\u{9d}', 'ž', 'Ÿ',
    ];
    words
        .get(at..at + len)
        .unwrap_or_default()
        .iter()
        .copied()
        .take_while(|byte| *byte != 0)
        .map(|byte| match byte {
            0x80..=0x9F => HIGH
                .get(usize::from(byte - 0x80))
                .copied()
                .unwrap_or(char::REPLACEMENT_CHARACTER),
            other => char::from(other),
        })
        .collect::<String>()
        .trim()
        .to_owned()
}

/// Reads the banner of every game, once, and keeps it.
///
/// Returns one entry per game, in the same order, so a position in the library
/// is a position here. A game whose banner cannot be read gets `None` and the
/// room carries on without a picture for it: a disc that will not give up its
/// banner is not a reason to have no menu.
///
/// # What the cache buys, measured
///
/// Extracting all eight of lgf's discs costs 3.7 s the first time (2026-08-16,
/// warm page cache). Every start after that reads the cached blobs instead, and
/// that is why this is allowed to be synchronous: the cost is paid once on the
/// machine's first boot, not on every game change.
///
/// A failure is remembered too, in an empty marker file. Without it, a disc with
/// no banner would pay the full extraction on every single start, for ever.
pub fn gather(roms: &[Rom], tool: &Path, cache: &Path) -> Vec<Option<Art>> {
    if let Err(error) = std::fs::create_dir_all(cache) {
        tracing::warn!(?cache, %error, "no banner cache, reading every disc every time");
    }
    roms.iter()
        .map(|rom| match art_of(rom, tool, cache) {
            Ok(art) => Some(art),
            Err(error) => {
                tracing::info!(rom = %rom.name, %error, "no banner for this one");
                None
            }
        })
        .collect()
}

/// One game's art, from the cache when it is there and from the disc when it is
/// not.
fn art_of(rom: &Rom, tool: &Path, cache: &Path) -> Result<Art, BannerError> {
    let key = cache.join(cache_key(rom));
    let kept = key.with_extension("bnr");
    let refused = key.with_extension("none");
    let blob = match std::fs::read(&kept) {
        Ok(blob) => blob,
        Err(_) if refused.exists() => {
            return Err(BannerError::NothingWritten { path: kept });
        }
        Err(_) => {
            let taken = extract(tool, &rom.path, &key.with_extension("d"));
            match taken {
                Ok(blob) => {
                    if let Err(error) = std::fs::write(&kept, &blob) {
                        tracing::warn!(?kept, %error, "the banner was read but not cached");
                    }
                    blob
                }
                Err(error) => {
                    // The marker, so the next start does not pay for this again.
                    let _ = std::fs::write(&refused, []);
                    return Err(error);
                }
            }
        }
    };
    let banner = parse(&blob)?;
    Ok(Art {
        png: encode(&banner)?,
        maker: banner.maker,
        about: banner.about,
    })
}

/// A file name for the cache that changes when the game does.
///
/// The size rather than a hash of the contents: these are gigabyte files and
/// reading one to decide whether to read it would be the whole cost we are
/// avoiding. A disc replaced by a different dump of the same byte length keeps
/// the old banner, which is a wrong picture rather than a broken room.
fn cache_key(rom: &Rom) -> String {
    let size = std::fs::metadata(&rom.path).map_or(0, |about| about.len());
    let safe: String = rom
        .file
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character
            } else {
                '-'
            }
        })
        .collect();
    format!("{safe}-{size}")
}

/// Pulls `opening.bnr` out of a disc image.
///
/// Through `dolphin-tool` rather than by reading the disc ourselves, because
/// seven of these eight files are RVZ: a compressed container whose blocks would
/// have to be decompressed before the filesystem inside is even visible. Dolphin
/// already knows how, we already ship it, and it answers in 0.44 s.
fn extract(tool: &Path, rom: &Path, into: &Path) -> Result<Vec<u8>, BannerError> {
    // A fresh directory, or a previous run's file would be read back as this
    // disc's banner and every game would wear the same picture.
    let _ = std::fs::remove_dir_all(into);
    std::fs::create_dir_all(into).map_err(|source| BannerError::ToolFailed {
        tool: tool.to_path_buf(),
        source,
    })?;
    let status = Command::new(tool)
        .arg("extract")
        .arg("-i")
        .arg(rom)
        .arg("-o")
        .arg(into)
        .arg("-s")
        .arg(INSIDE_THE_DISC)
        .arg("-q")
        .status()
        .map_err(|source| BannerError::ToolFailed {
            tool: tool.to_path_buf(),
            source,
        })?;
    if !status.success() {
        let _ = std::fs::remove_dir_all(into);
        return Err(BannerError::ToolRefused {
            tool: tool.to_path_buf(),
            rom: rom.to_path_buf(),
            status: status.to_string(),
        });
    }
    // Where the tool puts it: it rebuilds the disc's own directory tree.
    let written = into.join("files").join(INSIDE_THE_DISC);
    let blob = std::fs::read(&written).map_err(|_| BannerError::NothingWritten {
        path: written.clone(),
    })?;
    let _ = std::fs::remove_dir_all(into);
    Ok(blob)
}

#[cfg(test)]
#[expect(
    clippy::unwrap_used,
    clippy::indexing_slicing,
    reason = "a panic IS the failure signal in a test"
)]
mod tests {
    use super::*;

    /// Builds a banner blob the way a disc would: magic, image, then the words.
    fn blob(magic: [u8; 4], languages: usize) -> Vec<u8> {
        let mut out = magic.to_vec();
        out.resize(IMAGE_AT + IMAGE_BYTES, 0);
        out.resize(TEXT_AT + languages * BLOCK, 0);
        out
    }

    /// Writes a string into one language block, at one of the three offsets.
    fn put(out: &mut [u8], language: usize, at: usize, what: &[u8]) {
        let start = TEXT_AT + language * BLOCK + at;
        out[start..start + what.len()].copy_from_slice(what);
    }

    /// Writes one pixel at a position in the TILED stream, not in the picture.
    fn put_pixel(out: &mut [u8], nth: usize, value: u16) {
        let at = IMAGE_AT + nth * 2;
        out[at..at + 2].copy_from_slice(&value.to_be_bytes());
    }

    /// Reads a pixel out of the decoded picture, by its place on screen.
    fn pixel_at(banner: &Banner, x: usize, y: usize) -> [u8; 4] {
        let at = (y * W + x) * 4;
        banner.pixels[at..at + 4].try_into().unwrap()
    }

    #[test]
    fn a_one_language_banner_gives_its_words() {
        let mut raw = blob(*b"BNR1", 1);
        put(&mut raw, 0, LONG_NAME_AT, b"SUPER SMASH BROS. Melee");
        put(&mut raw, 0, LONG_MAKER_AT, b"Nintendo/HAL Laboratory,Inc.");
        put(&mut raw, 0, ABOUT_AT, b"Let the melee begin!");

        let banner = parse(&raw).unwrap();

        assert_eq!(banner.name, "SUPER SMASH BROS. Melee");
        assert_eq!(banner.maker, "Nintendo/HAL Laboratory,Inc.");
        assert_eq!(banner.about, "Let the melee begin!");
    }

    #[test]
    fn anything_that_is_not_a_banner_is_refused() {
        // The negative twin of the test above. Without it, a decoder that
        // ignored the magic would pass everything and turn a truncated download
        // into a picture of noise.
        let refused = parse(&blob(*b"BNR3", 1));

        assert!(matches!(refused, Err(BannerError::NotABanner(_))));
    }

    #[test]
    fn a_banner_cut_short_is_refused_rather_than_padded() {
        let mut raw = blob(*b"BNR1", 1);
        raw.truncate(TEXT_AT + 8);

        let refused = parse(&raw);

        assert!(matches!(refused, Err(BannerError::TooShort { .. })));
    }

    #[test]
    fn a_six_language_banner_is_read_in_french() {
        let mut raw = blob(*b"BNR2", 6);
        put(&mut raw, ENGLISH, ABOUT_AT, b"Mario Party is back!");
        put(&mut raw, FRENCH, LONG_NAME_AT, b"Mario Party 4");
        put(&mut raw, FRENCH, ABOUT_AT, b"Mario Party est de retour!");

        assert_eq!(parse(&raw).unwrap().about, "Mario Party est de retour!");
    }

    #[test]
    fn a_six_language_banner_with_no_french_falls_back_to_english() {
        // The negative twin: without this, "read block two" would show a blank
        // line on any disc that left it empty, and the bug would look like a
        // game with no description rather than like a bug.
        let mut raw = blob(*b"BNR2", 6);
        put(&mut raw, ENGLISH, LONG_NAME_AT, b"Mario Party 4");
        put(&mut raw, ENGLISH, ABOUT_AT, b"Mario Party is back!");

        assert_eq!(parse(&raw).unwrap().about, "Mario Party is back!");
    }

    #[test]
    fn the_words_are_read_as_windows_1252() {
        let mut raw = blob(*b"BNR1", 1);
        // 0x85 is an ellipsis here and a control character in Latin-1; 0xE9 is
        // an e-acute in both, and is the twin that proves the table did not
        // replace the whole range with something wrong.
        put(&mut raw, 0, ABOUT_AT, &[b'a', 0x85, b' ', 0xE9]);

        assert_eq!(parse(&raw).unwrap().about, "a… é");
    }

    #[test]
    fn an_opaque_pixel_keeps_its_five_bits() {
        let mut raw = blob(*b"BNR1", 1);
        // Top bit set: five bits each, full red, and full has to reach 255.
        put_pixel(&mut raw, 0, 0x8000 | (31 << 10));

        assert_eq!(pixel_at(&parse(&raw).unwrap(), 0, 0), [255, 0, 0, 255]);
    }

    #[test]
    fn a_pixel_with_alpha_takes_the_other_branch() {
        // The twin of the test above, and the one that matters: most of these
        // banners are drawn almost entirely in this branch, so a decoder that
        // only read the first one would still produce a picture.
        let mut raw = blob(*b"BNR1", 1);
        // Top bit clear: three bits of alpha at full, four bits of green at full.
        put_pixel(&mut raw, 0, (7 << 12) | (15 << 4));

        assert_eq!(pixel_at(&parse(&raw).unwrap(), 0, 0), [0, 255, 0, 255]);
    }

    #[test]
    fn the_pixels_are_untiled_rather_than_copied_in_order() {
        // The seventeenth pixel of the stream is the first of the SECOND tile,
        // so it belongs at x=4, y=0. A decoder that copied the stream straight
        // into a raster would put it at x=16 and produce a shredded picture that
        // still looks like an image.
        let mut raw = blob(*b"BNR1", 1);
        put_pixel(&mut raw, 16, 0x8000 | 31);

        let banner = parse(&raw).unwrap();
        assert_eq!(pixel_at(&banner, 4, 0), [0, 0, 255, 255]);
        assert_eq!(pixel_at(&banner, 16, 0), [0, 0, 0, 0], "rien à x=16");
    }

    #[test]
    fn the_second_row_of_a_tile_is_the_fifth_pixel() {
        // The other half of the tiling: within a tile the rows are consecutive.
        let mut raw = blob(*b"BNR1", 1);
        put_pixel(&mut raw, 4, 0x8000 | 31);

        assert_eq!(pixel_at(&parse(&raw).unwrap(), 0, 1), [0, 0, 255, 255]);
    }

    /// Stands in for `dolphin-tool`: copies a prepared blob to where the real
    /// one writes it, so the arguments and the output path are under test rather
    /// than assumed.
    ///
    /// It copies a FILE rather than echoing bytes because a banner is mostly
    /// zeroes, and a shell cannot carry a NUL through an argument.
    fn fake_tool(into: &Path, writes: Option<&[u8]>, code: u8) -> PathBuf {
        let script = into.join("tool.sh");
        let body = writes.map_or_else(
            || format!("#!/bin/sh\nexit {code}\n"),
            |blob| {
                let source = into.join("source.bnr");
                std::fs::write(&source, blob).unwrap();
                format!(
                    "#!/bin/sh\nwhile [ $# -gt 0 ]; do [ \"$1\" = -o ] && out=$2; shift; done\n\
                     mkdir -p \"$out/files\"\ncp '{}' \"$out/files/opening.bnr\"\nexit {code}\n",
                    source.display()
                )
            },
        );
        std::fs::write(&script, body).unwrap();
        std::fs::set_permissions(&script, std::os::unix::fs::PermissionsExt::from_mode(0o755))
            .unwrap();
        script
    }

    fn a_rom(dir: &Path) -> Rom {
        let path = dir.join("game.rvz");
        std::fs::write(&path, b"not really a disc").unwrap();
        Rom {
            path,
            name: "Melee".to_owned(),
            file: "game.rvz".to_owned(),
        }
    }

    #[test]
    fn a_banner_is_read_once_and_then_from_the_cache() {
        let dir = tempfile::tempdir().unwrap();
        let cache = dir.path().join("cache");
        let mut raw = blob(*b"BNR1", 1);
        put(&mut raw, 0, LONG_MAKER_AT, b"Nintendo");
        // Only the words are checked here, so a blob of printable bytes is
        // enough and keeps the fake tool a one-liner.
        let tool = fake_tool(dir.path(), Some(&raw), 0);
        let rom = a_rom(dir.path());

        let first = gather(std::slice::from_ref(&rom), &tool, &cache);
        assert_eq!(first[0].as_ref().unwrap().maker, "Nintendo");

        // The tool is taken away. A second read that still works can only have
        // come from the cache, which is the whole claim.
        std::fs::remove_file(&tool).unwrap();
        let second = gather(std::slice::from_ref(&rom), &tool, &cache);
        assert_eq!(second[0].as_ref().unwrap().maker, "Nintendo");
    }

    #[test]
    fn a_disc_that_refuses_leaves_the_room_without_a_picture() {
        // The negative twin: a game with no banner must be `None` rather than an
        // error that stops the library, and it must not stop the games after it.
        let dir = tempfile::tempdir().unwrap();
        let tool = fake_tool(dir.path(), None, 1);
        let rom = a_rom(dir.path());

        let found = gather(&[rom.clone(), rom], &tool, &dir.path().join("cache"));

        assert_eq!(found.len(), 2);
        assert!(found.iter().all(Option::is_none));
    }

    #[test]
    fn a_refusal_is_remembered_so_it_is_not_paid_for_twice() {
        let dir = tempfile::tempdir().unwrap();
        let cache = dir.path().join("cache");
        let rom = a_rom(dir.path());
        let _ = gather(
            std::slice::from_ref(&rom),
            &fake_tool(dir.path(), None, 1),
            &cache,
        );

        // The tool now WOULD work. A second pass that still finds nothing proves
        // the marker was written and read, which is what keeps a disc with no
        // banner from paying the full extraction on every start.
        let mut raw = blob(*b"BNR1", 1);
        put(&mut raw, 0, LONG_MAKER_AT, b"Nintendo");
        let working = fake_tool(dir.path(), Some(&raw), 0);
        assert!(gather(std::slice::from_ref(&rom), &working, &cache)[0].is_none());
    }

    #[test]
    fn a_tool_that_says_yes_and_writes_nothing_is_still_a_failure() {
        let dir = tempfile::tempdir().unwrap();
        let tool = fake_tool(dir.path(), None, 0);

        let refused = extract(&tool, Path::new("game.rvz"), &dir.path().join("out"));

        assert!(matches!(refused, Err(BannerError::NothingWritten { .. })));
    }

    #[test]
    fn a_banner_encodes_to_something_a_browser_reads() {
        let png = encode(&parse(&blob(*b"BNR1", 1)).unwrap()).unwrap();

        // The signature and the dimensions, which is what a wrong `WIDTH` would
        // break. That the whole file decodes is proven in the browser driver,
        // by a decoder that is not ours.
        assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
        assert_eq!(&png[16..24], &[0, 0, 0, 96, 0, 0, 0, 32]);
    }
}
