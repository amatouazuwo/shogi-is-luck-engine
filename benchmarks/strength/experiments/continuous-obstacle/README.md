# Real Chromium browser Worker and game-turn gating (2026-11-23)

The first **real Chromium browser-worker** test [45042607568](https://github.com/amatouazuwo/shogi-is-luck-engine/actions/runs/45042607568) **PASSED** with desktop and a Playwright Pixel 7 **device emulation** profile. Both profiles executed actual compiled `rsshogi-nnue-mini` WASM from a localhost HTTP server and:
- Successfully ran normal, pit and 3×3 black-hole searches with one reusable **module Worker**.
- Terminated a `1500ms` native search mid-computation; the abandoned promise returned `AbortError`, the controller ignored a deliberately injected stale bestmove and a fresh Worker searched a newly positioned pit.
- Refused a legal search result when its end-to-end wall-clock time exceeded the remaining 3-minute clock. The result was **not** applied and the Worker was retired and recreated before the next search.
- Completed a legal native move after the timeout. No page scripting errors were observed.
- No actual mobile phone hardware or deployed game UI was used: the Pixel 7 is Chromium device emulation. This result does NOT establish performance on a real smartphone or correctness of the game's live clock.

The `continuous-controller.mjs` now prohibits returning any result if total elapsed **Worker initialization + state transmission + legal move query + native search + messaging** exceeds the caller's `clockRemainingMs`. Its previous guard was only preventing the dispatch of a turn that had already timed out; without the post-search guard, a Worker with long initialization could return a legal but time-forfeit move.

A separate experiment-only `game-turn-adapter.mjs` was added for future game integration. The game's **authoritative** `snapshot()` callback must contain:

```js
{
  sessionId: 'current-game-unique-id', // changes on new game/navigation
  version: 41,                         // increments on every turn/board/event mutation
  nativeCompatible: true,               // false for unsupported special events
  sfen: '...', holes: ['5e'],
  legalUsiMoves: ['7g7f', '2g2f'],       // MUST come from the GAME's rules, not the AI
  clockRemainingMs: 180000
}
```

The game's **synchronous** `applyMove(bestmove, expectedPosition)` must itself confirm that the same session/version/current board remain and return `true` only if the move has been applied. On special events that change obstacles or available moves, position changes, disconnect, navigation or a game end, call **`await adapter.invalidate()`**. If a position changes without this call, the adapter still rejects the old result after it completes because the current session/version/SFEN/hole mask no longer matches; calling invalidate immediately also *stops* unnecessary work.

The adapter rejects moves after wall-clock expiry, unsupported special effects, stale sessions/revisions, and moves absent from either the before/after **game** legal lists. It never fabricates a fallback move, guesses game-rule adjudication or penalizes neutral unfinished games. It is NOT wired into the production game's `kickCPU` / clock / 1% event workflow. The real event dispatcher must set `nativeCompatible=false` for events with semantics rsshogi cannot evaluate directly, otherwise the game may apply an inapplicable move despite engine legality.

The adapter's isolated game-session, event, timer and move-acceptance tests passed in [45042875267](https://github.com/amatouazuwo/shogi-is-luck-engine/actions/runs/45042875267). A second Chromium [browser integration trial 45043023102](https://github.com/amatouazuwo/shogi-is-luck-engine/actions/runs/45043023102) was started to combine the actual WASM Worker with a **simulated** game session and special-event invalidation. Do not claim that second trial succeeded or that the live game is integrated unless the actual run is verified.

Keep draft PR #3 experimental and unmerged. The static hole-aware NNUE correction has no observed native-strength gain; the native-continuous Worker was promising on some archived and normal starts but **did not establish consistent improvement on newly sampled hole placements**. Production adoption must require both that playing-strength gate and true UI/clock/cancellation integration.

---

# FOLLOW-UP RESULTS — novel obstacle combinations and normal-board fidelity verified

The newer tests **COMPLETED successfully** in GitHub Actions and use the exact same engine and embedded NNUE (only the Worker differs):

| Sample | Budget / cap | Continuous wins | Losses | Neutral undecided | Complete reversed-side pairs |
|---|---:|---:|---:|---:|---:|
| New hole/black-hole placements on six distinct archived normal SFEN formations | 100ms / 300 ply | **11** | **13** | **0** | 12/12 |
| Same new placement corpus, subset of three formations | 500ms / 120 ply | **7** | **4** | **1** | 5/6 |
| **New obstacle-layout direct games** | | **18** | **17** | **1** | **17/18** |
| No obstacles, eight normal-board openings (hirate-derived and random) | 100ms / 200 ply | **13** | **3** | **0** | 8/8 |
| No obstacles, subset of two new formations (four board families) | 500ms / 120 ply | **1** | **3** | **4** | 1/4 |
| **Normal-board direct games** | | **14** | **6** | **4** | **9/12** |

- [Fresh obstacle layout test 45027863125](https://github.com/amatouazuwo/shogi-is-luck-engine/actions/runs/45027863125) PASSED; all **36** logged games were legally checked at every move, no move exceeding the requested budget by 50ms. At 100ms, continuous search mean depth **7.40** vs sliced **6.73**; at 500ms, **9.21** vs **7.78**. New special-board placements gave **no demonstrated, consistent advantage** at 100ms (11-13); the 500ms subgroup was smaller (7-4-1).
- [Normal-board fidelity test 45028524249](https://github.com/amatouazuwo/shogi-is-luck-engine/actions/runs/45028524249) PASSED; all **24** games were legally checked with identical WASM/NNUE. At 100ms, continuous 13W/3L, average depth **6.89** vs **6.39**; at 500ms, only 4/8 games decided and continuous scored 1W/3L/4 undecided, average depth **9.41** vs **7.65**. Do NOT claim a definitive 500ms weakness or strength from the tiny, heavily capped sample.
- Only newly sampled *obstacle masks* were fresh in the newer special-board test; base SFEN formations were from an older archived normal corpus. The 500ms subset overlaps with the 100ms sample. All match data is correlated and time-limited searches are not deterministic. Do not compute a misleading overall Elo or claim a general winning rate from these observations.
- The 36 previously archived tactical labels are only supplementary; overall **native playing strength** remains the primary objective. **UNDECIDED is not a negative score.**
- **Decision:** continuous search remains an experiment with promising normal-board results, but a generalized special-board strength gain is **not yet demonstrated**. Keep original rsshogi binary/evaluation unchanged, no production deployment.

## Browser-style cancellation controller, experimental only

`continuous-controller.mjs` provides an isolated, injection-based controller **not wired into the live game**. It maintains a reusable native Worker across successful searches and explicitly discards the Worker on cancel, worker error or search timeout. Every queued request has a unique ID and a session association; on cancellation, all pending requests reject with `AbortError`, stale replies are ignored, and a fresh Worker is initialized on the next turn. The returned `elapsedWallMs` measures initialization/communication/search wall time, not just native search time; the game must deduct actual wall time from its own three-minute clock. It checks the candidate's returned move against the current legal move list and never fabricates a move on cancellation.

`continuous-controller.test.mjs` covers consecutive Worker reuse, cancellation during active `go`, stale replies from a terminated Worker, AbortSignal cancellation, Worker timeout recovery and the expired-clock case. The test workflow [45030875601](https://github.com/amatouazuwo/shogi-is-luck-engine/actions/runs/45030875601) PASSED. The **real-WASM Node Worker integration test** `controller-real-smoke.mjs` and [run 45031007389](https://github.com/amatouazuwo/shogi-is-luck-engine/actions/runs/45031007389) were added to validate the same flow against an actual compiled rsshogi binary. **The real-WASM test passed** in [run 45031162289](https://github.com/amatouazuwo/shogi-is-luck-engine/actions/runs/45031162289): abort 8.68ms, restart plus a legal obstacle-board move 298.95ms, no stale bestmove, a normal-board legal move from the same recovered Worker, and successful reuse without rebuilding it. These single-run Node/Linux timings are not a browser/mobile guarantee.

**Deployment is still blocked** pending real browser Worker, real UI cancellation and scene navigation, special-event board transitions, 3-minute clock accounting, terminal-state adjudication, and varied mobile hardware performance checks. Node success alone is not a claim of browser integration. PR #3 remains draft and unmerged.

---

# VERIFIED RESULT — existing rsshogi's uninterrupted search is promising but NOT yet production-ready

GitHub Actions [45026414339](https://github.com/amatouazuwo/shogi-is-luck-engine/actions/runs/45026414339) passed all builds, same-WASM equivalence, independent full legal-move cross-checks, 40 color-swapped direct games, 100/500ms tactical safety checks and archived complete logs. An independent [archive replay / timing check 45027566626](https://github.com/amatouazuwo/shogi-is-luck-engine/actions/runs/45027566626) also passed.

| Opening configuration | Think time | Move limit | Continuous wins | Losses | Neutral undecided |
| --- | ---: | ---: | ---: | ---: | ---: |
| earlier reserve-pressure openings, 4 opening families | 100ms | 300 | **8** | 6 | 2 |
| different earlier holdout openings, 4 families | 100ms | 120 | **10** | 4 | 2 |
| first two earlier reserve-pressure families | 500ms | 120 | **4** | 2 | 2 |
| **All** | | | **22** | **12** | **6** |

- Only **34/40** games were decided by the independent no-legal-move rule; the other **six capped games are neutral UNDECIDED**, not inferior play or losses.
- Among **15 fully decided** color-swapped board pairs, **5** pairs were swept by continuous search, **1** by the baseline sliced Worker and **9** split one win apiece. **5** pairs have one or more unfinished games.
- Both competitors used **BYTE-IDENTICAL WASM engines and embedded NNUE models within this run**; only the Worker search scheduling differed.
- Mean reported search depth, continuous versus sliced: **6.75 vs 6.09** (100ms/300), **6.85 vs 6.19** (100ms/120), **8.42 vs 7.12** (500ms/120). The continuous search therefore reaches deeper iterations in the observed games.
- Mean wall times were approximately **102.2ms** per move at 100ms, and **502.7ms** at 500ms for the candidate, similar to the baseline. **Neither Worker had a move exceeding the configured budget by 50ms** in these samples.
- Reported node counts are NOT directly comparable as node-per-second speed measures: the sliced Worker accumulates nodes from repeatedly restarted searches, whereas continuous search is one request. Do not equate the candidate's lower node count with a CPU slowdown.
- 36 archived obstacle tactical problems yielded **35/36 strict label matches for BOTH** engines at 100ms and 500ms, without any between-engine correctness gains/regressions. These labels are auxiliary safety evidence, not the target or a universal best-move oracle.
- Interpretation: **PROMISING, NOT PROVEN**. Archived and partially overlapping opening families, time-bound move variability, and only 40 games are not a reliable general playing-strength proof. Do not confuse shorter games, deeper search and isolated winning records with stronger general play.

## Additional special-board configurations

A dedicated fixture smoke test [45027747743](https://github.com/amatouazuwo/shogi-is-luck-engine/actions/runs/45027747743) passed: `generate-fresh-openings.mjs` selects **six distinct previously archived normal-board SFEN formations**, three hirate-derived and three randomly-formed, and applies **new deterministic single-hole and 3×3 black-hole placements** that do not overlap pieces. The referee verifies the legal move counts; the generator does not query the referee for strongest moves.

This is **fresh obstacle placement on older normal openings**, not a genuinely secret or previously unpublished corpus. The new direct-game experiment is [45027863125](https://github.com/amatouazuwo/shogi-is-luck-engine/actions/runs/45027863125): **24 games** at 100ms/300-ply cap plus **12 games** at 500ms/120-ply cap, all with same WASM/NNUE/rules and both colors. The result must be assessed independently, with undecided still neutral.

## Mandatory pre-deployment caveat

The continuous Worker performs a synchronous WASM call and **cannot process `stop` until search returns**. This prevents adopting it as-is for real three-minute play where interrupts, navigation or disconnection must work safely. A safe abort/restart design plus validation under full game interaction is mandatory even if independent fresh-board games favor it. Nothing has been merged into production or the game's deployment branch.

---

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


## Verification and result reporting

- Worker mock protocol tests in `worker.test.mjs` confirm obstacle SFEN and legal move routing, exactly one engine search per `go`, exact requested search budget, and invalid argument handling.
- Report parser tests in `report.test.mjs` verify **same WASM bytes on both contestants**, neutral classification of unadjudicated repetition and move-cap outcomes, and preservation of matched color-swapped games. CI [45027004415](https://github.com/amatouazuwo/shogi-is-luck-engine/actions/runs/45027004415) succeeded.
- After the full experiment completes, use `report.mjs` on its three saved per-game JSONL archives. It reports actually decided games, neutral undecided, complete/incomplete two-color pairs, search depth, node throughput, actual per-move wall time including p95, and calls exceeding the requested budget by 50ms or 200ms.
- Never interpret shorter games, deeper search or a limited number of archived position wins by themselves as proof of stronger general play. Even if direct games favor continuous search, safe mid-search interruption remains a mandatory future engineering requirement before promotion.

## Stopping a synchronous search — real binary evidence and restrictions

Independent [real native WASM cancel/restart check 45028387266](https://github.com/amatouazuwo/shogi-is-luck-engine/actions/runs/45028387266) **passed**. It started a **1500ms uninterrupted search** on an actual pit position, gave the worker time to enter the synchronous native call, forcibly terminated its thread, and created a fresh worker with the same WASM/NNUE to play a legal obstacle move.

- Hard thread abort: **9.06ms** in this single Linux runner trial (not a latency guarantee).
- Restart + new actual search + legal response: **352.14ms** in this single trial.
- **No stale bestmove** from the aborted calculation was delivered; recovered move was legal.
- This test does NOT provide the best intermediate move from the aborted search. Mid-search graceful `stop` remains unsupported; the experimental Worker now returns **`ok:false` for `stop` requests**, instead of pretending it can cancel native synchronous calls. That explicit error is covered by [unit test 45028641425](https://github.com/amatouazuwo/shogi-is-luck-engine/actions/runs/45028641425).
- For actual 3-minute play, a parent orchestration layer must track request generations, terminate/cancel the old worker when abandoning a turn, keep stale callbacks from applying old moves, reinitialize the new worker before the next search, count elapsed real time consistently, and test disconnection/reentry/late replies. Browser Worker termination needs its own validation; a Node Worker test alone does not establish browser safety.
- Never return a fabricated/fallback move from an aborted search solely to shorten a game. Returning **no move** on cancellation is safer than risking illegal or strategically meaningless moves.

## Normal-board regression comparison

[Normal-board control run 45028524249](https://github.com/amatouazuwo/shogi-is-luck-engine/actions/runs/45028524249) compares the same two actual SDK Worker implementations (continuous vs official sliced, identical embedded NNUE/WASM, **no holes**) over distinct hirate-derived and random starting boards. The test runner uses new `normal-worker` mode in `benchmarks/strength/ci/match.mjs` to avoid silently replacing the supplied Worker with a legacy normal experiment Worker. The purpose is to check **preservation of ordinary-board playing ability**, NOT to rank candidate by short-mate labels. Do not claim a normal-board result until this CI run has actually completed.

