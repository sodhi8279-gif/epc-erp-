#!/usr/bin/env bash
# Prepares the standalone ("this computer only") payload: server bundle, seed, web app, migrations,
# Prisma client with Windows + Linux engines, and PostgreSQL binaries for the target platform.
#   build/bundle-local.sh win     (default)   or   build/bundle-local.sh linux
set -euo pipefail
cd "$(dirname "$0")/.."
PLAT=${1:-win}
ROOT=$(cd .. && pwd)
API=$ROOT/apps/api
PGVER=17.12.0-beta.19
rm -rf local && mkdir -p local/node_modules/@prisma local/node_modules/.prisma pgsql-cache

echo "• Building web app and Prisma client"
(cd "$ROOT" && pnpm --filter @epc/web exec vite build >/dev/null && cd "$API" && npx prisma generate >/dev/null)

echo "• Bundling server and seed"
BANNER="import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);"
for pair in "src/local.ts:server.mjs" "prisma/seed.ts:seed.mjs"; do
  npx esbuild "$API/${pair%%:*}" --bundle --platform=node --target=node20 --format=esm \
    --external:@prisma/client --external:.prisma/client --banner:js="$BANNER" \
    --outfile="local/${pair##*:}" --log-level=warning
done
cp -r "$ROOT/apps/web/dist" local/web
cp -r "$API/prisma/migrations" local/migrations

echo "• Copying Prisma client"
PC=$(readlink -f "$API/node_modules/@prisma/client")
cp -rL "$PC" local/node_modules/@prisma/client
cp -rL "$(dirname "$(dirname "$PC")")/.prisma/client" local/node_modules/.prisma/client
# Only the Node library engine is used; drop edge/wasm runtimes for other databases.
find local/node_modules/@prisma/client/runtime -type f ! -name 'library.js' ! -name 'index-browser.js' ! -name '*.d.ts' -delete
rm -f local/node_modules/.prisma/client/query_engine_bg.wasm local/node_modules/.prisma/client/*.mjs
if [[ $PLAT == win ]]; then rm -f local/node_modules/.prisma/client/libquery_engine-*.so.node; else rm -f local/node_modules/.prisma/client/query_engine-windows.dll.node; fi

echo "• PostgreSQL $PGVER for $PLAT"
PKG=$([[ $PLAT == win ]] && echo windows-x64 || echo linux-x64)
TGZ=pgsql-cache/embedded-postgres-$PKG-$PGVER.tgz
[[ -f $TGZ ]] || (cd pgsql-cache && npm pack --silent "@embedded-postgres/$PKG@$PGVER" >/dev/null 2>&1)
rm -rf pgsql && mkdir -p pgsql-tmp && tar -xzf "$TGZ" -C pgsql-tmp && mv pgsql-tmp/package/native pgsql && rm -rf pgsql-tmp
# Linux packages ship shared-library symlinks as a list; recreate them as copies.
node -e "
const fs=require('fs'),path=require('path');
for (const {source,target} of JSON.parse(fs.readFileSync('pgsql/pg-symlinks.json','utf8')))
  fs.copyFileSync(path.join('pgsql',source.replace(/^native\//,'')), path.join('pgsql',target.replace(/^native\//,'')));"
rm -rf pgsql/bin/wx*.dll pgsql/bin/testplug.dll pgsql/include pgsql/share/locale pgsql/share/doc pgsql/lib/pkgconfig pgsql/lib/*.a pgsql/pg-symlinks.json
if [[ $PLAT == win ]]; then
  # PostgreSQL for Windows needs the Microsoft Visual C++ runtime. Ship it next to postgres.exe (app-local, as Microsoft
  # permits) so PCs without the "VC++ Redistributable" work too. Source: conda-forge's repackaging of Microsoft's signed DLLs.
  VC=vc14_runtime-14.51.36247-hb06f545_44.conda
  [[ -f pgsql-cache/$VC ]] || curl -fsSL -o "pgsql-cache/$VC" "https://conda.anaconda.org/conda-forge/win-64/$VC"
  echo "8221fe78686f3b11586a7585f902f1403c923fb3a5040cff59a16db27782db8d  pgsql-cache/$VC" | sha256sum -c --quiet
  node -e "
const fs=require('fs'),zlib=require('zlib'),cp=require('child_process'),os=require('os'),path=require('path');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'vc-'));
cp.execFileSync('python3',['-c','import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])',process.argv[1],tmp]);
const z=fs.readdirSync(tmp).find(f=>f.startsWith('pkg-'));
fs.writeFileSync(path.join(tmp,'pkg.tar'),zlib.zstdDecompressSync(fs.readFileSync(path.join(tmp,z))));
cp.execFileSync('tar',['-xf',path.join(tmp,'pkg.tar'),'-C',tmp]);
for (const d of ['vcruntime140.dll','vcruntime140_1.dll','msvcp140.dll','msvcp140_1.dll']) fs.copyFileSync(path.join(tmp,d),path.join('pgsql','bin',d));
fs.rmSync(tmp,{recursive:true,force:true});" "pgsql-cache/$VC"
fi
du -sh local pgsql
