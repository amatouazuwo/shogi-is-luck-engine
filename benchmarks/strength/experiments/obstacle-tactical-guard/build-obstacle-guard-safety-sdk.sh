#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 || $# -gt 3 ]]; then
    echo "Usage: $0 ENGINE_REPOSITORY OUTPUT_DIRECTORY [OFFICIAL_SDK_ZIP]" >&2
    exit 2
fi
project=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repository=$(realpath -- "$1")
output=$(realpath -m -- "$2")
base=ae8d8effdb04b6b0e9f1a73a03cfafbd41843e67
rust=1.95.0
rules_revision=fb28c7cee94883a01d5ce43000be998138f95cc3
engine_revision=4849e647deefed535d0902f80dccec21458dc79f
model_digest=787739972eabb5a1c42c471d178ac0c97b688dce35c72b4291e7e1eeefa9786f
build=$(mktemp -d)
trap 'rm -rf -- "$build"' EXIT

checkout() {
    local upstream=$1 destination=$2 revision=$3
    git init --quiet "$destination"
    git -C "$destination" fetch --quiet --depth 1 "$upstream" "$revision"
    git -C "$destination" checkout --quiet --detach "$revision"
    test "$(git -C "$destination" rev-parse HEAD)" = "$revision"
}
checkout https://github.com/nyoki-mtl/rsshogi.git "$build/rules" "$rules_revision"
checkout https://github.com/nyoki-mtl/rsshogi-nnue-mini.git "$build/engine" "$engine_revision"

# Materialize the exact base scripts from the published branch checkpoint.
checkout "$repository" "$build/base" "$base"
git -C "$build/rules" apply "$build/base/patches/obstacle-rules.patch"
git -C "$build/engine" apply "$build/base/patches/obstacle-engine.patch"
git -C "$build/engine" apply "$project/patches/obstacle-tactical-guard.patch"
git -C "$build/engine" apply "$project/repair/patches/obstacle-tactical-guard-safety.patch"

if [[ $# -eq 3 ]]; then
    archive=$(realpath -- "$3")
else
    archive="$build/sdk.zip"
    curl -fsSL --retry 3 -o "$archive" \
        https://github.com/nyoki-mtl/rsshogi-nnue-mini/releases/download/v0.4.0/rsshogi-nnue-mini-v0.4.0-wasm-sdk.zip
fi

python3 "$build/base/scripts/package-obstacle-sdk.py" extract "$archive" "$build/model.rsnn" "$model_digest"
export RSSHOGI_EMBEDDED_RSNN_PATH="$build/model.rsnn"
export RSSHOGI_EMBEDDED_RSNN_SHA256="$model_digest"
export RUSTFLAGS="--remap-path-prefix=$build=/build --remap-path-prefix=${CARGO_HOME:-$HOME/.cargo}=/cargo"
unset CARGO_ENCODED_RUSTFLAGS
cd "$build/engine"
if [[ ${RUN_ENGINE_TESTS:-0} == 1 ]]; then
    cargo +"$rust" test --locked --lib --features c-api,embedded-rsnn search::obstacle_guard
fi
cargo +"$rust" rustc --locked --lib --release --crate-type cdylib --target wasm32-unknown-unknown \
    --target-dir target --features c-api,embedded-rsnn
node bindings/wasm/obstacle-smoke.mjs
node bindings/wasm/obstacle-worker-smoke.mjs
python3 "$build/base/scripts/package-obstacle-sdk.py" package "$build" "$output" "$rust" \
    "$rules_revision" "$engine_revision" "$model_digest"
python3 "$project/mark-guard.py" "$output" "$project/patches/obstacle-tactical-guard.patch" "$base"
python3 "$project/repair/mark-repair.py" "$output" "$project/patches/obstacle-tactical-guard.patch" \
    "$project/repair/patches/obstacle-tactical-guard-safety.patch"
(cd "$output" && sha256sum -c SHA256SUMS)
