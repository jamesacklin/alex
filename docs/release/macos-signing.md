# macOS release signing

The `electron-release.yml` workflow signs Alex with a Developer ID Application
certificate, notarizes it with Apple, and uploads both a DMG and ZIP to the
GitHub release. The ZIP remains available for the Homebrew cask.

## Required GitHub Actions secrets

Create these repository secrets before publishing a release:

| Secret | Value |
| --- | --- |
| `MACOS_CERTIFICATE` | Base64-encoded password-protected `.p12` export of `Developer ID Application: James Acklin (FTFY9QQ2XQ)`. |
| `MACOS_CERTIFICATE_PASSWORD` | Password used when exporting that `.p12`. |
| `APPLE_API_KEY` | Literal contents of the replacement App Store Connect API key `.p8` file. |
| `APPLE_API_KEY_ID` | The API key's Key ID. |
| `APPLE_API_ISSUER` | The App Store Connect issuer ID. |

Never commit, paste, or log the certificate, `.p12` password, or API key. The
API key must be a replacement for any key that was exposed.

To create the base64 values on macOS without adding a trailing newline:

```sh
base64 < DeveloperIDApplication.p12 | tr -d '\n'
base64 < AuthKey_KEY_ID.p8 | tr -d '\n'
```

The workflow writes `APPLE_API_KEY` to a protected temporary `.p8` file on the
GitHub-hosted runner, then deletes the runner after the job. Do not base64
encode this secret: the version of electron-builder used by Alex needs a file
path and the workflow creates that file from the secret.

## Verify a release

After the release workflow completes, download the DMG and run these checks on
a Mac:

```sh
codesign --verify --deep --strict --verbose=2 /Applications/Alex.app
spctl --assess --verbose --type exec /Applications/Alex.app
xcrun stapler validate /Applications/Alex.app
```

Gatekeeper should report `source=Notarized Developer ID`, and the stapler
validation should succeed.
