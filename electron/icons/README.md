# Electron Icons

This directory should contain the application icons:

- `icon.icns` - macOS app icon (512x512 or higher, .icns format)
- `tray-Template.png` - macOS tray icon (16x16 or 32x32, template format with @2x variant)

## Creating Icons

For macOS app icon (.icns):
1. Create a 512x512 or 1024x1024 PNG icon
2. Use `iconutil` or an online converter to create .icns file
3. Place it as `icon.icns` in this directory

For tray icon:
1. Create a 16x16 monochrome PNG (black on transparent)
2. Name it `tray-Template.png` (Template suffix enables automatic theme adaptation)
3. Optionally create a 32x32 version named `tray-Template@2x.png`

Note: These are currently placeholders. Add actual icon files before building for production.
