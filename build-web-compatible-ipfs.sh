#!/usr/bin/env bash
##############################################################################
# build-web-compatible-ipfs.sh — Build Coracle for IPFS deployment
#
# Usage:  ./build-web-compatible-ipfs.sh [gateway_base_url] [--skip-apk] [--skip-dns]
#
# Example:
#   ./build-web-compatible-ipfs.sh
#   ./build-web-compatible-ipfs.sh https://dweb.link
#   ./build-web-compatible-ipfs.sh "" --skip-apk
#   ./build-web-compatible-ipfs.sh "" --skip-dns
#
# The script:
#   1. Overrides env vars to use relative paths (./images/...)
#   2. Builds the Svelte app with base: "./" (set in vite.config.js)
#   3. Removes service worker (incompatible with IPFS gateways)
#   4. Builds the signed Android release APK and copies www/ (a static
#      landing/comparison page, see www/index.html) plus the APK itself into
#      dist/www/ — published under the SAME CID as the app, so the "download"
#      link in About.svelte is a plain relative "./www/" with zero extra
#      publishing/DNS steps. Skipped automatically if the Android SDK /
#      release keystore isn't set up (--skip-apk to force).
#   5. Publishes dist/ to IPFS via `ipfs add -rw`
#   6. Repoints coracle.astroport.one's DNSLink at the new root CID via
#      ovh.me.sh (Astroport.ONE) — skipped automatically if that script or
#      its OVH credentials aren't available (--skip-dns to force).
#   7. Prints the gateway URL
##############################################################################

set -e

MY_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

GATEWAY="${1:-https://ipfs.copylaradio.com}"
SKIP_APK="no"
SKIP_DNS="no"
for arg in "${@:2}"; do
  case "$arg" in
    --skip-apk) SKIP_APK="yes" ;;
    --skip-dns) SKIP_DNS="yes" ;;
  esac
done

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

# Remove service worker build artifacts (incompatible with IPFS gateways —
# a SW would keep serving a stale gateway-specific CID after every future
# publish) and strip the registration <script> so FRESH visitors never
# install one in the first place.
echo "--- Removing service worker (incompatible with IPFS gateways) ---"
rm -f dist/sw.js.map dist/workbox-*.js dist/workbox-*.js.map
sed -i '/<script.*registerSW/d' dist/index.html 2>/dev/null || true

# Kill-switch for visitors who ALREADY have a service worker registered on
# this origin (from before it was stripped): a browser only re-checks a
# registered SW for updates by re-fetching the EXACT SAME url it registered
# ("./sw.js") and diffing the bytes — merely deleting that file (404) does
# NOT unregister the worker; the browser just keeps the last-installed one
# running forever, silently serving its cached (and increasingly stale)
# index.html/JS to every visit. That worker intercepts every fetch it
# controls, including index.html itself, so shipping a fix INSIDE index.html
# (tried previously) can never reach an already-affected visitor — the
# fetch is served from the SW's own cache before it ever hits the network.
# Publishing a byte-different /sw.js at the SAME url is the only thing that
# gets picked up by that background check: this replaces the Workbox
# service worker with a minimal one that unregisters itself, wipes every
# Cache Storage entry, and reloads all open tabs — after which no SW
# controls the origin anymore and every future publish is fetched fresh.
cat > dist/sw.js <<'EOF'
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map((name) => caches.delete(name)));
    await self.registration.unregister();
    const clientsList = await self.clients.matchAll({type: 'window'});
    for (const client of clientsList) {
      client.navigate(client.url);
    }
  })());
});
EOF

# Build the signed Android release APK and bundle it with www/ (landing +
# comparison page) into dist/www/ — same CID as the rest of the app.
# "pnpm run build" already ran "cap sync" above, so android/ is up to date.
APK_PAGE_STATUS="skipped"
if [ "$SKIP_APK" = "no" ]; then
  echo "--- Building signed Android release APK ---"
  if [ ! -f android/key.properties ]; then
    echo "WARNING: android/key.properties not found — skipping APK (release build would be unsigned)."
    APK_PAGE_STATUS="skipped (no key.properties)"
  elif [ ! -x android/gradlew ]; then
    echo "WARNING: android/gradlew not found — skipping APK."
    APK_PAGE_STATUS="skipped (no gradlew)"
  else
    if [ -z "${ANDROID_HOME:-}" ] && [ -z "${ANDROID_SDK_ROOT:-}" ] && [ -d "$HOME/Android/Sdk" ]; then
      export ANDROID_HOME="$HOME/Android/Sdk"
      export ANDROID_SDK_ROOT="$HOME/Android/Sdk"
    fi
    if (cd android && ./gradlew assembleRelease --console=plain); then
      APK="android/app/build/outputs/apk/release/app-release.apk"
      VERSION_NAME=$(grep -oP 'versionName = "\K[^"]+' android/app/build.gradle)
      if [ -f "$APK" ]; then
        mkdir -p dist/www
        cp www/index.html dist/www/index.html
        cp "$APK" dist/www/coracle.apk
        echo "✅ APK bundled: dist/www/coracle.apk (v${VERSION_NAME}, $(du -h "$APK" | cut -f1))"
        APK_PAGE_STATUS="bundled (v${VERSION_NAME})"
      else
        echo "WARNING: gradle succeeded but $APK not found — skipping APK."
        APK_PAGE_STATUS="failed (APK not found after build)"
      fi
    else
      echo "WARNING: Android release build failed — publishing web build without the APK."
      APK_PAGE_STATUS="failed (gradle build failed)"
    fi
  fi
else
  echo "--- Skipping APK build (--skip-apk) ---"
fi

# Publish to IPFS
echo "--- Publishing to IPFS ---"
IPFS_OUTPUT=$(ipfs add -rw --pin dist/*)
ROOT_CID=$(echo "$IPFS_OUTPUT" | tail -1 | awk '{print $2}')

# Repoint coracle.astroport.one's DNSLink at the new root CID.
DNS_STATUS="skipped"
if [ "$SKIP_DNS" = "no" ]; then
  echo "--- Updating DNSLink (coracle.astroport.one) ---"
  OVH_SCRIPT="${MY_PATH}/../Astroport.ONE/admin/system/ovh.me.sh"
  [ -f "$OVH_SCRIPT" ] || OVH_SCRIPT="${HOME}/.zen/Astroport.ONE/admin/system/ovh.me.sh"
  [ -f "$OVH_SCRIPT" ] || OVH_SCRIPT="${HOME}/workspace/AAA/Astroport.ONE/admin/system/ovh.me.sh"
  if [ -f "$OVH_SCRIPT" ]; then
    if bash "$OVH_SCRIPT" upsert coracle "$ROOT_CID" astroport.one; then
      DNS_STATUS="updated"
    else
      DNS_STATUS="failed (see warnings above — update manually if needed)"
    fi
  else
    echo "WARNING: ovh.me.sh not found — update DNSLink manually:"
    echo "  ovh.me.sh upsert coracle $ROOT_CID astroport.one"
    DNS_STATUS="ovh.me.sh not found"
  fi
else
  echo "--- Skipping DNSLink update (--skip-dns) ---"
fi

echo ""
echo "=== Published to IPFS ==="
echo "CID:  $ROOT_CID"
echo "URL:  ${GATEWAY}/ipfs/${ROOT_CID}/"
echo "APK:  ${GATEWAY}/ipfs/${ROOT_CID}/www/ → ${APK_PAGE_STATUS}"
echo "DNS:  coracle.astroport.one → ${DNS_STATUS}"
echo ""
echo "$IPFS_OUTPUT"
