import json
import statistics
import sys
from collections import Counter, defaultdict


def read_games(files):
    pairs = defaultdict(dict)
    for filename in files:
        with open(filename, encoding="utf-8") as stream:
            for raw in stream:
                try:
                    row = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if row["event"] != "game":
                    continue
                label = row["budget"], row["kind"], row["pair"]
                sides = pairs[label]
                if row["nnueSide"] in sides:
                    raise ValueError(f"Duplicate game for {label}")
                sides[row["nnueSide"]] = row
    return pairs


def stats(rows, name):
    turns = [turn for row in rows for turn in row["turns"] if turn["engine"] == name]
    if not turns:
        return {}
    return {
        "count": len(turns),
        "meanDepth": round(statistics.mean(turn["depth"] for turn in turns), 2),
        "meanNodes": round(statistics.mean(turn["nodes"] for turn in turns), 2),
        "meanWallMs": round(statistics.mean(turn["elapsed"] for turn in turns), 2),
        "overRequestedPlus50": sum(turn["elapsed"] > turn["requestMs"] + 50 for turn in turns),
        "above50Ms": round(max(turn["elapsed"] - turn["requestMs"] for turn in turns), 2),
    }


def result(row):
    if row["winner"] is None:
        return "cap" if row["reason"] == "ply-cap" else "draw"
    return "win" if row["winner"] == row["nnueSide"] else "loss"


def counts(rows):
    values = Counter(result(row) for row in rows)
    return [values[key] for key in ("win", "loss", "draw", "cap")]


cases = defaultdict(list)
excluded = defaultdict(int)
for (budget, kind, pair), sides in read_games(sys.argv[1:]).items():
    if set(sides) != {0, 1}:
        excluded[budget, kind] += len(sides)
        continue
    cases[budget, kind].extend(sides.values())

summary = []
for (budget, kind), games in sorted(cases.items()):
    reasons = Counter(row["reason"] for row in games)
    timeouts = Counter(row["detail"]["searchSide"] for row in games if row["reason"] == "search-timeout")
    summary.append({
        "budget": budget,
        "kind": kind,
        "games": len(games),
        "sente": counts([row for row in games if row["nnueSide"] == 0]),
        "gote": counts([row for row in games if row["nnueSide"] == 1]),
        "total": counts(games),
        "reasons": dict(reasons),
        "timeouts": dict(timeouts),
        "nnue": stats(games, "nnue"),
        "reference": stats(games, "reference"),
    })
print(json.dumps({"groups": summary, "unpaired": [{"budget": b, "kind": k, "games": v} for (b, k), v in excluded.items()]},
                 ensure_ascii=False, indent=2))
