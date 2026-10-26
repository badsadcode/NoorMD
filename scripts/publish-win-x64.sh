#!/usr/bin/env bash
# Cross-builds the Windows x64 packages from Linux/macOS (same output as publish-win-x64.ps1).
# Requires a Microsoft-built .NET 10 SDK (distro source-built SDKs lack the WPF targeting pack).
set -euo pipefail
cd "$(dirname "$0")/.."
CONFIG="${CONFIGURATION:-Release}"
VERSION="$(sed -n 's:.*<Version>\(.*\)</Version>.*:\1:p' src/NoorMD/NoorMD.csproj | head -1)"
ART="$PWD/artifacts"
mkdir -p "$ART"

echo "== NoorMD $VERSION =="
if [[ "${SKIP_TESTS:-0}" != "1" ]]; then
  dotnet test tests/NoorMD.Core.Tests -c "$CONFIG"
  dotnet test tests/NoorMD.Media.Tests -c "$CONFIG"
fi

publish() {
  local name="$1"; shift
  local out="$ART/publish-$name"
  rm -rf "$out"
  dotnet publish src/NoorMD/NoorMD.csproj -c "$CONFIG" -r win-x64 -o "$out" -p:DebugType=none "$@"
  rm -f "$out"/Microsoft.Web.WebView2.*.xml
  cp README.md docs/SHORTCUTS.md docs/MIGRATION.md "$out/"
  local zip="$ART/NoorMD-$VERSION-win-x64-$name.zip"
  rm -f "$zip"
  (cd "$out" && zip -q -r -9 "$zip" .)
  echo "   -> $zip ($(du -h "$zip" | cut -f1))"
}

publish portable --self-contained true -p:PublishReadyToRun="${READY_TO_RUN:-true}"
publish small --self-contained false

(cd "$ART" && sha256sum ./*.zip | sed 's#\./##' > SHA256SUMS.txt)
echo "Done."
