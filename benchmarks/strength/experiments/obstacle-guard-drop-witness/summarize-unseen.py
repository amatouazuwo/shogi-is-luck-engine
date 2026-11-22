"""Summarize paired position runs while live budgets may still be incomplete."""
from collections import Counter, defaultdict
import json
from pathlib import Path
import statistics
import sys

records = []
for line in Path(sys.argv[1]).read_text(encoding='utf-8').splitlines():
    try:
        records.append(json.loads(line))
    except json.JSONDecodeError:
        # A writer may still be on the final line of a live file.
        continue
config = records[0]
engines = [x['name'] for x in config['engines']]
trials = [row for row in records if row['event'] == 'trial']
summary = []
for budget in config['budgets']:
    at_budget = [row for row in trials if row['budget'] == budget]
    if not at_budget:
        continue
    by_key = defaultdict(dict)
    for row in at_budget:
        by_key[(row['round'], row['id'])][row['name']] = row
    common = [records for records in by_key.values() if len(records) == len(engines)]
    at_budget = [row for group in common for row in group.values()]
    for group, pred in [
        ('all', lambda row: True),
        ('attack', lambda row: row['category'].startswith('forced-win')),
        ('defense', lambda row: row['category'].startswith('forced-loss-escape')),
    ]:
        variants = {}
        pairs = []
        for name in engines:
            group_rows = [row for row in at_budget if row['name'] == name and pred(row)]
            guards = [row['guard'] for row in group_rows if row.get('guard')]
            variants[name] = {
                'positions': len(group_rows),
                'correct': sum(row['correct'] for row in group_rows),
                'illegal': sum(not row['legal'] for row in group_rows),
                'meanDepth': round(statistics.mean(row['depth'] for row in group_rows), 3) if group_rows else None,
                'meanWallMs': round(statistics.mean(row['elapsed'] for row in group_rows), 3) if group_rows else None,
                'overBudget50': sum(row['elapsed'] > budget + 50 for row in group_rows),
                'guardStatuses': dict(Counter(x['status'] for x in guards)),
                'witnessLeaves': sum(x.get('drop_witness_leaves', 0) for x in guards),
                'exactSafetyNodes': sum(x.get('exact_safety_nodes', 0) for x in guards),
            }
            if name == 'baseline':
                continue
            gains = []
            losses = []
            for rows in common:
                baseline, candidate = rows['baseline'], rows[name]
                if not pred(candidate):
                    continue
                if candidate['correct'] and not baseline['correct']:
                    gains.append(candidate['id'])
                if baseline['correct'] and not candidate['correct']:
                    losses.append(candidate['id'])
            pairs.append({'candidate': name, 'pairedGains': gains, 'pairedLosses': losses})
        summary.append({'budget': budget, 'group': group, 'engines': variants, 'paired': pairs})
print(json.dumps(summary, indent=2))
