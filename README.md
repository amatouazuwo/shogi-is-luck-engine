# shogi-is-luck-engine

Active engine: rsshogi-nnue-mini v0.4.0 (official unmodified WASM SDK). Game license remains independent; retain upstream MIT and third-party notices. User accepted the natural reading of upstream README and SDK MIT terms and chose not to contact upstream. Embedded weight provenance has not been independently verified. Production deployment requires separate explicit approval.

## Obstacle SDK

The separate obstacle SDK adapts rsshogi to impassable board squares. Its move generator, attack rays, pawn-drop mate checks, fast mate search and terminal scoring use the mask while the embedded NNUE evaluates the board pieces. The game validates every returned move with its own legal move generator.

The build uses fixed public source commits for rsshogi-nnue-mini v0.4.0 and rsshogi v1.7.2, the upstream lockfile with the local rules patch, and the exact NNUE package from the official v0.4.0 WASM. Both upstream MIT text and all locked dependency notices are included. The build verifies the upstream ZIP, original WASM, embedded model, and dependency archives by SHA-256.

Run with Rust 1.95.0 including `wasm32-unknown-unknown`, Node 22, Python 3.11+, Git and curl.

```sh
rustup toolchain install 1.95.0 --profile minimal --target wasm32-unknown-unknown
RUN_ENGINE_TESTS=1 scripts/build-obstacle-sdk.sh /absolute/path/to/obstacle-sdk
cd /absolute/path/to/obstacle-sdk
sha256sum -c SHA256SUMS
```

Pass a local copy of the official ZIP as the second argument to reuse it. The generated `manifest.json` identifies upstream commits, patches, dependency lockfile, original model and output files. The CI workflow builds this package with native tests enabled. Distribute verified assets and notices together from the game's separate obstacle SDK directory.

The worker accepts an ordinary `position` containing `sfen` and optional `moves`. For obstacles, send the current four SFEN fields, an array of USI square strings in `holes`, and no replay moves. `go` sends search updates and a final best move. `legalMoves` returns the complete generated USI move set for differential testing.

## Verified staging

Game repository develop: PR #7, deployed smoke run [44575776082](https://github.com/amatouazuwo/shogi-is-luck/actions/runs/44575776082) passed desktop, Android Chromium emulation and iPhone WebKit emulation, including actual engine move application and license serving. Render startup collected notices for 28 locked dependencies. Physical device testing is not certified.

Official SDK: https://github.com/nyoki-mtl/rsshogi-nnue-mini/releases/tag/v0.4.0
ZIP SHA-256: 3d05b85949f5ae3bce3cef1f0678a3aeb31d9e8f935565bcc09da63bb19dd1d1
WASM SHA-256: feb190263b48caed5a81e0009cda35f6d2a23548ccf61d785f019420b857222d

Game legal moves are authoritative. Prioritize every legal enemy king capture; never predict untriggered random events. Special fallback searches current granted move only, with provisional top-12 tactical candidates.

## Cleanup

Obsolete YaneuraOu build workflow and its USI-only smoke script removed from active tree after staging smoke passed. No old engine binaries or evaluation weights were tracked in the active tree. Preserve Git history and any applicable notices for retained components. Historical CI artifacts have not been deleted. Former YaneuraOu experiment was GPLv3; it is not part of the game. Retain rsshogi client, position adapter and current workflows.

## Rollback

Disable RSSHOGI_TEST_ENABLED and RSSHOGI_SERVE_ASSETS in staging, verify old CPU and AI assets return 404. No DB migration. Do not modify production without approval.
