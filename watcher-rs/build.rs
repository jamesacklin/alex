use flate2::read::GzDecoder;
use std::env;
use std::fs;
use std::io::copy;
use std::path::{Path, PathBuf};

const PDFIUM_TAG: &str = "chromium%2F7543";

fn main() {
    println!("cargo:rerun-if-env-changed=PDFIUM_STATIC_LIB_PATH");
    println!("cargo:rerun-if-env-changed=PDFIUM_CACHE_DIR");

    if let Ok(manual_static_path) = env::var("PDFIUM_STATIC_LIB_PATH") {
        let path = PathBuf::from(manual_static_path);
        link_static_pdfium(&path);
        return;
    }

    let target_os = env::var("CARGO_CFG_TARGET_OS").expect("missing target os");

    // Prefer a true static archive on macOS when available.
    if target_os == "macos" {
        if let Ok(lib_dir) = ensure_macos_static_pdfium() {
            link_static_pdfium(&lib_dir);
            return;
        }
    }

    // Fallback: download the official platform binary and link it at build time.
    let (asset_name, library_kind, search_subdir) = platform_dynamic_asset();
    let extracted_dir = ensure_archive_extracted(asset_name, &download_url(asset_name));
    let search_dir = extracted_dir.join(search_subdir);

    if !search_dir.exists() {
        panic!(
            "PDFium search directory not found: {}",
            search_dir.display()
        );
    }

    println!("cargo:rustc-link-search=native={}", search_dir.display());
    println!("cargo:rustc-link-lib={}={}", library_kind, "pdfium");

    let target_family = env::var("CARGO_CFG_TARGET_FAMILY").unwrap_or_default();
    if target_family == "unix" {
        println!("cargo:rustc-link-arg=-Wl,-rpath,{}", search_dir.display());
    }
}

fn ensure_macos_static_pdfium() -> Result<PathBuf, String> {
    let extracted_dir = ensure_archive_extracted(
        "pdfium-macos-static.tgz",
        "https://github.com/paulocoutinhox/pdfium-lib/releases/latest/download/macos.tgz",
    );
    let lib_dir = extracted_dir.join("release").join("lib");
    let static_lib = lib_dir.join("libpdfium.a");

    if static_lib.exists() {
        Ok(lib_dir)
    } else {
        Err(format!(
            "static libpdfium.a not found under {}",
            lib_dir.display()
        ))
    }
}

fn platform_dynamic_asset() -> (&'static str, &'static str, &'static str) {
    let target_os = env::var("CARGO_CFG_TARGET_OS").expect("missing target os");
    let target_arch = env::var("CARGO_CFG_TARGET_ARCH").expect("missing target arch");

    match (target_os.as_str(), target_arch.as_str()) {
        ("macos", "aarch64") => ("pdfium-mac-arm64.tgz", "dylib", "lib"),
        ("macos", "x86_64") => ("pdfium-mac-x64.tgz", "dylib", "lib"),
        ("linux", "x86_64") => ("pdfium-linux-x64.tgz", "dylib", "lib"),
        ("linux", "aarch64") => ("pdfium-linux-arm64.tgz", "dylib", "lib"),
        ("windows", "x86_64") => ("pdfium-win-x64.tgz", "dylib", "lib"),
        _ => panic!(
            "Unsupported target for auto-downloaded PDFium: {}-{}",
            target_os, target_arch
        ),
    }
}

fn download_url(asset_name: &str) -> String {
    format!(
        "https://github.com/bblanchon/pdfium-binaries/releases/download/{}/{}",
        PDFIUM_TAG, asset_name
    )
}

fn ensure_archive_extracted(asset_name: &str, url: &str) -> PathBuf {
    let cache_dir = cache_root().join("pdfium");
    let key = format!(
        "{}-{}",
        sanitize_tag(PDFIUM_TAG),
        asset_name.trim_end_matches(".tgz")
    );
    let archive_path = cache_dir.join(format!("{}.tgz", key));
    let extract_dir = cache_dir.join(&key);

    if !extract_dir.exists() {
        fs::create_dir_all(&cache_dir).expect("failed to create PDFium cache dir");

        if !archive_path.exists() {
            download_file(url, &archive_path);
        }

        fs::create_dir_all(&extract_dir).expect("failed to create PDFium extract dir");
        let file = fs::File::open(&archive_path).expect("failed to open downloaded PDFium archive");
        let mut archive = tar::Archive::new(GzDecoder::new(file));
        archive
            .unpack(&extract_dir)
            .expect("failed to extract PDFium archive");
    }

    extract_dir
}

fn download_file(url: &str, destination: &Path) {
    let mut response = ureq::get(url)
        .call()
        .unwrap_or_else(|e| panic!("failed to download PDFium from {url}: {e}"));

    let mut out = fs::File::create(destination)
        .unwrap_or_else(|e| panic!("failed to create {}: {e}", destination.display()));

    let mut reader = response.body_mut().as_reader();
    copy(&mut reader, &mut out).unwrap_or_else(|e| {
        panic!(
            "failed writing PDFium archive {}: {e}",
            destination.display()
        )
    });
}

fn cache_root() -> PathBuf {
    if let Ok(dir) = env::var("PDFIUM_CACHE_DIR") {
        return PathBuf::from(dir);
    }

    if let Ok(cargo_home) = env::var("CARGO_HOME") {
        return PathBuf::from(cargo_home).join("cache");
    }

    if let Ok(home) = env::var("HOME") {
        return PathBuf::from(home).join(".cargo").join("cache");
    }

    PathBuf::from("target")
}

fn sanitize_tag(tag: &str) -> String {
    tag.replace("%2F", "-").replace('/', "-")
}

fn link_static_pdfium(path: &Path) {
    println!("cargo:rustc-link-search=native={}", path.display());
    println!("cargo:rustc-link-lib=static=pdfium");

    let target_os = env::var("CARGO_CFG_TARGET_OS").expect("missing target os");

    match target_os.as_str() {
        "macos" => {
            println!("cargo:rustc-link-lib=dylib=c++");
            println!("cargo:rustc-link-lib=framework=CoreGraphics");
            println!("cargo:rustc-link-lib=framework=CoreFoundation");
            println!("cargo:rustc-link-lib=framework=CoreText");
        }
        "linux" => {
            println!("cargo:rustc-link-lib=dylib=stdc++");
            println!("cargo:rustc-link-lib=dylib=m");
            println!("cargo:rustc-link-lib=dylib=dl");
            println!("cargo:rustc-link-lib=dylib=pthread");
        }
        _ => {}
    }
}
