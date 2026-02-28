---
name: deployment
description: Release and build Diamond Soul Downloader for Windows, WSL/Linux, and Mac. Use when preparing a release, building installers, or when the user asks about deployment, release tag, or multi-platform build.
---

# Deployment

Release flow for this repo: tag from `package.json` version first, then build on each platform. **The git tag must be created and pushed before the Mac build** (and ideally before any build so releases are consistent).

## Order of operations

1. **Bump version** in `package.json` (e.g. `0.1.8` → `0.1.9`).
2. **Commit** the version bump (prepdeploy will refuse to run if the bump is uncommitted).
3. **Create and push the release tag**: `npm run prepdeploy`  
   - Ensures the version in `package.json` is committed (so the tag points at the build that has that version).  
   - Pushes the current branch, then creates and pushes git tag `v{version}`.  
   - Fails if version was not changed or if the bump is uncommitted (avoids tagging the wrong commit).
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
- [ ] Commit the version change (prepdeploy will push the branch and create/push the tag)
- [ ] Run `npm run prepdeploy`
- [ ] Build Windows: `npm run dist:win`
- [ ] Build Linux: `npm run dist:linux:wsl` (or `npm run dist:linux` on Linux/WSL)
- [ ] Build Mac: `npm run dist:mac` (on a Mac)

## Notes

- **prepdeploy** (`scripts/prepdeploy.js`): ensures the version bump is committed (so the tag matches the built version), pushes the current branch, then creates and pushes tag `v{version}`. Fails if the bump is uncommitted or if version was not updated since the latest tag.
- Single-platform build: `npm run dist` builds for the current OS only.
- Pack without installers: `npm run pack` (output in `dist/`).
