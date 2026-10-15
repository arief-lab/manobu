#[cfg(unix)]
use std::env;
#[cfg(unix)]
use std::fs;
#[cfg(unix)]
use std::os::unix::fs::symlink;
#[cfg(unix)]
use std::path::PathBuf;

/// Import libraries the cargo-xwin SDK stores under a different casing than the
/// name the prebuilt Windows binaries request: `(name to create, name on disk)`.
///
/// `onnxruntime.lib` carries a `/DEFAULTLIB:"PathCch.lib"` directive, and
/// `lld-link` on a case-sensitive host opens that name verbatim, while the SDK
/// ships `pathcch.lib`. Native `link.exe` folds case, so this only bites when
/// cross-building a Windows target from Linux or macOS.
#[cfg(unix)]
const IMPORT_LIB_CASE_ALIASES: [(&str, &str); 1] = [("PathCch.lib", "pathcch.lib")];

fn main() {
    link_import_lib_aliases();
    tauri_build::build()
}

/// Point the linker at a generated directory holding the correctly-cased alias,
/// so no `/DEFAULTLIB` directive has to be satisfied by the SDK's spelling.
#[cfg(unix)]
fn link_import_lib_aliases() {
    if env::var("CARGO_CFG_TARGET_OS").ok().as_deref() != Some("windows") {
        return;
    }
    let target = env::var("TARGET").unwrap_or_default();
    let rustflags_var = format!(
        "CARGO_TARGET_{}_RUSTFLAGS",
        target.replace('-', "_").to_uppercase()
    );
    println!("cargo:rerun-if-env-changed=TARGET");
    println!("cargo:rerun-if-env-changed={rustflags_var}");

    // Only cargo-xwin sets that variable: it is what puts the MSVC CRT and SDK
    // library directories on the search path for a cross build.
    let rustflags = match env::var(&rustflags_var) {
        Ok(value) => value,
        Err(_) => {
            println!("cargo:warning=not cross-building with cargo-xwin, skipping the import-library case aliases");
            return;
        }
    };
    let search_dirs = native_search_dirs(&rustflags);
    if search_dirs.is_empty() {
        println!("cargo:warning=no -Lnative directories in {rustflags_var}, skipping the import-library case aliases");
        return;
    }

    let alias_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR is set for a build script"))
        .join("win-import-lib-aliases");
    let mut aliased = Vec::new();
    for (wanted, on_disk) in IMPORT_LIB_CASE_ALIASES {
        let Some(source) = search_dirs
            .iter()
            .map(|dir| dir.join(on_disk))
            .find(|candidate| candidate.is_file())
        else {
            println!("cargo:warning={on_disk} not found in the linker search path, so the {wanted} alias cannot be created");
            continue;
        };
        if !alias_dir.is_dir() {
            fs::create_dir_all(&alias_dir).expect("create the import-library alias directory");
        }
        let alias = alias_dir.join(wanted);
        // A rebuild must not fail on the alias left by the previous run.
        let _ = fs::remove_file(&alias);
        symlink(&source, &alias)
            .unwrap_or_else(|error| panic!("link {wanted} to {}: {error}", source.display()));
        aliased.push(wanted);
    }
    if !aliased.is_empty() {
        println!("cargo:rustc-link-search=native={}", alias_dir.display());
        println!(
            "cargo:warning=aliased mis-cased import libraries for {target}: {}",
            aliased.join(", ")
        );
    }
}

#[cfg(not(unix))]
fn link_import_lib_aliases() {}

/// Pull the `-Lnative=<dir>` entries out of a space-separated RUSTFLAGS value.
/// The directories come from cargo-xwin's own cache path, which this assumes
/// carries no spaces (a space inside `-Lnative=` would already break the
/// linker invocation cargo-xwin generates).
#[cfg(unix)]
fn native_search_dirs(rustflags: &str) -> Vec<PathBuf> {
    const FLAG: &str = "-Lnative=";
    rustflags
        .split_whitespace()
        .filter_map(|arg| arg.strip_prefix(FLAG))
        .map(PathBuf::from)
        .filter(|path| path.is_dir())
        .collect()
}
