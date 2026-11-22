"""Score the frozen reserve-pressure A/B and keep attack and defense strata."""
import json
import statistics
import sys
from collections import defaultdict
from pathlib import Path


def read_jsonl(file):
    return [json.loads(line) for line in Path(file).read_text().splitlines() if line]


def group(category):
    if category.startswith("forced-win-"):
        return "attack"
    if category.startswith("forced-loss-escape-"):
        return "defense"
    raise ValueError(f"unexpected scored category {category}")


def mean(rows, field):
    values = [row[field] for row in rows if isinstance(row.get(field), (int, float))]
    return statistics.mean(values) if values else None


def metrics(rows):
    return {
        "positions": len(rows),
        "correct": sum(row.get("correct") is True for row in rows),
        "illegal": sum(row.get("legal") is False for row in rows),
        "responseTimeouts": sum(row.get("timeout") is True for row in rows),
        "otherErrors": sum(bool(row.get("error")) and not row.get("timeout") for row in rows),
        "overBudget50ms": sum(row.get("overBudget50") is True for row in rows),
        "meanDepth": mean(rows, "depth"),
        "meanNodes": mean(rows, "nodes"),
        "meanWallMs": mean(rows, "wallMs"),
        "meanWorkerMs": mean(rows, "workerMs"),
    }


entries = read_jsonl(sys.argv[1])
config = entries[0]
assert config["event"] == "config"
assert [engine["name"] for engine in config["sdk"]] == ["baseline", "reserve"]
expected_total = config["positions"] * config["rounds"] * len(config["budgets"]) * 2
raw_trials = [row for row in entries if row["event"] == "trial"]
assert len(raw_trials) == expected_total, (len(raw_trials), expected_total)
groups = defaultdict(dict)
for row in raw_trials:
    key = (row["budget"], group(row["category"]), row["round"], row["id"])
    assert row["name"] not in groups[key], key
    groups[key][row["name"]] = row
assert all(set(rows) == {"baseline", "reserve"} for rows in groups.values())

result = []
decisions = []
for budget in config["budgets"]:
    for subgroup in ("attack", "defense", "all"):
        pairs = [
            pair for (trial_budget, trial_group, _, _), pair in groups.items()
            if trial_budget == budget and (trial_group == subgroup or subgroup == "all")
        ]
        baseline = [pair["baseline"] for pair in pairs]
        reserve = [pair["reserve"] for pair in pairs]
        result.append({
            "budgetMs": budget,
            "group": subgroup,
            "baseline": metrics(baseline),
            "reserve": metrics(reserve),
            "pairedImprovements": sum(not a["correct"] and b["correct"] for a, b in zip(baseline, reserve)),
            "pairedRegressions": sum(a["correct"] and not b["correct"] for a, b in zip(baseline, reserve)),
        })
        if subgroup == "all":
            for a, b in zip(baseline, reserve):
                if a["correct"] != b["correct"]:
                    decisions.append({
                        "id": a["id"],
                        "budgetMs": budget,
                        "group": group(a["category"]),
                        "baseline": {"move": a.get("move"), "correct": a["correct"]},
                        "reserve": {"move": b.get("move"), "correct": b["correct"]},
                    })
print(json.dumps({
    "corpusSha256": config["corpusSha256"],
    "trials": len(raw_trials),
    "results": result,
    "decisions": decisions,
}, indent=2))
