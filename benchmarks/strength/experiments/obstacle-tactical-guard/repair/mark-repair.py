"""Record the original guard and safety overlay in the repaired scratch SDK."""
import hashlib
import json
from pathlib import Path
import sys

output = Path(sys.argv[1])
base_patch, repair_patch = map(Path, sys.argv[2:4])
manifest_path = output / 'manifest.json'
manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
assert manifest['candidate']['patch_sha256'] == sha(base_patch)
manifest['package'] = 'rsshogi-nnue-mini-obstacle-tactical-guard-exact3'
manifest['candidate']['safety_repair'] = {
    'patch': repair_patch.name,
    'patch_sha256': sha(repair_patch),
    'horizon_plies': 3,
    'criterion': 'All-legal terminal search for the replacement; unfinished checks preserve original move',
    'mate_score_veto': True,
}
manifest['modifications'].append('Vetoes an existing mate loss or a proved three-ply loss after the substitute')
for name in manifest['artifacts_sha256']:
    assert Path(name).name == name
    manifest['artifacts_sha256'][name] = sha(output / name)
manifest_path.write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
files = [*sorted(manifest['artifacts_sha256']), 'manifest.json']
(output / 'SHA256SUMS').write_text(''.join(f'{sha(output / name)}  {name}\n' for name in files), encoding='utf-8')
