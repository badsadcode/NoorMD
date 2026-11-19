#!/usr/bin/env bash
# NoorMD 3.0: builds the Windows x64 zips (portable: .NET inside; small: needs the .NET 10 Desktop Runtime).
# Usage: bash scripts/publish-noormd3.sh   (SKIP_TESTS=1 to skip the tests)
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(sed -n 's:.*<Version>\(.*\)</Version>.*:\1:p' src/NoorMD3/NoorMD3.csproj | head -1)
OUT=artifacts/noormd3
rm -rf "${OUT:?}" && mkdir -p "$OUT"
if [ "${SKIP_TESTS:-0}" != "1" ]; then
  dotnet test tests/NoorMD3.Tests -c Release
  node tests/web3/shell.test.js
  node tests/web3/markdown.test.js
  node tests/web3/vault.test.js
  node tests/web3/music.test.js
fi
dotnet publish src/NoorMD3 -c Release -r win-x64 --self-contained true -o "$OUT/portable"
dotnet publish src/NoorMD3 -c Release -r win-x64 --self-contained false -o "$OUT/small"
for kind in portable small; do
  (cd "$OUT/$kind" && rm -f ./*.pdb ./*.xml && zip -qr "../../NoorMD-$VERSION-win-x64-$kind.zip" .)
done
(cd artifacts && sha256sum "NoorMD-$VERSION-win-x64-portable.zip" "NoorMD-$VERSION-win-x64-small.zip" > "NoorMD-$VERSION-SHA256SUMS.txt")
ls -la artifacts/NoorMD-"$VERSION"-*
