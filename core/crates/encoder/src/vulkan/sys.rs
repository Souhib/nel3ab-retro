//! The one thing the Vulkan path needs from the OS rather than from `ash`.

use std::path::{Path, PathBuf};

use crate::error::EncoderError;

/// A device's major/minor pair, as the kernel reports it and as
/// `VK_EXT_physical_device_drm` reports it back.
///
/// A pair rather than the packed `dev_t`: the packing is a libc detail, the two
/// numbers are what both sides actually name, and comparing them field by field
/// cannot silently succeed on a bad shift.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DeviceNumber {
    /// Driver family.
    pub major: u64,
    /// Which node within it.
    pub minor: u64,
}

/// Reads the device number of a special file.
///
/// # Errors
/// [`EncoderError::RenderNode`] if the path cannot be stat'd.
pub fn device_number(node: &Path) -> Result<DeviceNumber, EncoderError> {
    use std::os::unix::fs::MetadataExt as _;

    // `metadata` follows symlinks, which is wanted: /dev/dri/by-path/... entries
    // are symlinks to the real node, and it is the real node Vulkan reports.
    let metadata = std::fs::metadata(node).map_err(|source| EncoderError::RenderNode {
        path: PathBuf::from(node),
        source,
    })?;
    let rdev = metadata.rdev();
    Ok(DeviceNumber {
        major: u64::from(nix::sys::stat::major(rdev)),
        minor: u64::from(nix::sys::stat::minor(rdev)),
    })
}

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    clippy::expect_used,
    reason = "a panic IS the failure signal in a test"
)]
mod tests {
    use super::*;

    /// Needs no GPU: /dev/null's device number is fixed by the kernel, so this
    /// pins the major/minor split itself rather than trusting it.
    #[test]
    fn the_major_and_minor_are_split_the_way_the_kernel_means_them() {
        let number = device_number(Path::new("/dev/null")).unwrap();
        assert_eq!(number, DeviceNumber { major: 1, minor: 3 });
    }

    /// The negative twin for the equality the device search relies on: two nodes
    /// of the same driver differ only in the minor, so a comparison that dropped
    /// it would match the wrong GPU on a two-card machine.
    #[test]
    fn two_nodes_of_the_same_driver_are_not_equal() {
        let null = device_number(Path::new("/dev/null")).unwrap();
        let zero = device_number(Path::new("/dev/zero")).unwrap();
        assert_eq!(null.major, zero.major, "both are mem devices");
        assert_ne!(null, zero, "they differ in the minor and must not compare equal");
    }

    #[test]
    fn a_path_that_does_not_exist_is_an_error_naming_it() {
        let error = device_number(Path::new("/dev/definitely-not-here")).unwrap_err();
        let EncoderError::RenderNode { path, .. } = error else {
            panic!("{error:?}");
        };
        assert_eq!(path, Path::new("/dev/definitely-not-here"));
    }
}
