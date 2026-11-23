# Tactical gap investigation — 2026-11-22

The public independent GitHub Actions run [45007814031](https://github.com/amatouazuwo/shogi-is-luck-engine/actions/runs/45007814031) completed successfully and archived its records on `chatgpt/strength-results` at `results/45007814031/1/`.

- **100 archived tactical items at 100ms**: candidate **85/100**, pinned baseline **85/100**.
- Same correct/incorrect set: **0 fixed**, **0 newly regressed**. The candidate and baseline WASM binaries are distinct, but have identical correctness labels on these items.
- Incorrect items: **15** (7 material-gain, 8 ray-blocking).
- **These are failures under the archived tactical labeling rule, not necessarily game-losing blunders.** The label values capture and immediate-reply material swings; positional value, promotions, future tactics and special random events may make other legal moves reasonable.
- All displayed moves are from saved measured output, **not hypothetical engine recommendations**. The SFENs and obstacle coordinates are retained for local reproduction. No real engine improvement is asserted.

## Actual failed items

| Problem ID | Current AI move | Archived label-good moves | Pinned baseline move | Search depth | Obstacles (USI) | SFEN |
|---|---|---|---|---:|---|---|
| `blackhole/material-gain/05` | `7b7c` | `3c4a+` | `7b7c` | 4 | `8g,7g,6g,8h,7h,6h,8i,7i,6i` | `2b2r1ns/2G3L2/2pk2NR1/2p6/9/Bg1P2K2/6l2/9/5SP2 b - 69` |
| `blackhole/material-gain/07` | `8h5e+` | `8h9i+` | `8h5e+` | 8 | `9d,8d,7d,9e,8e,7e,9f,8f,7f` | `9/6p2/2pkBPSs1/7r1/4G2n1/6P2/lL6g/1b7/NK3R3 w - 100` |
| `blackhole/material-gain/09` | `8a7a` | `3h3i` | `8a7a` | 5 | `6g,5g,4g,6h,5h,4h,6i,5i,4i` | `1kB2p2S/8b/1P5r1/9/5p1Nl/1P2G4/1K4n2/1s4gL1/6R2 w - 114` |
| `pit/material-gain/02` | `8e9g+` | `8h8f`, `8h8f+` | `8e9g+` | 6 | `2f` | `2l5s/P6p1/1k5Gp/9/1n1L5/1B6N/R3SP3/1rb5g/6K2 w - 30` |
| `pit/material-gain/03` | `3a7a+` | `6f1a`, `6f1a+` | `3a7a+` | 6 | `8b` | `1sl3Rnr/2L5p/2k6/1b4G2/1gP6/3B5/1K5Sp/1N7/P8 b - 31` |
| `pit/material-gain/07` | `3h3g` | `5e5d` | `3h3g` | 6 | `8e` | `1k4B2/b7P/2p6/p1n1R2N1/3lr4/9/1s3KG1P/4S1g2/5L3 w - 74` |
| `pit/material-gain/10` | `8f7e` | `3e4d` | `8f7e` | 8 | `6e` | `p1kl5/9/1S4GPB/5N3/1n4s2/1b6p/4R2L1/8r/P5K1g w - 98` |
| `blackhole/ray-blocking/01` | `9e9a+` | `6h7f` | `9e9a+` | 7 | `6d,5d,4d,6e,5e,4e,6f,5f,4f` | `7k1/9/9/9/R7r/2g6/9/3N5/1K7 b - 62` |
| `blackhole/ray-blocking/04` | `1e1a+` | `4h3f` | `1e1a+` | 9 | `6d,5d,4d,6e,5e,4e,6f,5f,4f` | `1k7/9/9/9/r7R/6g2/9/5N3/7K1 b - 65` |
| `blackhole/ray-blocking/06` | `1e1i+` | `4b3d` | `1e1i+` | 7 | `6d,5d,4d,6e,5e,4e,6f,5f,4f` | `7k1/5n3/9/6G2/R7r/9/9/9/1K7 w - 68` |
| `blackhole/ray-blocking/09` | `9e9i+` | `6b7d` | `9e9i+` | 8 | `6d,5d,4d,6e,5e,4e,6f,5f,4f` | `1k7/3n5/9/2G6/r7R/9/9/9/7K1 w - 71` |
| `pit/ray-blocking/01` | `9e9a+` | `6h7f` | `9e9a+` | 7 | `5e` | `7k1/9/9/9/R7r/2g6/9/3N5/1K7 b - 62` |
| `pit/ray-blocking/04` | `1e1a+` | `4h3f` | `1e1a+` | 8 | `5e` | `1k7/9/9/9/r7R/6g2/9/5N3/7K1 b - 65` |
| `pit/ray-blocking/06` | `1e1i+` | `4b3d` | `1e1i+` | 9 | `5e` | `7k1/5n3/9/6G2/R7r/9/9/9/1K7 w - 68` |
| `pit/ray-blocking/09` | `9e9i+` | `6b7d` | `9e9i+` | 8 | `5e` | `1k7/3n5/9/2G6/r7R/9/9/9/7K1 w - 71` |

## Investigation before changing the engine

1. Verify each archived label with the independent referee, especially `material-gain` and `ray-blocking`: for the selected move, candidate alternatives, and *all* immediate legal opponent captures. Preserve evidence, including captures after promotions. Avoid mistaking the label's narrow material-only score for a game-theoretic win.
2. Start with repeated misses across `pit` and `blackhole` that share the same strategic setup (e.g. ray-blocking IDs `/01`, `/04`, `/06`, `/09`); rule out illegal square/hole interpretation and identify whether the issue is evaluation, move ordering, or limited search time.
3. For any proposed engine modification, first test at 100ms with exactly these input identities against the pinned baseline, and **also** check the other 85 items and paired games for regressions. Use genuinely new, sealed, independently sourced positions for a final generalization check.
4. Treat this list as **development diagnostics, not fresh holdouts**. Do not edit the published test answers, automatically promote the modified AI, deploy the game, or merge PR #3.

The relevant files are `benchmarks/strength/tactics/corpus.jsonl`, `results/45007814031/1/tactical-candidate.jsonl`, `results/45007814031/1/tactical-baseline.jsonl`, and `results/45007814031/1/tactical-delta.json`.
