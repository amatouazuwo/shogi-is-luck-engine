# rsshogi depth, node and MultiPV support (2026-11-23)

## Verified pinned source APIs

Our obstacle SDK builds rsshogi-nnue-mini upstream commit 4849e647deefed535d0902f80dccec21458dc79f with obstacle patches, plus rules commit fb28c7cee94883a01d5ce43000be998138f95cc3. Refer to scripts/build-obstacle-sdk.sh.

- bindings/wasm/worker.js: go supports depth (1..64), nodes, movetime_ms; requires nodes OR movetime_ms even if depth is supplied. It performs bounded 35ms slices, not a single fixed-duration native search.
- src/ffi.rs: Search JSON accepts depth, nodes, movetime_ms, with deny_unknown_fields. No MultiPV or alternative-root-scores option.
- src/api.rs: SearchOutput includes bestmove, numeric score, depth, nodes and ONE pv sequence. The pv is a sequence of predicted subsequent moves, not independently scored alternative root moves.
- Our patches/obstacle-engine.patch adds obstacles and legal_moves, but does not introduce MultiPV.

Upstream:
https://github.com/nyoki-mtl/rsshogi-nnue-mini/blob/4849e647deefed535d0902f80dccec21458dc79f/bindings/wasm/worker.js
https://github.com/nyoki-mtl/rsshogi-nnue-mini/blob/4849e647deefed535d0902f80dccec21458dc79f/src/ffi.rs
https://github.com/nyoki-mtl/rsshogi-nnue-mini/blob/4849e647deefed535d0902f80dccec21458dc79f/src/api.rs

## CI probe

benchmarks/strength/ci/probe-native-search-controls.mjs builds and runs the EXACT same WASM NNUE and Worker as the existing obstacle branch. It tests the normal initial board, a verified pit opening and a verified blackhole opening. Each receives six bounded probe settings:

| Probe | Depth cap | Nodes cap | Wall time cap |
|---|---:|---:|---:|
| time-only | 64 | none | 1000ms |
| depth-2 | 2 | 250000 | 1000ms |
| depth-4 | 4 | 250000 | 1000ms |
| nodes-500 | 64 | 500 | 1000ms |
| nodes-10000 | 64 | 10000 | 1000ms |
| nodes-only | 64 | 1000 | none |

Every move must be in the real legal move list. Observed depth must be no greater than its cap and nodes must be no greater than the requested node quota. Each case starts a new game to avoid unrelated cached continuation. Depth-only Worker requests and an unsupported multipv=2 C API request must fail cleanly, not silently fall back. One PV must agree with bestmove.

The node/depth caps are maxima. A search may stop before reaching a limit due to another limit or game state. Native elapsed times, depths and node counts do not prove actual playing strength.

## Next stage (not automatically applied)

1. Preserve five stable game difficulty profiles including the legacy simple CPU; amateur 5-kyu, shodan and 4-dan are UNVALIDATED target labels.
2. After this probe, add optional depth and nodes to a separate game-clock-aware experimental evaluator and compare fixed time with only one axis varied.
3. Use paired games, known-strength opponents and phone benchmarks to calibrate human-grade labels.
4. A future multi-candidate skill setting needs actual independently scored root candidates. This pinned native API does not yet expose that and no guessed second-best moves will be fabricated.

No game source, production main/develop, or Render is modified.
