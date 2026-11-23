#!/usr/bin/env bash
set -euo pipefail
set -o noclobber

directory=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
sdk=$(realpath -- "${1:?usage: run-supplemental.sh NORMAL_SDK FROZEN_GAME_DIRECTORY CPU_ID}")
game=$(realpath -- "${2:?pass the frozen game directory}")
cpu=${3:?pass one allowed Linux CPU ID}
node_bin=${EXPANSION_NODE_BINARY:-node}
commit=17b41aa8959877be81dc86ecd3477a67a3139262
common=(--repo "$game" --game-commit "$commit" --sdk "$sdk" --opponent stock --ply-cap 60 --fixture-file fixtures.jsonl)
cd "$directory"

for row in '500 200,203' '1500 201,202'; do
  read -r level ids <<< "$row"
  taskset -c "$cpu" "$node_bin" normal-match.mjs "${common[@]}" --level "$level" \
    --fixture-ids "$ids" > "match-stock-${level}-supplemental.jsonl"
done
"$node_bin" summarize.mjs > summary.json
