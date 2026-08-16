#!/usr/bin/env bash
##############################################################################
# publish-fdroid.sh — Test-build Coracle's Android release, then prepare the
# F-Droid metadata recipe in ../fdroiddata.
#
# F-Droid builds every APK itself, from source, on its own servers — this
# script does NOT upload a binary anywhere. It only:
#
#   1. Runs, locally, the exact same build steps F-Droid's build server would
#      run (pnpm build + cap sync + gradle assembleRelease, unsigned APK) as a
#      sanity check that the recipe below actually works.
#   2. Writes metadata/social.coracle.app.yml in the fdroiddata fork, pointing
#      at the current HEAD commit — which must already be pushed to
#      github.com/papiche/coracle, since that's the public repo F-Droid clones.
#   3. Commits that file on a local "coracle" branch in fdroiddata (branched
#      from origin/master), ready for you to review, push and open a merge
#      request — same workflow already used for Ẑelkova and TrocZen.
#
# Usage:
#   ./publish-fdroid.sh                # test build + write/commit the recipe
#   ./publish-fdroid.sh --skip-build   # only write/commit the recipe
##############################################################################

set -e

CORACLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FDROIDDATA_DIR="$(cd "$CORACLE_DIR/../fdroiddata" && pwd)"
APP_ID="social.coracle.app"
METADATA_FILE="$FDROIDDATA_DIR/metadata/${APP_ID}.yml"
BRANCH="coracle"

SKIP_BUILD="no"
[[ "${1:-}" == "--skip-build" ]] && SKIP_BUILD="yes"

cd "$CORACLE_DIR"

# --- HEAD must be pushed: F-Droid clones the public GitHub repo, not this checkout ---
if [[ -n "$(git status --porcelain)" ]]; then
  echo "ERROR: uncommitted changes in coracle — commit or stash first." >&2
  exit 1
fi

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
COMMIT="$(git rev-parse HEAD)"

git fetch origin "$CURRENT_BRANCH" --quiet || true
if ! git merge-base --is-ancestor "$COMMIT" "origin/$CURRENT_BRANCH" 2>/dev/null; then
  echo "ERROR: HEAD ($COMMIT) isn't pushed to origin/$CURRENT_BRANCH yet." >&2
  echo "F-Droid's build server clones github.com/papiche/coracle — push first." >&2
  exit 1
fi

