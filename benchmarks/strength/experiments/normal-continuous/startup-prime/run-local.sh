#!/usr/bin/env bash
set -euo pipefail
game=$(realpath "$1")
sdk=$(realpath "$2")
dependencies=$(realpath "$3")
checks=$(cd "$(dirname "$0")" && pwd)
scratch=$(mktemp -d "$checks/sandbox.XXXXXX")
port=${STARTUP_PRIME_PORT:-3347}
pid=
cleanup() { if [[ -n "$pid" ]]; then kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; fi; }
trap cleanup EXIT
git -C "$game" archive 4f7cce3 | tar -xf - -C "$scratch"
mkdir -p "$scratch/ai/sdk"
cp -a "$sdk/." "$scratch/ai/sdk/"
ln -s "$dependencies" "$scratch/node_modules"
printf '%s\n' 'feb190263b48caed5a81e0009cda35f6d2a23548ccf61d785f019420b857222d  rsshogi_nnue_mini.wasm' | (cd "$scratch/ai/sdk" && sha256sum -c -) >&2
node "$checks/patch-worker.mjs" "$scratch/ai/rsshogi-continuous-worker.mjs"
PORT=$port NODE_ENV=test RSSHOGI_SERVE_ASSETS=1 RSSHOGI_TEST_ENABLED=1 RSSHOGI_CONTINUOUS_100_TEST_ENABLED=1 RENDER_EXTERNAL_HOSTNAME=shogi-is-luck-test.onrender.com node "$scratch/server.js" > "$scratch/server.log" 2>&1 &
pid=$!
for attempt in {1..20}; do
  if ! kill -0 "$pid" 2>/dev/null; then cat "$scratch/server.log" >&2; exit 1; fi
  if curl -fsS "http://127.0.0.1:$port/health" >/dev/null 2>&1; then break; fi
  sleep 1
done
BASE_URL="http://127.0.0.1:$port" NODE_MODULES_DIR="$dependencies" node "$checks/measure.mjs"
