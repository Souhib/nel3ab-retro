//! Compiles the libavcodec shim, but only when the `vaapi` feature asks for it.
//!
//! The feature gate is the point: a machine with neither libva nor ffmpeg
//! headers must still be able to run `cargo test` on the rest of this crate.
//! Build scripts always run, so the gate has to be checked here rather than
//! declared in the manifest.

fn main() {
    println!("cargo:rerun-if-changed=csrc/nel3ab_encode.c");
    println!("cargo:rerun-if-changed=csrc/nel3ab_encode.h");

    if std::env::var_os("CARGO_FEATURE_VAAPI").is_none() {
        return;
    }

    // pkg-config emits the link directives itself, and hands back the include
    // paths the compile needs. Asking it beats hardcoding a multiarch triple.
    let mut include_paths = Vec::new();
    for library in ["libavcodec", "libavutil", "libva"] {
        match pkg_config::Config::new().probe(library) {
            Ok(found) => include_paths.extend(found.include_paths),
            Err(error) => {
                // Reported through `cargo::error` rather than a panic. Rule 6
                // bans panicking because it kills a live session, and a build
                // script has none — but this is also simply better output: Cargo
                // prints it as an error, without a backtrace nobody wants. A
                // clear stop here beats a link failure two minutes later naming
                // a mangled symbol instead of a missing package.
                println!(
                    "cargo::error=the `vaapi` feature needs {library}, which pkg-config \
                     cannot find. On Debian/Ubuntu: apt install libavcodec-dev \
                     libavutil-dev libva-dev. pkg-config said: {error}"
                );
                return;
            }
        }
    }

    let mut build = cc::Build::new();
    build
        .file("csrc/nel3ab_encode.c")
        .std("c11")
        .warnings(true)
        .flag_if_supported("-Wextra");
    for path in include_paths {
        build.include(path);
    }
    build.compile("nel3ab_encode");
}
