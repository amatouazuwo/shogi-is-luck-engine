"""Recompute the archived tactical-guard outcome and scope disclosures."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument("archive",type=Path,help="Engine benchmarks/strength directory")
parser.add_argument("--game",type=Path)
args=parser.parse_args()
guard=args.archive/"experiments/obstacle-tactical-guard"
def read(path):
    return [json.loads(line) for line in path.read_text().splitlines() if line]
def correct_by_category(rows):
    scores={}
    for name in ("baseline","guard"):
        for budget in sorted({row["budget"] for row in rows}):
            counts=Counter()
            for row in rows:
                if row["name"] != name or row["budget"] != budget:
                    continue
                category=row["category"]
                group="attack" if category.startswith("forced-win") else (
                    "escape" if category.startswith("forced-loss-escape") else "known")
                counts[(group,"trials")]+=1
                counts[(group,"correct")]+=int(row["correct"])
            scores[f"{budget}/{name}"]={group:[
                counts[group,"correct"],counts[group,"trials"]
            ] for group in ("attack","escape","known")}
    return scores

heldout=read(args.archive/"forensics/heldout/heldout.jsonl")
initial=[row for row in read(guard/"worker-all-heldout.jsonl") if row["event"]=="trial"]
repair=[row for row in read(guard/"repair/worker-controls.jsonl") if row["event"]=="trial"]
proofs=[row for row in read(guard/"repair/exact-incumbent.jsonl") if row["event"]=="incumbent"]
assert len(heldout)==36 and len(initial)==228 and len(repair)==56 and len(proofs)==8
unsafe=[row for row in initial if row["name"]=="guard" and row.get("guard")
        and row["guard"]["status"]=="replaced-proved-loss" and not row["correct"]]
assert all(row["legal"] for row in initial+repair)
assert {row["proof"]["proof_nodes"] for row in proofs}=={32,114}
replacements=[row for row in repair if row["name"]=="guard" and row.get("guard")
              and row["guard"]["status"]=="replaced-proved-loss"]
assert not replacements and all(not row["oracleSafe"] for row in proofs)
out={"heldout":len(heldout),"initialTrials":len(initial),"initialScores":correct_by_category(initial),
     "initialWrongReplacements":[{key:row[key] for key in ("id","budget","move","guard")} for row in unsafe],
     "repairTrials":len(repair),"repairWorkerTrials":sum(row["name"]=="guard" for row in repair),
     "repairWorkerReplacements":len(replacements),"repairProofNodes":sorted({r["proof"]["proof_nodes"] for r in proofs}),
     "repairManualTargetsRestored":sum(row["oracleSafe"] for row in proofs),
     "repairManualTargets":len(proofs)}
if args.game:
    package=args.game/"ai/obstacle-sdk"
    digest=lambda file:hashlib.sha256(file.read_bytes()).hexdigest()
    out["gameObstacleSdk"]={"wasmSha256":digest(package/"rsshogi_nnue_mini.wasm"),
                            "workerSha256":digest(package/"worker.js")}
print(json.dumps(out,indent=2))