VERSION_NAME="$(grep -oP 'versionName = "\K[^"]+' android/app/build.gradle)"
VERSION_CODE="$(grep -oP 'versionCode = \K[0-9]+' android/app/build.gradle)"

echo "=== Coracle → F-Droid ==="
echo "Branch:  $CURRENT_BRANCH"
echo "Commit:  $COMMIT"
echo "Version: $VERSION_NAME ($VERSION_CODE)"
echo

# --- 1. Local sanity build: the same steps the recipe below asks F-Droid to run ---
if [[ "$SKIP_BUILD" == "no" ]]; then
  echo "--- Test build (mirrors the F-Droid recipe's build steps) ---"

  if ! command -v pnpm >/dev/null 2>&1 && [ -s "$HOME/.nvm/nvm.sh" ]; then
    export NVM_DIR="$HOME/.nvm"
    # shellcheck disable=SC1091
    source "$NVM_DIR/nvm.sh"
    nvm use >/dev/null 2>&1 || nvm install
  fi
  command -v corepack >/dev/null 2>&1 && corepack enable >/dev/null 2>&1 || true
  command -v pnpm >/dev/null 2>&1 || { echo "ERROR: pnpm not found." >&2; exit 1; }

  # gradlew needs to find the SDK; local.properties is gitignored/machine-specific,
  # so fall back to the conventional install location if no env var is already set.
  if [[ -z "${ANDROID_HOME:-}" && -z "${ANDROID_SDK_ROOT:-}" && -d "$HOME/Android/Sdk" ]]; then
    export ANDROID_HOME="$HOME/Android/Sdk"
    export ANDROID_SDK_ROOT="$HOME/Android/Sdk"
  fi

  pnpm install --frozen-lockfile
  pnpm rebuild
  pnpm run build
  (cd android && ./gradlew assembleRelease)

  APK="android/app/build/outputs/apk/release/app-release-unsigned.apk"
  [[ -f "$APK" ]] || { echo "ERROR: build did not produce $APK" >&2; exit 1; }
  echo "✅ Local test build OK: $APK ($(du -h "$APK" | cut -f1))"
  echo
else
  echo "--- Skipping local test build (--skip-build) ---"
  echo
fi

# --- 2. Write the F-Droid metadata recipe ---
[[ -d "$FDROIDDATA_DIR" ]] || { echo "ERROR: fdroiddata not found at $FDROIDDATA_DIR" >&2; exit 1; }

cd "$FDROIDDATA_DIR"
if [[ -n "$(git status --porcelain)" ]]; then
  echo "ERROR: fdroiddata has uncommitted changes — commit or stash first." >&2
  exit 1
fi

if [[ -f "$METADATA_FILE" ]]; then
  echo "⚠️  $METADATA_FILE already exists — not overwriting."
  echo "    Add a new entry at the top of its Builds: list by hand:"
  echo
  cat <<EOF
  - versionName: "$VERSION_NAME"
    versionCode: $VERSION_CODE
    commit: $COMMIT
    output: android/app/build/outputs/apk/release/app-release-unsigned.apk
    prebuild:
      - corepack enable
      - corepack prepare pnpm@9.15.9 --activate
      - pnpm install --frozen-lockfile
      - pnpm rebuild
    build:
      - pnpm run build
      - cd android && ./gradlew assembleRelease
EOF
  echo
  echo "Then run 'fdroid rewritemeta $APP_ID' (fdroidserver) to canonicalise formatting."
  exit 0
fi

git fetch origin master --quiet || true
git checkout -B "$BRANCH" origin/master

cat > "$METADATA_FILE" <<EOF
Categories:
  - Social Network
License: MIT
AuthorName: Fred (qo-op)
AuthorEmail: support@qo-op.com
WebSite: https://coracle.social
SourceCode: https://github.com/papiche/coracle
IssueTracker: https://github.com/papiche/coracle/issues

AutoName: Coracle

RepoType: git
Repo: https://github.com/papiche/coracle

Builds:
  - versionName: "$VERSION_NAME"
    versionCode: $VERSION_CODE
    commit: $COMMIT
    output: android/app/build/outputs/apk/release/app-release-unsigned.apk
    prebuild:
      - corepack enable
      - corepack prepare pnpm@9.15.9 --activate
      - pnpm install --frozen-lockfile
      - pnpm rebuild
    build:
      - pnpm run build
      - cd android && ./gradlew assembleRelease

MaintainerNotes: |-
  Svelte + Capacitor PWA — UPlanet/Ẑen cooperative-economy fork of Coracle
  (github.com/coracle-social/coracle upstream).
  "pnpm run build" runs pwa-assets-generator + vite build + "cap sync" in one
  step, so no separate cap sync call is needed before the gradle build.
  No Firebase/GMS: android/app/build.gradle only applies
  com.google.gms.google-services when a google-services.json file is present,
  which is not checked into the repo, so it never activates. Capacitor
  plugins used are all FOSS (@capacitor-community/safe-area, @capacitor/app,
  @capacitor/filesystem, nostr-signer-capacitor-plugin).

ArchivePolicy: 2
AutoUpdateMode: None
UpdateCheckMode: Static
CurrentVersion: "$VERSION_NAME"
CurrentVersionCode: $VERSION_CODE
EOF

git add "metadata/${APP_ID}.yml"
git commit -m "New app: Coracle ($APP_ID)"

echo "✅ Recipe written: $METADATA_FILE"
echo "✅ Committed on branch '$BRANCH' in fdroiddata (nothing pushed)."
echo
echo "Next steps:"
echo "  cd $FDROIDDATA_DIR"
echo "  fdroid build --test $APP_ID:$VERSION_CODE   # if fdroidserver is installed — full server-side rebuild check"
echo "  git push -u origin $BRANCH                  # then open the merge request"
