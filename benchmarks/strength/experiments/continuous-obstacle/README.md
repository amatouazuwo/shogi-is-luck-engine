# Experimental continuous search on already-realized obstacle boards

## User-defined objective

The user wants the existing `rsshogi-nnue-mini v0.4.0` engine to retain **its innate practical playing strength** on current positions containing a one-square pit or a 3×3 black hole. Do not seek label imitation, shortest mate for its own sake or early finish at an arbitrary move cap. **A 300-ply unfinished game is neutral, not a loss or a defect.**

## Why this different hypothesis deserves an isolated test

The already tested `experiments/hole-eval` static NNUE supplement changed static values but failed to demonstrate any improvement in direct playing strength. Its most recent 48-game sample (`45022210336`) scored 19W-22L-7 undecided. It remains REJECTED / archive-only.

The stock `rsshogi-nnue-mini` worker, even when legal search accounts for obstacle masks, runs **multiple separate <=35ms search calls** with incremental depth and shared search table. The engine's normal iterative deepening may benefit from using the requested 100ms or 500ms **in one uninterrupted native C API search**. A prior `experiments/normal-continuous` prototype on ordinary boards is promising but did not establish how this affects obstacles. We need a direct special-board experiment instead of assuming normal-board gains generalize.

## Isolated source change and verification

The candidate in `benchmarks/strength/experiments/continuous-obstacle/worker.js` is a **separate experimental Worker**. It has the same NNUE model, same WASM engine, same special-board rules, same legal move API and transposition-hash settings. Only the scheduling of the search request changes:

- Existing baseline: repeated capped 35ms search calls, accumulated nodes, cooperative `stop` support.
- Candidate: single uninterrupted `search` request with the same time budget per move. This preserves the engine's iterative-deepening search within one call.
- No changes to rsshogi's search algorithm, NNUE weights, evaluation terms, obstacle rules or actual game deployment.
- `build-sdk.mjs` requires the pinned model, copies the verified SDK and rewrites only `worker.js`, `manifest.json` and `SHA256SUMS`. It enforces byte-for-byte identity of WASM, JS glue, license, notices and package metadata.

The experimental continuous Worker **cannot process a stop/cancel message during a synchronous WASM search**. Safe cancellation would require terminating and reinitializing the Worker or implementing an interruptible native search. This is an explicit deployment blocker until solved and tested. It can still be used in controlled 100ms/500ms fixed-budget experiments; do not present it as production-ready even if the game score is promising.

## Paired playing-strength experiment

GitHub Actions [45026414339](https://github.com/amatouazuwo/shogi-is-luck-engine/actions/runs/45026414339):

- 100ms per move, at most 300 plies, four paired opening families, both hole types and both color assignments: 16 games.
- 100ms per move, at most 120 plies, four different archived opening families: 16 games.
- 500ms per move, at most 120 plies, two paired opening families with both hole types and colors: 8 games.
- Total **40 paired-by-color direct games**, reusing previously saved openings (not genuinely sealed new holdouts).
- Independent C++ referee checks the complete legal move set on every requested move. Any mismatch/search timeout is a strict test failure.
- 36 archived, independently solved tactic positions at 100ms and 500ms serve as safety checks only, NOT as a primary ranking.
- Archive full search move traces and experimental SDK/Worker SHA values. Compare decided games, 2-color finished pair outcomes, search depth, actual wall-clock performance and candidate's rate of illegal/failing searches. Neutral unfinished cases are never penalized.

## Interpretation/decision rule

1. A measured increase in search depth by itself is NOT sufficient to establish playing strength. Deep search can still choose a worse move.
2. Only adoption evidence from diverse, paired, legally valid games (plus confirmation of normal-board fidelity and cancellation/latency safety) is actionable. Archived openings and same-start 100ms/500ms budget samples are correlated.
3. If no clear benefit or unacceptable overtime, keep stock sliced Worker and record result as negative/unknown.
4. If promising, continue to fresh opening families, implement safe cancellation, then rerun actual 3-minute game tests. No production merge or PR merge without explicit user authorization.

