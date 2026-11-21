#!/usr/bin/env bash
set -euo pipefail
game=$(realpath "$1")
sdk=$(realpath "$2")
candidate=$(realpath "$3")
dependencies=$(realpath "$4")
checks=$(cd "$(dirname "$0")" && pwd)
scratch=$(mktemp -d "${SCRATCH_ROOT:-/tmp}/normal-browser.XXXXXX")
pid=
cleanup() { if [[ -n "$pid" ]]; then kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; fi; }
trap cleanup EXIT
git -C "$game" archive HEAD | tar -xf - -C "$scratch"
mkdir -p "$scratch/ai/sdk"
cp -a "$sdk/." "$scratch/ai/sdk/"
cp "$candidate" "$scratch/ai/sdk/continuous-worker.mjs"
ln -s "$dependencies" "$scratch/node_modules"
node --input-type=module - "$scratch" <<'JS'
import fs from 'node:fs';
import path from 'node:path';
const root = process.argv[2];
function replace(file, before, after) {
  const fullPath = path.join(root, file);
  const source = fs.readFileSync(fullPath, 'utf8');
  if (!source.includes(before)) throw Error('Scratch adapter anchor missing: ' + file);
  fs.writeFileSync(fullPath, source.replace(before, after));
}
replace('index.html', "directory+'worker.js'", "directory+(variant==='obstacle'?'worker.js':'continuous-worker.mjs')");
replace('server.js', "'/ai/sdk/worker.js'", "'/ai/sdk/continuous-worker.mjs','/ai/sdk/worker.js'");
replace('ai/rsshogi-client.mjs', "{url:this.wasmUrl,hash_mb:16}", "{url:this.wasmUrl,hash_mb:16,...(this.allowHoles?{}:{moduleUrl:new URL('./mini.js',this.workerUrl).href})}");
JS
printf '%s\n' 'feb190263b48caed5a81e0009cda35f6d2a23548ccf61d785f019420b857222d  rsshogi_nnue_mini.wasm' | (cd "$scratch/ai/sdk" && sha256sum -c -)
cmp "$sdk/worker.js" "$scratch/ai/sdk/worker.js"
cmp "$candidate" "$scratch/ai/sdk/continuous-worker.mjs"
port=${NORMAL_BROWSER_PORT:-3341}
PORT=$port NODE_ENV=test RSSHOGI_SERVE_ASSETS=1 RSSHOGI_TEST_ENABLED=1 RENDER_EXTERNAL_HOSTNAME=shogi-is-luck-test.onrender.com node "$scratch/server.js" > "$scratch/server.log" 2>&1 &
pid=$!
for attempt in {1..20}; do
  if ! kill -0 "$pid" 2>/dev/null; then cat "$scratch/server.log"; exit 1; fi
  if curl -fsS "http://127.0.0.1:$port/health" >/dev/null 2>&1; then break; fi
  sleep 1
done
BASE_URL="http://127.0.0.1:$port" NODE_MODULES_DIR="$dependencies" node "$checks/${NORMAL_BROWSER_CHECK:-check.mjs}"
