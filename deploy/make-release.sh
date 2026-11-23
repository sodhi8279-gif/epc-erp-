#!/usr/bin/env bash
# Packs the committed code into release/epc-erp-<version>.tar.gz for copying to a VPS.
set -euo pipefail
cd "$(dirname "$0")/.."
V=$(node -p "require('./package.json').version")-$(git rev-parse --short HEAD)
mkdir -p release
git archive --format=tar.gz --prefix="epc-erp-$V/" -o "release/epc-erp-$V.tar.gz" HEAD
sha256sum "release/epc-erp-$V.tar.gz" | tee "release/epc-erp-$V.tar.gz.sha256"
