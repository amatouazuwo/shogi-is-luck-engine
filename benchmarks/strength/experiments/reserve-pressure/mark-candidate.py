"""Record the exact experimental overlay and recompute the package checksums."""
import hashlib
import json
from pathlib import Path
import sys

output, patch = map(Path, sys.argv[1:3])
base = sys.argv[3]
manifest_path = output / "manifest.json"
manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
assert all(Path(name).name == name for name in manifest["artifacts_sha256"])
for name in manifest["artifacts_sha256"]:
    manifest["artifacts_sha256"][name] = hashlib.sha256((output / name).read_bytes()).hexdigest()
manifest["package"] = "rsshogi-nnue-mini-obstacle-reserve-pressure"
manifest["patch_revision"] = base
manifest["candidate"] = {
    "patch": patch.name,
    "patch_sha256": hashlib.sha256(patch.read_bytes()).hexdigest(),
    "scope": "nonempty obstacle mask only",
    "maximum_adjustment": 80,
    "description": "Corrects embedded NNUE for checking-drop channels removed by holes.",
}
manifest["modifications"].append("Obstacle-only bounded checking-drop channel correction")
manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
payload = [*sorted(manifest["artifacts_sha256"]), "manifest.json"]
sums = [f"{hashlib.sha256((output / name).read_bytes()).hexdigest()}  {name}" for name in payload]
(output / "SHA256SUMS").write_text("\n".join(sums) + "\n", encoding="utf-8")
