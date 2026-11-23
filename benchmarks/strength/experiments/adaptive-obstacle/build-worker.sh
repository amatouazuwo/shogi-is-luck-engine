#!/usr/bin/env bash
set -euo pipefail
base=$(realpath -- "${1:?usage: build-worker.sh BASELINE_SDK NEW_OUTPUT_DIRECTORY}")
output=$(realpath -m -- "${2:?usage: build-worker.sh BASELINE_SDK NEW_OUTPUT_DIRECTORY}")
experiment=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
test ! -e "$output"
echo "0aa92ee9c44cc31e82cf58e3338420d2efb75b60b7a14eb1a5c76d8b0c0d9108  $base/rsshogi_nnue_mini.wasm" | sha256sum --check -
echo "fe9298706c23a1a7818d0c9f97e7b871fa5a239dfeb672a220d65d4e3c35d6b2  $base/worker.js" | sha256sum --check -
scratch=$(mktemp -d)
trap 'rm -rf -- "$scratch"' EXIT
mkdir -p "$scratch/bindings/wasm"
cp -p "$base/worker.js" "$scratch/bindings/wasm/"
patch -d "$scratch" -p1 < "$experiment/adaptive-obstacle-worker.patch"
mkdir -p "$output"
for name in LICENSE THIRD-PARTY-NOTICES.txt manifest.json mini.js package.json rsshogi_nnue_mini.wasm; do
  cp -p "$base/$name" "$output/"
done
cp "$scratch/bindings/wasm/worker.js" "$output/"
python3 "$experiment/mark-slices.py" "$output"
(cd "$output" && sha256sum --check SHA256SUMS)
