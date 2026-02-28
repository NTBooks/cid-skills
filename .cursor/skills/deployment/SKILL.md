---
name: deployment
description: Release and build Diamond Soul Downloader for Windows, WSL/Linux, and Mac. Use when preparing a release, building installers, or when the user asks about deployment, release tag, or multi-platform build.
---

# Deployment

Release flow for this repo: tag from `package.json` version first, then build on each platform. **The git tag must be created and pushed before the Mac build** (and ideally before any build so releases are consistent).

## Order of operations

1. **Bump version** in `package.json` (e.g. `0.1.8` → `0.1.9`).
2. **Commit and push** the version bump so the new tag will point at the right commit.
3. **Create and push the release tag**: `npm run prepdeploy`  
   - Reads `package.json` version, creates git tag `v{version}`, pushes it.  
   - Fails if version was not changed (avoids re-tagging).
4. **Build on each platform** (order is flexible after the tag is pushed):
   - **Windows** (native): `npm run dist:win`
   - **Linux** (from Windows via WSL): `npm run dist:linux:wsl`
   - **Mac**: `npm run dist:mac` (run on a Mac; tag must already exist)

## Build commands

| Command | Platform | Where to run |
|--------|----------|--------------|
| `npm run dist:win` | Windows (NSIS + portable) | Windows |
| `npm run dist:linux` | Linux (AppImage) | Linux or WSL |
| `npm run dist:linux:wsl` | Linux (AppImage) | Windows (invokes WSL) |
| `npm run dist:mac` | macOS (DMG + zip) | Mac |

Output goes to `dist/`. After builds, `cleanup:dist` runs automatically.

## Checklist

- [ ] Bump `version` in `package.json`
- [ ] Commit and push the version change
- [ ] Run `npm run prepdeploy` (tag and push tag)
- [ ] Build Windows: `npm run dist:win`
- [ ] Build Linux: `npm run dist:linux:wsl` (or `npm run dist:linux` on Linux/WSL)
- [ ] Build Mac: `npm run dist:mac` (on a Mac)

## Notes

- **prepdeploy** (`scripts/prepdeploy.js`): ensures `package.json` version is newer than the latest `v*` tag, then `git tag v{version}` and `git push origin v{version}`.
- Single-platform build: `npm run dist` builds for the current OS only.
- Pack without installers: `npm run pack` (output in `dist/`).
