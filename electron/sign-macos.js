// Ad-hoc sign macOS app to prevent "damaged" errors
// This is called via electron-builder's afterPack hook

const { execSync } = require('child_process');
const path = require('path');

exports.default = async function(context) {
  // Only run on macOS builds
  if (context.electronPlatformName !== 'darwin') {
    return;
  }

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  );

  console.log(`Ad-hoc signing: ${appPath}`);

  try {
    // Ad-hoc sign the entire app bundle
    execSync(`codesign --deep --force --sign - "${appPath}"`, {
      stdio: 'inherit'
    });
    console.log('✅ Ad-hoc signing complete');
  } catch (error) {
    console.error('❌ Ad-hoc signing failed:', error.message);
    // Don't fail the build - unsigned is better than no build
  }
};
