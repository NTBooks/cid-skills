#!/bin/bash
# Wraps a pkg-built linux binary into a Linux AppImage.
# Usage: bash scripts/make-appimage.sh <version>
# Expects: dist/dsoul-<version>-linux already exists (built by pkg-build.js)
set -e

VERSION="${1:?Version argument required}"
APP_NAME="dsoul"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"
BINARY="$DIST_DIR/${APP_NAME}-${VERSION}-linux"
OUTPUT="$DIST_DIR/${APP_NAME}-${VERSION}-linux.AppImage"
TMP_DIR="$DIST_DIR/.appimage-tmp"
TOOLS_DIR="$ROOT_DIR/.appimage-tools"
APPDIR="$TMP_DIR/AppDir"

cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

if [ ! -f "$BINARY" ]; then
  echo "Error: binary not found at $BINARY"
  exit 1
fi

echo "Setting up AppDir..."
rm -rf "$TMP_DIR"
mkdir -p "$APPDIR/usr/bin"

cp "$BINARY" "$APPDIR/usr/bin/$APP_NAME"
chmod +x "$APPDIR/usr/bin/$APP_NAME"

cat > "$APPDIR/AppRun" <<'APPRUN'
#!/bin/sh
exec "$APPDIR/usr/bin/dsoul" "$@"
APPRUN
chmod +x "$APPDIR/AppRun"

cp "$ROOT_DIR/public/DSLOGO.png" "$APPDIR/${APP_NAME}.png"

cat > "$APPDIR/${APP_NAME}.desktop" <<DESKTOP
[Desktop Entry]
Name=Diamond Soul Downloader
Exec=dsoul
Icon=dsoul
Type=Application
Categories=Utility;
Terminal=true
DESKTOP

mkdir -p "$TOOLS_DIR"
APPIMAGETOOL="$TOOLS_DIR/appimagetool-x86_64.AppImage"
if [ ! -f "$APPIMAGETOOL" ]; then
  echo "Downloading appimagetool..."
  curl -fSL -o "$APPIMAGETOOL" \
    "https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-x86_64.AppImage"
  chmod +x "$APPIMAGETOOL"
fi

echo "Building AppImage → $OUTPUT"
APPIMAGE_EXTRACT_AND_RUN=1 ARCH=x86_64 "$APPIMAGETOOL" "$APPDIR" "$OUTPUT"

echo "Done: $OUTPUT"
