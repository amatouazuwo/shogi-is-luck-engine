#!/usr/bin/env bash
set -euo pipefail
set -o noclobber

directory=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
sdk=$(realpath -- "${1:?usage: run-expansion.sh NORMAL_SDK FROZEN_GAME_DIRECTORY CPU_ID}")
game=$(realpath -- "${2:?pass the frozen game directory}")
cpu=${3:?pass one allowed Linux CPU ID}
node_bin=${EXPANSION_NODE_BINARY:-node}
commit=17b41aa8959877be81dc86ecd3477a67a3139262
common=(--repo "$game" --game-commit "$commit" --sdk "$sdk" --opponent stock --family hirate,game)
cd "$directory"

echo '995910dfdaaf90f3d4881572f83ca15cf527383e6059d69c5ed983179c1fe3b0  index.html' | (cd "$game" && sha256sum --check -)
echo '55b720ac6864999cbb3629209b3a8761e813db081df5085c87b1e2887b5532db  ai/rsshogi-position.mjs' | (cd "$game" && sha256sum --check -)
taskset -c "$cpu" "$node_bin" normal-match.mjs "${common[@]}" --level 100 --smoke > cpu-smoke.jsonl

for row in '100 8 4 200' '500 12 2 100' '1500 14 2 100'; do
  read -r level offset count cap <<< "$row"
  taskset -c "$cpu" "$node_bin" normal-match.mjs "${common[@]}" --level "$level" \
    --pair-offset "$offset" --pairs "$count" --ply-cap "$cap" > "match-stock-${level}-expansion.jsonl"
done

"$node_bin" summarize.mjs > summary.json
