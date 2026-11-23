# Obstacle tactics holdout

The two JSONL files were frozen before any NNUE search ran against these positions. The prior 128 corpus, evasion, and three-ply puzzle positions were excluded by normalized board, side, hands, and hazard cells.

- `heldout-attack.jsonl` has 24 cases. There are four positions in each hazard and 3-, 5-, or 7-ply horizon, with two Black and two White turns. The answer set contains every first move that forces the opponent to have no legal move by the stated horizon. Earlier horizons were fully searched too.
- `heldout-escape.jsonl` has 12 cases. There are two positions in each hazard and 3-, 5-, or 7-ply opponent horizon after the first defensive move. The answer set contains every first move that prevents such a forced loss within the horizon. Each record has an unsafe first move for which defeat takes exactly that many opposing plies. The records are predecessor positions of attack-set cases and are scored as a separate stratum.
- `heldout.jsonl` concatenates those files for one engine run. The JSON fields needed for scoring are `id`, `kind`, `category`, `sfen`, `holes`, `available` and `goodMoves`. The numeric `horizon` and `proof` fields distinguish the objectives and record the full-width counters and unsafe defenses.

The verifier explores the independent C++ rules using OR over attacking choices and AND over defensive replies. The terminal condition is lack of any legal move. Within these short horizons from a fresh position, fourfold repetition cannot occur. The sampling pass restricted candidate searches to checking moves to save time. Every accepted label comes from a separate full-width search of all legal moves. Main corpus sampling used four geometry families of sparse synthetic boards. The game JavaScript checked every root legal move set.

Build and verify from this directory.

```sh
g++ -O3 -std=c++20 -DNDEBUG -o solve solve.cpp
node verify.mjs --solver ./solve --corpus heldout.jsonl
```

The verifier needs the independent `obstacle-reference.cpp` source at `../../reference/obstacle-reference.cpp`. For a relocated checkout, pass a quoted absolute source path with `-DSHOGI_REFERENCE_CPP`.

Run the browser Worker A/B separately with the desired SDK directories.

```sh
node run-heldout.mjs --corpus heldout.jsonl --sdk baseline=/path/to/baseline --sdk candidate=/path/to/candidate --budget 100,500,1500 --rounds 2
```
