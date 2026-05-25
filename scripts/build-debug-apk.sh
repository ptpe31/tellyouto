#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"

VERSION="$(node -p "require('./app.json').expo.version" 2>/dev/null || echo "1.0.0")"
STAMP="$(date +%Y%m%d-%H%M)"
APK_NAME="TalknDone-debug-v${VERSION}-${STAMP}.apk"
OUT_DIR="$ROOT/dist"
GRADLE_APK="$ROOT/android/app/build/outputs/apk/debug/app-debug.apk"

echo "==> Gradle assembleDebug"
cd "$ROOT/android"
./gradlew assembleDebug --no-daemon

if [[ ! -f "$GRADLE_APK" ]]; then
  echo "APK introuvable: $GRADLE_APK" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
cp "$GRADLE_APK" "$OUT_DIR/$APK_NAME"
echo "==> APK local: $OUT_DIR/$APK_NAME"

# Copie vers Google Drive si le dossier est monté (chemins macOS usuels)
DRIVE_CANDIDATES=(
  "$HOME/Library/CloudStorage/GoogleDrive-"*"/Mon Drive/Trankil"
  "$HOME/Library/CloudStorage/GoogleDrive-"*"/My Drive/Trankil"
  "$HOME/Google Drive/Mon Drive/Trankil"
  "$HOME/Google Drive/My Drive/Trankil"
)

for dir in "${DRIVE_CANDIDATES[@]}"; do
  if [[ -d "$dir" ]]; then
    cp "$OUT_DIR/$APK_NAME" "$dir/$APK_NAME"
    echo "==> Copié sur Drive: $dir/$APK_NAME"
    exit 0
  fi
done

echo "==> Google Drive non trouvé — uploadez manuellement depuis dist/"
