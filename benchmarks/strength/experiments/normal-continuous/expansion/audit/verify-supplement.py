"""Compare the game-derived supplemental fixtures with an independent rule executable."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("fixtures", type=Path)
parser.add_argument("reference", type=Path)
args = parser.parse_args()
fixtures = [json.loads(line) for line in args.fixtures.read_text().splitlines() if line]
fixtures = [row for row in fixtures if row["event"] == "opening"]
queries = []
for row in fixtures:
    sfen = row["opening"]
    opposite = sfen.split()
    opposite[1] = "w" if opposite[1] == "b" else "b"
    queries += [("legal", sfen), ("mate", sfen), ("mate", " ".join(opposite))]
input_text = "".join(f"{action}\t{sfen}\t-\n" for action, sfen in queries)
output = subprocess.run([args.reference.resolve()], input=input_text, capture_output=True, text=True,
                        check=True, timeout=10)
responses = [json.loads(line) for line in output.stdout.splitlines()]
assert len(responses) == 3 * len(fixtures) and fixtures
for index, row in enumerate(fixtures):
    actual, same_side, other_side = responses[index*3:index*3+3]
    assert sorted(actual["moves"]) == sorted(row["legalMoves"]), row["family"]
    assert same_side == other_side == {"mate": [], "noLegalWithoutCheck": []}, row["family"]

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

print(json.dumps({"fixturesSha256": digest(args.fixtures), "referenceSha256": digest(args.reference),
                  "positions": len(fixtures), "legalSetMatches": len(fixtures),
                  "immediateWinChecks": 2*len(fixtures), "differences": 0}, indent=2))
