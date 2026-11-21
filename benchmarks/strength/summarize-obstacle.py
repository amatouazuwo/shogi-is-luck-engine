import json
import math
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


def pair_score_range(rows):
    # Capped games are unresolved. Treat each distinct start as one clustered
    # observation, even when it is shared across multiple budgets.
    starts = defaultdict(list)
    for row in rows:
        starts[row["kind"], row["pair"]].append(row)
    floors = []
    ceilings = []
    for games in starts.values():
        wins, _, draws, capped = counts(games)
        floors.append((wins + draws / 2) / len(games))
        ceilings.append((wins + draws / 2 + capped) / len(games))
    lo = statistics.mean(floors)
    hi = statistics.mean(ceilings)
    radius = math.sqrt(math.log(40) / (2 * len(starts)))
    return {
        "distinctStarts": len(starts),
        "observedScoreRange": [round(lo, 4), round(hi, 4)],
        "hoeffding95WithCappedGames": [max(0, round(lo - radius, 4)), min(1, round(hi + radius, 4))],
    }


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
    opponent = next((turn["engine"] for row in games for turn in row["turns"] if turn["engine"] != "nnue"), "reference")
    failures = defaultdict(Counter)
    for row in games:
        if row["reason"] in {"search-timeout", "illegal", "clock", "resign"}:
            actor = "nnue" if row["winner"] != row["nnueSide"] else opponent
            failures[actor][row["reason"]] += 1
    summary.append({
        "budget": budget,
        "kind": kind,
        "games": len(games),
        "sente": counts([row for row in games if row["nnueSide"] == 0]),
        "gote": counts([row for row in games if row["nnueSide"] == 1]),
        "total": counts(games),
        "reasons": dict(reasons),
        "timeouts": dict(timeouts),
        "failuresByEngine": dict(failures),
        "score": pair_score_range(games),
        "nnue": stats(games, "nnue"),
        "opponent": stats(games, "baseline") or stats(games, "reference"),
    })
all_games = [row for games in cases.values() for row in games]
print(json.dumps({"groups": summary, "total": counts(all_games),
                  "score": pair_score_range(all_games) if all_games else None,
                  "unpaired": [{"budget": b, "kind": k, "games": v} for (b, k), v in excluded.items()]},
                 ensure_ascii=False, indent=2))
