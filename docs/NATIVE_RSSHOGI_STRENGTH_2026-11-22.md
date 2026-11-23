# UPDATED: 300-ply obstacle games fully completed, neutral undecided policy confirmed

**Completed 300-ply experiment:** [GitHub Actions 45022210336](https://github.com/amatouazuwo/shogi-is-luck-engine/actions/runs/45022210336), all stages successful, builds/rule parity/paired matches/safety checks archived. Comparison is the historic `hole-aware-eval.patch` versus the unchanged rsshogi obstacle SDK, not a newly promoted engine.

| Opening set | Think budget | Cap | Candidate wins | Candidate losses | Neutral undecided |
|---|---:|---:|---:|---:|---:|
| reserve-pressure four families, both obstacle types/colors | 100ms | **300 plies** | **8** | **7** | **1** |
| separate older four opening families | 100ms | 120 plies | 7 | 7 | 2 |
| reserve-pressure four families again | 500ms | 120 plies | 4 | 8 | 4 |
| **All three groups** | | | **19** | **22** | **7** |

- Of the **16 games** with a 300-ply cap, **15 were legally decided** because the next player had no legal move (`reason=no-legal`); **1 black-hole game reached exactly 300 plies** without a verdict. These are not necessarily orthodox shogi checkmates under all special rules; the reference legality evaluator determines whether any legal move remains. The 300-ply cap is a **measurement limit, not a target win deadline**; a neutral capped game is not an error, a bad move, a loss or an adjudicated draw.
- The 300-ply group contains 8 pit games (5W/3L/0 undecided) and 8 black-hole games (3W/4L/**1 neutral undecided**). Across its eight color-swapped board openings, 7 pairs have two decided outcomes: 2 candidate sweeps, 1 baseline sweep, 4 split pairs; one pair was incomplete.
- This still **does not support adopting the extra obstacle-only evaluation heuristic**. Broad native playing strength, rather than a shorter mean finish length or oracle label match, remains the only reason to consider an engine change.
- Archived tactical safety check in the new run: both compared engines satisfied 36/36 at 100ms, 35/36 at 500ms; no candidate-vs-baseline label gains or losses. This is an auxiliary limited-horizon score, not an assertion that a different unlabeled winning line is bad.

### Correct interpretation versus the earlier 160-ply experiment

An independent [result validation run 45026114409](https://github.com/amatouazuwo/shogi-is-luck-engine/actions/runs/45026114409) downloaded both complete test archives and validated all 48 newer games, 16 exact same starting games for 160-to-300 comparison and the neutral `UNDECIDED` handling. Its tests and archive checks **passed**.

- Old 100ms group with 160-ply cap: **7W / 6L / 3 undecided**.
- Newly replayed 100ms group with 300-ply cap: **8W / 7L / 1 undecided**.
- **Critically, none of the 16 newly played games reproduced the old complete move sequence. All 16 diverged before the end of the older match.** Their compiled WASM digests also differ across the two runs, despite equivalent source/revision/model. Thus **there were ZERO genuine continuations of an earlier 160-ply game.** A reduction in capped-game count (3 to 1) is NOT proof that extending the cap itself resolved those earlier exact games.
- The distinct color-swapped 500ms and 100ms starting layouts are correlated; avoid treating all 48 cases as independent skill samples.
- An automated test exists at `benchmarks/strength/experiments/hole-eval/compare-ply-cap-replays.mjs` to track the exact prefix length before divergence. This ensures "a replay happened to finish" is not misreported as "the earlier unfinished game was continued to the end."

**Decision:** preserve the unmodified obstacle rsshogi baseline, no production or PR merge. For future work, prioritize obstacle-aware evaluation / continuous search ideas only when they demonstrate actual improvement in varied paired games and without hurting legal-move performance. Unfinished long games remain **neutral**.

---

# FINAL ADDENDUM — identical-rsshogi null control also completed

Independent GitHub Actions [45017142828](https://github.com/amatouazuwo/shogi-is-luck-engine/actions/runs/45017142828) **passed** with the **same immutable WASM SHA-256 on both competing engine roles**: `113325872d27db39e152b281bc28b954c06db6e87257a38ef8860a387d665227`. The null control played the same four paired opening families at 100ms/80 plies and first two at 500ms/60 plies as the original 24-game experiment. It records:
- 100ms, two copies of the *same* rsshogi: nominal candidate **1 win, 5 losses, 10 unfinished** over 16 games. These role labels are arbitrary; the split itself shows that small, incomplete match samples can be misleading even without a change to the underlying engine.
- 500ms, two copies of the *same* rsshogi: **1 win, 1 loss, 6 unfinished** over 8 games.
- **0/12 different first-root moves**, but in subsequent *identical root positions* up until trajectories first diverged, **114/121 same moves** at 100ms and **21/25 same moves** at 500ms (135/146 agreement overall). Thus independently timed copies of the same engine can legitimately make **11 different moves across 146 comparable in-game search decisions**, despite identical WASM bytes.
- The same-source A/B candidate-versus-baseline experiment gave **43/55** equal moves before divergence on the original 24-game sample and **68/92** on the longer 48-game sample. These are correlated trajectories and different search-length samples, NOT valid Bernoulli confidence estimates. They suggest the evaluator supplement could change decisions beyond the baseline's natural timing variability; they do NOT prove those decisions are stronger.

**Adoption decision: DO NOT ADOPT the existing hole-aware leaf supplement on the available evidence.** In 48 extended direct games it scored 18 wins / 18 losses / 12 unfinished, and 16 complete color-swapped pairs consisted of 2 candidate sweeps, 1 baseline sweep and 13 split pairs. The identical-engine control verifies that time-limited move variation alone exists. No stable native-strength gain has been established. Retain the known-correct obstacle-masked rsshogi baseline, no production change. Prefer subsequent experiments that prove an improved obstacle-aware positional evaluation without substantially reducing nodes searched per time budget; calibrate against same-WASM self-play, normal-board fidelity, and independent paired games.

The control is not the **same byte-for-byte WASM** as the previously separately compiled baseline build (source, upstream pins and NNUE are the same; build hash can differ across runs), so avoid claiming exact inter-run determinism. What is guaranteed is that *both contestants within the null test* used the exact same compiled binary. The workflows retain the archived logs for independent reanalysis.

---

# UPDATED: 48 paired obstacle games completed — no demonstrated strength gain

GitHub Actions [45015813757](https://github.com/amatouazuwo/shogi-is-luck-engine/actions/runs/45015813757) **succeeded** (all two SDK builds, rule parity, three batches of A/B games, 36 verified tactical positions at two budgets, artifact archiving).

**Primary native playing-strength result (hole-aware NNUE candidate vs unchanged rsshogi obstacle SDK):**

| Opening sample | Budget | Candidate wins | Candidate losses | Not decided by ply cap | Completed color-swapped pairs |
|---|---:|---:|---:|---:|---:|
| prior reserve-pressure openings (four paired families) | 100ms, 160 ply | 7 | 6 | 3 | 6 / 8 |
| different historical holdout openings (four paired families) | 100ms, 120 ply | 5 | 8 | 3 | 5 / 8 |
| prior reserve-pressure openings (same four families) | 500ms, 120 ply | 6 | 4 | 6 | 5 / 8 |
| **Total** | | **18** | **18** | **12** | **16 / 24** |

Among the 16 fully decided color-swapped pairs, the candidate won both color assignments in **2** pairs; the baseline won both in **1** pair; **13** were split one win each. The other **8 pairs were incomplete** and cannot be treated as draws or wins. The 500ms games reuse the 100ms opening identities and therefore do not supply eight additional independent starting positions. **No reliable advantage is demonstrated.**

The original 36 archived, proof-labelled tactical positions at 100ms and 500ms were **35/36 for each engine** (no label improvements or regressions). Those labels are auxiliary safety checks and not proof of relative strength; the sole label disagreement in each budget was shared by both engines. No illegal move or worker timeout was reported in the tactical results.

Matching starting positions under swapped colors: among 24 matched initial positions, **3 candidate-vs-baseline first moves differed**. Across the same root positions followed only until the two game paths diverged, the three batches gave **23/31, 35/43, 10/18** matching moves, respectively (68/92 total). Search scheduling may explain some of the differences; a same-SDK-vs-itself [null control](https://github.com/amatouazuwo/shogi-is-luck-engine/actions/runs/45017142828) was launched to measure that directly. These correlated agreement ratios are diagnostics, **not win-rate estimators**.

A separately triggered [report verification workflow](https://github.com/amatouazuwo/shogi-is-luck-engine/actions/runs/45017485679) downloads the completed 48-game artifact, validates all 48 games and 24 opening color swaps, checks that the win-loss-undecided counts are 18-18-12, and saves a structured record. **Do not promote this eval supplement or modify production at this stage.** Preserve the existing rsshogi obstacle SDK as the baseline.

---

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

## Diagnostic: obstacle correction changes leaf values, but rarely archived decisions

Measured directly from `benchmarks/strength/experiments/hole-eval/compare.jsonl` and the completed native A/B run `45013783788` (these are different experiments and must not be pooled as one statistical sample):

- In the historical 100-position exact-static-value comparison, **78/100** eval scores changed. The **20 terminal/no-legal** test cases all changed, but those do not demonstrate a useful change in live search because normal terminal scoring overrides ordinary leaf evaluation.
- In the **80 nonterminal cases**, **58/80** changed in static value. By tactical class: mate-in-one 20/20; evade-forced-win 12/20; material-gain 14/20; ray-blocking 12/20. Nonterminal absolute shifts were mostly on the order of a few tens of evaluation units; the historical sample's maximum absolute static shift was 64.
- In the new native direct same-position tactic comparison (36 positions × 100ms and 500ms), **only 1/72** paired candidate-vs-baseline best moves differed, and *both* alternative moves were verified label matches within the fixed proof horizon.

Interpretation: the obstacle-only correction is indeed reaching the static evaluator, but this does not establish that it changes practical strategic decisions often enough to improve strength. It may merely adjust numerical scores without materially altering search choices; alternatively, it may matter in longer, less artificial games. The direct games, including games that end undecided at the ply cap, are necessary to distinguish those possibilities.

Do not misinterpret the 78/100 changed static numbers as 78% better decisions. Do not treat the one differing tactical choice as a regression or benefit absent further evidence. Evaluate search throughput and first-move differences on the *same* root position, especially with blocked rays and actual king threats, rather than tuning to the archive.

## Secondary diagnostic from run 45013783788: same-root choices and throughput

All 24 direct games preserve their full per-move search traces. Comparing the **same first-move root position** between the color-swapped candidate/baseline games (which are independent time-limited searches) yields **3 different initial moves across 12 matching opening/budget comparisons**:

- 100ms, pair 31, blackhole: candidate `5c6a+`, baseline `5c4a+`.
- 100ms, pair 33, pit: candidate `6f7e`, baseline `7f6d`.
- 100ms, pair 33, blackhole: candidate `3f4e`, baseline `6i6h`.
- The other 9 first-move comparisons agreed. Differences may include ordinary time/CPU scheduling variation; a move difference alone is not a proof of improvement.

Across all **1,707 recorded plies**: candidate 854 searches, mean depth **5.690**, mean nodes **22,397**, mean nodes/sec **100,298**; baseline 853 searches, mean depth **5.771**, mean nodes **22,547**, mean nodes/sec **100,762**. The aggregate includes both 100ms and 500ms budgets and correlated repeated openings. There is no evidence of a **large** slowdown from this small sample, but the numbers do not establish a statistically reliable throughput difference.

A new strict, tested analyzer at `benchmarks/strength/experiments/hole-eval/summarize-native-eval.mjs` reports only **decided** games as wins/losses, requires both colors for each opening, measures same-root first move discrepancies and search throughput, and retains the distinction between capped games and genuine draws. CI run [45016821717](https://github.com/amatouazuwo/shogi-is-luck-engine/actions/runs/45016821717) passed all analyzer unit tests.

## Strict report replay and first-divergence comparisons (2026-11-22)

A separate report-only GitHub Actions check [45017078189](https://github.com/amatouazuwo/shogi-is-luck-engine/actions/runs/45017078189) successfully downloaded the **actual archived 24-game ZIP**, ran `summarize-native-eval.mjs` against it, and asserted the expected counts of 3 wins, 2 losses, 19 unresolved, 12 opening pairs and 3 changed first moves. The summary JSON is preserved as its workflow artifact; this validation does not rebuild or modify rsshogi.

More granular matched-position results, comparing the two color-swapped runs **only until they choose different moves and reach different positions**:
- 100ms: **30 matching moves across 38 identical-position comparisons**; root first moves differed in 3/8 opening/budget pairs.
- 500ms: **13 matching moves across 17 identical-position comparisons**; root first moves differed in 0/4 pairs.
- Therefore, 43 matching decisions across 55 genuinely identical-root comparisons, but these decisions are strongly correlated within game trajectories and tiny in independent opening-family count; do NOT interpret 43/55 as a binomial skill probability. The first point of divergence is recorded for each match.
- **Crucial confounder:** same WASM may give different time-limited moves on two independent runs because of CPU scheduling, search search-depth timing and initialization. A *same-engine-vs-same-engine null control* has therefore been launched as [45017142828](https://github.com/amatouazuwo/shogi-is-luck-engine/actions/runs/45017142828) on precisely the original 100/500ms openings/caps. Until that control is available, treat observed move differences as possible candidate influence, not proof of a genuine evaluation improvement.

The longer 48-game follow-up run is [45015813757](https://github.com/amatouazuwo/shogi-is-luck-engine/actions/runs/45015813757). Preserve winning, losing and undecided end states separately.
