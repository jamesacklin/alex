const { execSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = process.cwd();
const watcherRoot = path.join(root, 'watcher-rs');
const manifestPath = path.join(watcherRoot, 'Cargo.toml');
const distDir = path.join(watcherRoot, 'dist');

function cargoCacheRoot() {
  if (process.env.PDFIUM_CACHE_DIR) {
    return process.env.PDFIUM_CACHE_DIR;
  }

  if (process.env.CARGO_HOME) {
    return path.join(process.env.CARGO_HOME, 'cache');
  }

  return path.join(os.homedir(), '.cargo', 'cache');
}

function watcherBinaryName() {
  return process.platform === 'win32' ? 'watcher-rs.exe' : 'watcher-rs';
}

function runtimeLibraryName() {
  if (process.platform === 'linux') return 'libpdfium.so';
  if (process.platform === 'darwin') return 'libpdfium.dylib';
  if (process.platform === 'win32') return 'pdfium.dll';
  return null;
}

function archSuffix() {
  if (process.arch === 'x64') return 'x64';
  if (process.arch === 'arm64') return 'arm64';
  throw new Error(`Unsupported architecture for watcher-rs dist prep: ${process.arch}`);
}

function possiblePdfiumPaths() {
  const cache = path.join(cargoCacheRoot(), 'pdfium');
  const arch = archSuffix();

  if (process.platform === 'linux') {
    return [
      path.join(cache, `chromium-7543-pdfium-linux-${arch}`, 'lib', 'libpdfium.so'),
      path.join(cache, `chromium-7543-pdfium-linux-musl-${arch}`, 'lib', 'libpdfium.so'),
    ];
  }

  if (process.platform === 'darwin') {
    return [
      path.join(cache, `chromium-7543-pdfium-mac-${arch}`, 'lib', 'libpdfium.dylib'),
    ];
  }

  if (process.platform === 'win32') {
    return [
      path.join(cache, `chromium-7543-pdfium-win-${arch}`, 'bin', 'pdfium.dll'),
    ];
  }

  return [];
}

function firstExistingPath(paths) {
  for (const p of paths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return null;
}

function main() {
  console.log('[watcher-rs] Building release binary...');
  execSync(`cargo build --manifest-path "${manifestPath}" --release --locked`, {
    cwd: root,
    stdio: 'inherit',
  });

  const binary = path.join(watcherRoot, 'target', 'release', watcherBinaryName());
  if (!fs.existsSync(binary)) {
    throw new Error(`Built watcher binary not found: ${binary}`);
  }

  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(distDir, { recursive: true });

  const distBinary = path.join(distDir, watcherBinaryName());
  fs.copyFileSync(binary, distBinary);
  if (process.platform !== 'win32') {
    fs.chmodSync(distBinary, 0o755);
  }

  const libName = runtimeLibraryName();
  if (libName) {
    const libPath = firstExistingPath(possiblePdfiumPaths());

    if (libPath) {
      const distLibPath = path.join(distDir, libName);
      fs.copyFileSync(libPath, distLibPath);
      console.log(`[watcher-rs] Bundled runtime dependency: ${libName}`);
    } else if (process.platform === 'linux' || process.platform === 'win32') {
      throw new Error(
        `Could not find ${libName} in cargo PDFium cache. Run a watcher-rs build first and verify PDFium downloaded correctly.`
      );
    }
  }

  console.log(`[watcher-rs] Dist prepared at ${distDir}`);
}

main();
