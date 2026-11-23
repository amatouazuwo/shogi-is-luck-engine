# Continuous normal Worker browser check

The runner exports a scratch Git snapshot and serves it on localhost with the test asset flags. It installs the experimental Worker as a separate asset. It supplies the stock JavaScript module URL during initialization and checks the official WASM SHA-256. The original Worker and the experiment source are compared byte for byte to their inputs. The game repository and deployed sites are untouched.

Requirements are Bash, Git, GNU coreutils, Node.js 22, and a node_modules directory containing Playwright and pg. Install the Playwright Chromium binary or supply an existing Chromium executable.

```bash
CHROMIUM_EXECUTABLE=/usr/bin/chromium ./run-local.sh \
  /path/to/game-checkpoint /path/to/official/ai/sdk \
  /path/to/continuous-worker.mjs /path/to/node_modules
```

The baseline was game commit `e8a26f16325c9f27b29fa37ba8d06a0cc70ddeec`. The experimental Worker SHA-256 was `316830de7b28042f36c118762e978d139016c2f469f2b5651f3f8f9756a1cc7f`. This run used Node.js 22.23.5 and Chromium 156.0.8078.79. The Pixel 7 profile uses device emulation.

Each profile plays CPU moves through the game's normal entry point at all three budgets, compares the real Worker result with the pre-move legal list and applied move, and follows both direction changes between the normal and obstacle Workers. The cancellation probe resets after an actual 1500 ms search request, observes termination, and injects a late result into the old handler to check that the new session remains unchanged. It then searches again in the replacement session. The elapsed times and depths are individual browser samples.

## First 100 ms search comparison

Prefix the same runner command with `NORMAL_BROWSER_CHECK=cold-check.mjs` to compare the official Worker with the continuous Worker. `NORMAL_BROWSER_REPETITIONS` defaults to two. `NORMAL_BROWSER_COLD_ONLY=1` omits primed runs. `NORMAL_BROWSER_PROFILE` optionally selects `desktop` or `Pixel 7`. Each sample initializes a newly created Worker in the same browser process, and the order alternates between repetitions. This permits reuse of browser or OS caches across samples.

The primed condition uses a depth-2 search with a 100 ms cap on the position after 7g7f. It sends `new_game` before the measured search from the standard initial position. Both conditions use the same initial position and game-side legal list. Browser wall time runs from send to receive and includes messaging overhead. Engine-reported elapsed time has different boundaries in the two Workers. The official Worker SHA-256 was `7357552f5cf6bcea12fa6105f336cc612f790f1d1d6d01577856332584a5a0da`.

| Profile | Official fresh depth | Continuous fresh depth | Official primed depth | Continuous primed depth |
|---|---:|---:|---:|---:|
| Desktop | 0, 5 | 5, 5 | 6, 5 | 6, 5 |
| Pixel 7 | 5, 5 | 5, 4 | 6, 5 | 6, 6 |

All 16 measured moves were legal. The official Worker returned one depth-zero legal fallback in the fresh condition. The continuous Worker also returned depth-zero legal results in the separate integration check, recorded in `browser.log`. Initial Worker setup ranged from 297 to 567 ms. Priming added 58 to 112 ms, including position setup and reset. All four cancellation checks rejected the interrupted request and the injected old-Worker callback. Individual samples in `cold-browser.log` are useful for diagnosing startup and carry small-sample and shared-cache limitations.
