import hashlib
import json
import math
import statistics
import subprocess
import sys
from collections import Counter, defaultdict
from pathlib import Path


DIRECTORY = Path(__file__).resolve().parent
ENGINES = {"nnue": "adaptive", "baseline": "baseline"}


def load_campaign(path):
    raw = path.read_bytes()
    records = [json.loads(line) for line in raw.splitlines() if line.strip()]
    if not records:
        raise ValueError("Empty campaign")
    config = records[0]
    if config["event"] != "config" or config["opponent"] != "baseline":
        raise ValueError("Expected a direct campaign against the baseline Worker")

    labels = {
        (budget, kind, pair, side)
        for budget in config["budgets"]
        for kind in config["kinds"]
        for pair in range(config["pairOffset"], config["pairOffset"] + config["pairCount"])
        for side in (0, 1)
    }
    games = [row for row in records if row["event"] == "game"]
    starts = [row for row in records if row["event"] == "game-start"]
    def identity(row):
        return row["budget"], row["kind"], row["pair"], row["nnueSide"]

    for rows in (games, starts):
        if len(rows) != len(labels) or {identity(row) for row in rows} != labels:
            raise ValueError("Campaign is missing distinct game starts or results")
    recorded_starts = {identity(row): row["start"] for row in starts}
    for game in games:
        key = identity(game)
        if game["start"] != recorded_starts[key] or game["start"] != recorded_starts[(*key[:3], 1 - key[3])]:
            raise ValueError(f"Starting positions differ for {key}")
        if game["reason"] == "ply-cap" and (game["winner"] is not None or len(game["turns"]) != config["plyCap"]):
            raise ValueError(f"Unexpected capped game for {key}")
        for turn in game["turns"]:
            expected = "nnue" if turn["side"] == game["nnueSide"] else "baseline"
            if turn["engine"] != expected:
                raise ValueError(f"Turn logged under the wrong engine for {key}")
    return config, games, hashlib.sha256(raw).hexdigest()


def outcome(game):
    if game["winner"] is None:
        return "cap" if game["reason"] == "ply-cap" else "draw"
    return "win" if game["winner"] == game["nnueSide"] else "loss"


def count_outcomes(games):
    counts = Counter(map(outcome, games))
    return {name: counts[name] for name in ("win", "loss", "draw", "cap")}


def timing(games, engine):
    turns = [turn for game in games for turn in game["turns"] if turn["engine"] == engine]
    wall = sorted(turn["elapsed"] for turn in turns)

    def mean(key):
        return round(statistics.mean(turn[key] for turn in turns), 2) if turns else None

    failures = Counter()
    for game in games:
        if game["reason"] in ("search-timeout", "clock", "illegal", "resign"):
            loser = "baseline" if game["winner"] == game["nnueSide"] else "nnue"
            if loser == engine:
                failures[game["reason"]] += 1
    return {
        "turns": len(turns),
        "meanRequestMs": mean("requestMs"),
        "meanReportedMs": mean("reportedMs"),
        "meanWallMs": mean("elapsed"),
        "p95WallMs": round(wall[math.ceil(0.95 * len(wall)) - 1], 2) if wall else None,
        "maxWallMs": round(wall[-1], 2) if wall else None,
        "overRequestedPlus5": sum(turn["elapsed"] > turn["requestMs"] + 5 for turn in turns),
        "overRequestedPlus50": sum(turn["elapsed"] > turn["requestMs"] + 50 for turn in turns),
        "meanNodes": mean("nodes"),
        "meanDepth": mean("depth"),
        "searchTimeouts": failures["search-timeout"],
        "clockFlags": failures["clock"],
        "illegalReplies": failures["illegal"],
        "resignations": failures["resign"],
    }


def detail(games):
    return {
        "games": len(games),
        "outcomes": count_outcomes(games),
        "adaptiveSente": count_outcomes(game for game in games if game["nnueSide"] == 0),
        "adaptiveGote": count_outcomes(game for game in games if game["nnueSide"] == 1),
        "terminations": dict(Counter(game["reason"] for game in games)),
        "engines": {name: timing(games, engine) for engine, name in ENGINES.items()},
    }


def main():
    if len(sys.argv) > 2:
        raise SystemExit("usage: summarize-direct.py [DIRECT-JSONL]")
    raw_path = Path(sys.argv[1]) if len(sys.argv) == 2 else DIRECTORY / "adaptive-direct-100.jsonl"
    config, games, digest = load_campaign(raw_path)
    shared_summary = DIRECTORY.parent.parent / "summarize-obstacle.py"
    shared = json.loads(subprocess.check_output([sys.executable, shared_summary, raw_path], text=True))
    kinds = defaultdict(list)
    stages = defaultdict(list)
    for game in games:
        kinds[game["kind"]].append(game)
        stages[game["kind"], game["stage"]].append(game)
    summary = {
        "inputSha256": digest,
        "config": config,
        "total": detail(games),
        "byKind": {key: detail(rows) for key, rows in sorted(kinds.items())},
        "byKindAndStage": {f"{kind}/{stage}": detail(rows) for (kind, stage), rows in sorted(stages.items())},
        "pairedScore": shared["score"],
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
