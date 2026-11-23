#!/usr/bin/env python3
import json
import statistics
import sys
from collections import defaultdict

with open(sys.argv[1], encoding="utf-8") as source:
    samples = [json.loads(row) for row in source if row.strip()]

groups = defaultdict(list)
blocks = defaultdict(dict)
for sample in samples:
    groups[(sample["profile"], sample["mode"])].append(sample)
    blocks[(sample["profile"], sample["block"])][sample["mode"]] = sample

for key, block in blocks.items():
    if set(block) != {"none", "time", "nodes"}:
        raise ValueError(f"Incomplete block {key}")
    if len({item["fixture"] for item in block.values()}) != 1:
        raise ValueError(f"Different positions within block {key}")

def spread(values):
    values = list(values)
    return {"min": round(min(values), 1), "median": round(statistics.median(values), 1),
            "max": round(max(values), 1)}

report = []
for (profile, mode), values in sorted(groups.items()):
    paired = [item for (row_profile, _), item in blocks.items() if row_profile == profile]
    row = {
        "profile": profile, "mode": mode, "n": len(values),
        "legal": sum(item["legal"] for item in values),
        "depth0": sum(item["depth"] == 0 for item in values),
        "depth": spread(item["depth"] for item in values),
        "initMs": spread(item["initMs"] for item in values),
        "goWallMs": spread(item["goWallMs"] for item in values),
        "initThroughMoveMs": spread(item["initThroughMoveMs"] for item in values),
        "goWallOver125": sum(item["goWallMs"] > 125 for item in values),
    }
    if mode != "none":
        row["primeMs"] = spread(item["prime"]["primeMs"] for item in values)
        row["primeDepth"] = spread(item["prime"]["depth"] for item in values)
        row["primeNodes"] = spread(item["prime"]["nodes"] for item in values)
        row["pairedInitThroughMoveDeltaMs"] = spread(
            item[mode]["initThroughMoveMs"] - item["none"]["initThroughMoveMs"] for item in paired
        )
    report.append(row)
print(json.dumps(report, ensure_ascii=False, indent=2))
