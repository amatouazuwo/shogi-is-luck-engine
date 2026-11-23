#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
    echo "Usage: $0 OUTPUT_DIRECTORY [OFFICIAL_SDK_ZIP]" >&2
    exit 2
fi

project=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
output=$(realpath -m -- "$1")
build=$(mktemp -d)
trap 'rm -rf -- "$build"' EXIT
rust=1.95.0
target=wasm32-unknown-unknown
rules_revision=fb28c7cee94883a01d5ce43000be998138f95cc3
engine_revision=4849e647deefed535d0902f80dccec21458dc79f
model_digest=787739972eabb5a1c42c471d178ac0c97b688dce35c72b4291e7e1eeefa9786f

checkout() {
    local repository=$1 destination=$2 revision=$3
    git init --quiet "$destination"
    git -C "$destination" fetch --quiet --depth 1 "$repository" "$revision"
    git -C "$destination" checkout --quiet --detach "$revision"
    test "$(git -C "$destination" rev-parse HEAD)" = "$revision"
}

checkout https://github.com/nyoki-mtl/rsshogi.git "$build/rules" "$rules_revision"
checkout https://github.com/nyoki-mtl/rsshogi-nnue-mini.git "$build/engine" "$engine_revision"
git -C "$build/rules" apply "$project/patches/obstacle-rules.patch"
git -C "$build/engine" apply "$project/patches/obstacle-engine.patch"

if [[ $# -eq 2 ]]; then
    archive=$(realpath -- "$2")
else
    archive="$build/sdk.zip"
    curl -fsSL --retry 3 -o "$archive" \
        https://github.com/nyoki-mtl/rsshogi-nnue-mini/releases/download/v0.4.0/rsshogi-nnue-mini-v0.4.0-wasm-sdk.zip
fi
python3 "$project/scripts/package-obstacle-sdk.py" extract "$archive" "$build/model.rsnn" "$model_digest"

export RSSHOGI_EMBEDDED_RSNN_PATH="$build/model.rsnn"
export RSSHOGI_EMBEDDED_RSNN_SHA256="$model_digest"
# Keep local checkout and Cargo registry paths out of the distributed binary.
# DEV-ONLY reproducibility probe; the regular SDK builder is unmodified.
# Serial Cargo work and single Rust/LLVM codegen unit are independent variables
# in this controlled experiment. No claim that these settings fix the issue.
export CARGO_BUILD_JOBS=1
export CARGO_INCREMENTAL=0
export SOURCE_DATE_EPOCH=0
export RUSTFLAGS="--remap-path-prefix=$build=/build --remap-path-prefix=${CARGO_HOME:-$HOME/.cargo}=/cargo -C codegen-units=1"
printf 'WASM_REPRO_LAB: jobs=%s incremental=%s epoch=%s rustflags=%s\n' "$CARGO_BUILD_JOBS" "$CARGO_INCREMENTAL" "$SOURCE_DATE_EPOCH" "$RUSTFLAGS"
unset CARGO_ENCODED_RUSTFLAGS
if [[ ${RUN_ENGINE_TESTS:-0} == 1 ]]; then
    (cd "$build/rules" && cargo +"$rust" test --locked -p rsshogi --lib --test shogiluck_holes)
    (cd "$build/engine" && cargo +"$rust" test --locked --lib --features c-api,embedded-rsnn)
fi

cd "$build/engine"
cargo +"$rust" rustc --locked --lib --release --crate-type cdylib --target "$target" \
    --target-dir target --features c-api,embedded-rsnn
node bindings/wasm/obstacle-smoke.mjs
node bindings/wasm/obstacle-worker-smoke.mjs
python3 "$project/scripts/package-obstacle-sdk.py" package "$build" "$output" "$rust" \
    "$rules_revision" "$engine_revision" "$model_digest"
