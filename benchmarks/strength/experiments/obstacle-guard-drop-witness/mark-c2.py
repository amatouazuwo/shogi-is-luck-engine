"""Extend the established guard safety provenance after applying C2."""
import hashlib
import json
from pathlib import Path
import sys

output, overlay = map(Path, sys.argv[1:3])
manifest_path = output / 'manifest.json'
manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
manifest['package'] = 'rsshogi-nnue-mini-obstacle-tactical-guard-drop-witness'
manifest['candidate']['drop_witness'] = {
    'patch': overlay.name,
    'patch_sha256': sha(overlay),
    'scope': 'Exact replacement verification on the final attacker ply',
    'certificate': 'A defender holding a non-pawn with at least two live drop destinations has a legal reply after every nonchecking move.'
}
manifest['modifications'].append('Certifies quiet terminal impossibility from a surviving non-pawn drop square in the exact three-ply screen')
for name in manifest['artifacts_sha256']:
    assert Path(name).name == name
    manifest['artifacts_sha256'][name] = sha(output / name)
manifest_path.write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
paths = [*sorted(manifest['artifacts_sha256']), 'manifest.json']
(output / 'SHA256SUMS').write_text(''.join(f'{sha(output / name)}  {name}\n' for name in paths), encoding='utf-8')
