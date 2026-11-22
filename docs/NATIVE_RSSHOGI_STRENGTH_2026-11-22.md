# Native rsshogi playing strength on obstacle boards — ongoing A/B

## Primary objective, agreed with the user

Keep as much of **rsshogi-nnue-mini v0.4.0's existing normal-shogi playing strength** as possible in positions *after* a pit or black-hole event. Do not optimize for matching an independent C++ oracle's first move, fastest possible mate in long positions, or predicting future one-percent events. One-move/three-move mate and avoidable short forced loss are safety checks rather than independent optimization targets.

## Experiment 1: historical obstacle-only NNUE correction

GitHub Actions run [45013783788](https://github.com/amatouazuwo/shogi-is-luck-engine/actions/runs/45013783788) **passed all steps**, comparing the unchanged obstacle-aware rsshogi SDK in the current experimental branch to the earlier `experiments/hole-eval/patches/hole-aware-eval.patch` candidate.

The only intentional candidate-specific change is a bounded obstacle-only leaf evaluation supplement that considers loss of rook/bishop/lance rays and king escape squares due to holes. Both engines use the same pinned NNUE model, rule revision and SDK worker interface; the CI checks source manifest equivalence and artifact checksums.

Candidate SDK WASM SHA-256: `38f2bbc7eac354a8d26ab3daaff9c76f364d3cfa956c0a26e2cf61ebf7f84f16`.
Baseline SDK WASM SHA-256: `c743bd9dfd5cdb4e04ed9eb2c095669fb165d3b5e7ae2ad181b95ff07e073327`.

### Direct games (candidate W-L-undecided)

| Time per move | Type | Wins | Losses | Undecided because of ply cap |
| --- | --- | ---: | ---: | ---: |
| 100ms | pit | 2 | 1 | 5 |
| 100ms | blackhole | 0 | 0 | 8 |
| 500ms | pit | 1 | 1 | 2 |
| 500ms | blackhole | 0 | 0 | 4 |
| **All** | | **3** | **2** | **19** |

The sample had 4 paired opening families at 100ms (80-ply cap) and the first 2 at 500ms (60-ply cap), always playing both colors. **Only 5 of 24 games reached a decided result. The experiment does not establish a positive playing-strength effect.** No cap games may be counted as wins or draws, and the same opening families are reused across budgets. Distinct starting positions are scarce.

### Supplementary independent tactical check

Across 36 archived, independently proof-labelled obstacle problems at each of 100ms and 500ms, both engines met the strict archived label in 35/36 positions. All 144 trials produced legal moves and no search errors. The engines chose *different moves in only 1 of the 72 paired instances*: `500/unseen-defense/pit/5/0`, where candidate chose `5c6b` and baseline `5c6b+`. Both were marked as acceptable for the recorded short forced-loss escape horizon. **These task labels do not certify stronger practical play or penalize other potentially sound lines.**

## Follow-up: more decisive games and varied starts

Run [45015813757](https://github.com/amatouazuwo/shogi-is-luck-engine/actions/runs/45015813757) was triggered to repeat the **same engines** without changing their evaluation code, but with:

- the same 4 special-board opening pairs at 100ms, now up to 160 plies;
- 4 additional, separately archived opening pairs at 100ms, up to 120 plies;
- the same 4 opening pairs at 500ms, now up to 120 plies.

These are historically prepared openings, **not newly sealed holdouts**. The evaluator stores complete paired game logs as downloadable Actions artifacts, separates decisive and unfinished games, and includes legal-move cross-checking against the independent referee. Broader genuinely fresh openings and more independent completed games are required to accept a playing-strength claim.

## Technical next choices

If the candidate fails to demonstrate a robust improvement, do not promote it and do not tune arbitrary weights to make a few oracle move labels match. Examine whether the observable leaf correction is too small / too localized, whether extra evaluation work reduces actual search speed, and whether loss of piece mobility or king escape caused missed moves in real games. The previously tested `experiments/reserve-pressure` candidate measures **different** checking-drop paths; it should be treated as a separate hypothesis and A/B tested before combining anything.

No production deployment, game modification, or PR merge is authorized.
