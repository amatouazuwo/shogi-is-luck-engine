"""Generate the candidate after applying its Worker-only overlay."""
import hashlib
import json
from pathlib import Path
import sys

package = Path(sys.argv[1])
patch = Path(__file__).parent / "adaptive-obstacle-worker.patch"
manifest_path = package / "manifest.json"
manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
sha = lambda filename: hashlib.sha256(filename.read_bytes()).hexdigest()
manifest["package"] = "rsshogi-nnue-mini-obstacle-adaptive-slices"
manifest["modifications"].append("Adaptive cooperative slice deadlines on obstacle Worker time searches")
manifest["candidate"] = {"patch":patch.name,"patch_sha256":sha(patch),"slices_ms":[35,70,90],
    "scope":"timed searches with nonempty obstacle mask only"}
manifest["artifacts_sha256"]["worker.js"] = sha(package / "worker.js")
manifest_path.write_text(json.dumps(manifest,indent=2)+"\n",encoding="utf-8")
payload = [*sorted(manifest["artifacts_sha256"]), "manifest.json"]
sums = [f"{sha(package / name)}  {name}" for name in payload]
(package / "SHA256SUMS").write_text("\n".join(sums) + "\n", encoding="utf-8")
