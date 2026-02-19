const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const watcherRoot = path.join(root, 'watcher-rs');
const manifestPath = path.join(watcherRoot, 'Cargo.toml');
const rawArgs = process.argv.slice(2);
const args = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs;

function watcherBinaryName() {
  return process.platform === 'win32' ? 'watcher-rs.exe' : 'watcher-rs';
}

function runCommand(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  });

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    process.exit(result.status);
  }
}

function main() {
  const releaseBinary = path.join(watcherRoot, 'target', 'release', watcherBinaryName());

  if (fs.existsSync(releaseBinary)) {
    runCommand(releaseBinary, args);
    return;
  }

  console.error('[watcher-rs] Release binary not found; building via cargo build --release');
  runCommand('cargo', ['build', '--manifest-path', manifestPath, '--release', '--locked']);

  if (!fs.existsSync(releaseBinary)) {
    throw new Error(`[watcher-rs] Expected release binary at ${releaseBinary} after build`);
  }

  runCommand(releaseBinary, args);
}

main();
