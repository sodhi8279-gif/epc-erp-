#!/usr/bin/env bash
# Builds dist/EPC-Contracts-Setup-<version>.exe on Linux (or WSL/Git Bash) without Wine.
#   ./build-win.sh                         generic installer: asks for the server address on first run
#   SERVER_URL=https://erp.co.in ./build-win.sh   installer pre-set to your server (users skip the setup screen)
set -euo pipefail
cd "$(dirname "$0")"
VERSION=$(node -p "require('./package.json').version")
[[ -d node_modules ]] || npm ci
echo "{ \"serverUrl\": \"${SERVER_URL:-}\" }" > server.json
build/bundle-local.sh win
rm -rf dist/win-unpacked
npx electron-builder --win dir --x64            # app folder (no installer step, so no Wine)
node build/set-exe-resources.cjs "dist/win-unpacked/EPC Contracts.exe" build/icon.ico "$VERSION"
NSIS=$(ls -d "$HOME"/.cache/electron-builder/nsis/nsis-3* 2>/dev/null | head -1)
if command -v makensis >/dev/null; then MAKENSIS=makensis; else
  [[ -n "$NSIS" ]] || { echo "makensis not found: install nsis (apt install nsis) or run 'npx electron-builder --win nsis' once to download it"; exit 1; }
  MAKENSIS="$NSIS/linux/makensis"; export NSISDIR="$NSIS"; fi
OUT="dist/EPC-Contracts-Setup-$VERSION.exe"
"$MAKENSIS" -V2 -DVERSION="$VERSION" -DAPPDIR="$PWD/dist/win-unpacked" -DICON="$PWD/build/icon.ico" -DOUTFILE="$PWD/$OUT" build/installer.nsi
echo "{ \"serverUrl\": \"\" }" > server.json
(cd dist && sha256sum "$(basename "$OUT")" | tee "$(basename "$OUT").sha256")
# Update manifest read by the app (Help → Check for updates). Publish it next to the installer.
NOTES=${RELEASE_NOTES:-}
node -e "
const fs=require('fs');const [v,f,notes]=process.argv.slice(1);
const sha=fs.readFileSync('dist/'+f+'.sha256','utf8').split(/\s+/)[0];
fs.writeFileSync('dist/latest.json',JSON.stringify({version:v,url:'https://github.com/sodhi8279-gif/epc-erp-/raw/downloads/'+f,sha256:sha,size:fs.statSync('dist/'+f).size,notes},null,2));
" "$VERSION" "$(basename "$OUT")" "$NOTES"
cat dist/latest.json
