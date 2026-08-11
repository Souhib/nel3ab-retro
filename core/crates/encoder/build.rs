//! Compiles the libavcodec shim, but only when the `vaapi` feature asks for it.
//!
//! The feature gate is the point: a machine with neither libva nor ffmpeg
//! headers must still be able to run `cargo test` on the rest of this crate.
//! Build scripts always run, so the gate has to be checked here rather than
//! declared in the manifest.

fn main() {
    println!("cargo:rerun-if-changed=csrc/nel3ab_encode.c");
    println!("cargo:rerun-if-changed=csrc/nel3ab_encode.h");
    println!("cargo:rerun-if-changed=shaders/rgba_to_nv12.comp");

    if std::env::var_os("CARGO_FEATURE_VAAPI").is_none() {
        return;
    }

    if !compile_shader() {
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

/// Compiles the RGBA→NV12 compute shader to SPIR-V.
///
/// Done here rather than committing the SPIR-V, so the binary cannot drift from
/// the source it claims to be. The cost is a build-time dependency on
/// `glslangValidator`; CI installs it alongside the GPU headers.
fn compile_shader() -> bool {
    let out = std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap_or_default())
        .join("rgba_to_nv12.spv");

    let result = std::process::Command::new("glslangValidator")
        .args(["-V", "--target-env", "vulkan1.1", "-o"])
        .arg(&out)
        .arg("shaders/rgba_to_nv12.comp")
        .output();

    match result {
        Ok(output) if output.status.success() => true,
        Ok(output) => {
            // glslang writes its diagnostics to stdout, not stderr, so a bare
            // exit code would hide the line number that matters.
            let detail = String::from_utf8_lossy(&output.stdout).replace('\n', " ");
            println!("cargo::error=the RGBA to NV12 shader did not compile: {detail}");
            false
        }
        Err(error) => {
            println!(
                "cargo::error=the `vaapi` feature needs glslangValidator to compile the \
                 shader. On Debian/Ubuntu: apt install glslang-tools. The error was: {error}"
            );
            false
        }
    }
}
