# shogi-is-luck-engine

Active engine: rsshogi-nnue-mini v0.4.0 (official unmodified WASM SDK). Game license remains independent; retain upstream MIT and third-party notices. User accepted the natural reading of upstream README and SDK MIT terms and chose not to contact upstream. Embedded weight provenance has not been independently verified. Production deployment requires separate explicit approval.

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
