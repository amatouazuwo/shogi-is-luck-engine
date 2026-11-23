"""Provenance and checksum refresh for the standalone obstacle guard experiment."""
import hashlib
import json
from pathlib import Path
import sys

package, patch = map(Path, sys.argv[1:3])
base = sys.argv[3]
manifest_path = package / 'manifest.json'
manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
manifest['package'] = 'rsshogi-nnue-mini-obstacle-tactical-guard'
manifest['patch_revision'] = base
manifest['candidate'] = {
    'patch': patch.name,
    'patch_sha256': sha(patch),
    'scope': 'timed obstacle searches only, with no separate node limit and negative evaluation of at least 1,000 engine units',
    'worker_reserve_ms': 'min(24, floor(movetime_ms / 8)), minimum advertised search 80 ms',
    'horizon_plies': 5,
    'probe_node_cap': 12000,
    'proof': 'checks and near-king captures for the attacker, complete legal replies for the defender, and native mate-in-one at the leaf',
}
manifest['modifications'].append('Bounded obstacle-only root defense after proving loss for the incumbent')
for name in manifest['artifacts_sha256']:
    assert Path(name).name == name
    manifest['artifacts_sha256'][name] = sha(package / name)
manifest_path.write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
payload = [*sorted(manifest['artifacts_sha256']), 'manifest.json']
(package / 'SHA256SUMS').write_text(''.join(f'{sha(package / name)}  {name}\n' for name in payload), encoding='utf-8')
