#!/usr/bin/env bash
##############################################################################
# build-web-compatible-ipfs.sh — Build Coracle for IPFS deployment
#
# Usage:  ./build-web-compatible-ipfs.sh [gateway_base_url] [--skip-apk]
#
# Example:
#   ./build-web-compatible-ipfs.sh
#   ./build-web-compatible-ipfs.sh https://dweb.link
#   ./build-web-compatible-ipfs.sh "" --skip-apk
#
# The script:
#   1. Overrides env vars to use relative paths (./images/...)
#   2. Builds the Svelte app with base: "./" (set in vite.config.js)
#   3. Removes service worker (incompatible with IPFS gateways)
#   4. Builds the signed Android release APK, adds it to IPFS under its own
#      CID, and writes dist/apk-info.json so the published site can link
#      straight to /ipfs/<APK_CID> (see About.svelte) — skipped automatically
#      if the Android SDK / release keystore isn't set up (--skip-apk to force)
#   5. Publishes dist/ to IPFS via `ipfs add -rw`
#   6. Prints the gateway URL
##############################################################################

set -e

GATEWAY="${1:-https://ipfs.copylaradio.com}"
SKIP_APK="no"
[[ "${2:-}" == "--skip-apk" ]] && SKIP_APK="yes"

echo "=== Building Coracle for IPFS ==="

# Ensure pnpm is on PATH — activate nvm's Node (see .nvmrc) if it isn't already,
# since a plain login shell without a default nvm alias falls back to system node.
if ! command -v pnpm >/dev/null 2>&1 && [ -s "$HOME/.nvm/nvm.sh" ]; then
  export NVM_DIR="$HOME/.nvm"
  # shellcheck disable=SC1091
  source "$NVM_DIR/nvm.sh"
  nvm use >/dev/null 2>&1 || nvm install
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "ERROR: pnpm not found. Install Node $(cat .nvmrc 2>/dev/null || echo 22) via nvm and enable corepack." >&2
  exit 1
fi

# Install deps if needed
if [ ! -d node_modules ]; then
  echo "--- Installing dependencies ---"
  pnpm i
fi

# Several packages (pwa-assets-generator, @capacitor/assets) bundle their own
# pinned sharp version with a native binding that pnpm doesn't always build —
# rebuild every native dependency to be sure (see build-in-production.sh)
echo "--- Rebuilding native dependencies (sharp) ---"
pnpm rebuild

# Override absolute image paths to relative for IPFS compatibility
# VITE_APP_LOGO stays absolute (used by pwa-assets-generator with "public" prefix)
export VITE_APP_WORDMARK_DARK=./images/wordmark-dark.png
export VITE_APP_WORDMARK_LIGHT=./images/wordmark-light.png

# Build (can take a couple minutes: pwa-assets-generator + vite build + cap sync)
echo "--- Building ---"
NODE_OPTIONS=--max_old_space_size=16384 pnpm run build 2>&1 | grep -v "^\[fatal\]"
BUILD_STATUS=${PIPESTATUS[0]}

if [ "$BUILD_STATUS" -ne 0 ]; then
  echo "ERROR: pnpm run build failed (exit $BUILD_STATUS)"
  exit 1
fi

if [ ! -f dist/index.html ]; then
  echo "ERROR: Build failed — dist/index.html not found"
  exit 1
fi

# Remove service worker files (incompatible with IPFS gateways)
echo "--- Removing service worker (incompatible with IPFS gateways) ---"
rm -f dist/sw.js dist/sw.js.map dist/workbox-*.js dist/workbox-*.js.map
sed -i '/<script.*registerSW/d' dist/index.html 2>/dev/null || true

# Build the signed Android release APK and add it to IPFS under its own CID
# (kept separate from dist/'s CID — the APK doesn't need to be re-fetched by
# every web-app visitor, and its own content-address never changes retroactively).
# "pnpm run build" already ran "cap sync" above, so android/ is up to date.
if [ "$SKIP_APK" = "no" ]; then
  echo "--- Building signed Android release APK ---"
  if [ ! -f android/key.properties ]; then
    echo "WARNING: android/key.properties not found — skipping APK (release build would be unsigned)."
  elif [ ! -x android/gradlew ]; then
    echo "WARNING: android/gradlew not found — skipping APK."
  else
    if [ -z "${ANDROID_HOME:-}" ] && [ -z "${ANDROID_SDK_ROOT:-}" ] && [ -d "$HOME/Android/Sdk" ]; then
      export ANDROID_HOME="$HOME/Android/Sdk"
      export ANDROID_SDK_ROOT="$HOME/Android/Sdk"
    fi
    if (cd android && ./gradlew assembleRelease --console=plain); then
      APK="android/app/build/outputs/apk/release/app-release.apk"
      VERSION_NAME=$(grep -oP 'versionName = "\K[^"]+' android/app/build.gradle)
      if [ -f "$APK" ]; then
        # Wrap in a directory (-w) so the CID resolves as /ipfs/<CID>/<filename>
        # — a real filename in the URL, not just a bare content hash.
        APK_FILENAME="coracle-${VERSION_NAME}.apk"
        APK_TMPDIR=$(mktemp -d)
        cp "$APK" "$APK_TMPDIR/$APK_FILENAME"
        APK_CID=$(ipfs add -wq --pin --cid-version 1 "$APK_TMPDIR/$APK_FILENAME" | tail -1)
        rm -rf "$APK_TMPDIR"
        printf '{"cid":"%s","version":"%s","filename":"%s"}\n' \
          "$APK_CID" "$VERSION_NAME" "$APK_FILENAME" > dist/apk-info.json
        echo "✅ APK added to IPFS: /ipfs/${APK_CID}/${APK_FILENAME} (v${VERSION_NAME}, $(du -h "$APK" | cut -f1))"
      else
        echo "WARNING: gradle succeeded but $APK not found — skipping APK."
      fi
    else
      echo "WARNING: Android release build failed — publishing web build without the APK."
    fi
  fi
else
  echo "--- Skipping APK build (--skip-apk) ---"
fi

# Publish to IPFS
echo "--- Publishing to IPFS ---"
IPFS_OUTPUT=$(ipfs add -rw --pin dist/*)
ROOT_CID=$(echo "$IPFS_OUTPUT" | tail -1 | awk '{print $2}')

echo ""
echo "=== Published to IPFS ==="
echo "CID:  $ROOT_CID"
echo "URL:  ${GATEWAY}/ipfs/${ROOT_CID}/"
if [ -n "${APK_CID:-}" ]; then
  echo "APK:  ${GATEWAY}/ipfs/${APK_CID}/${APK_FILENAME}"
fi
echo ""
echo "$IPFS_OUTPUT"
