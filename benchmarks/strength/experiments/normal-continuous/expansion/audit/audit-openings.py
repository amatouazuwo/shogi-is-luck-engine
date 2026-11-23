"""Audit frozen normal-shogi opening sets and completed side-swapped pairs."""
import argparse
from collections import Counter, defaultdict
import hashlib
import itertools
import json
import math
from pathlib import Path
import re
from statistics import mean


def read_rows(path):
    for line_number, line in enumerate(path.read_text().splitlines(), 1):
        if line.strip():
            try:
                yield json.loads(line)
            except ValueError as error:
                raise ValueError(f"{path.name}:{line_number}: malformed JSON") from error


def parse_sfen(sfen):
    rows, turn, hand, *time = sfen.split()
    if turn not in {"b", "w"} or len(time) > 1:
        raise ValueError(f"Bad SFEN: {sfen}")
    board = []
    for row in rows.split("/"):
        tokens = re.findall(r"(?:\+?[PLNSGBRKplnsgbrk]|[1-9])", row)
        if "".join(tokens) != row:
            raise ValueError(f"Bad SFEN rank: {row}")
        cells = [cell for token in tokens for cell in (["."] * int(token) if token.isdigit() else [token])]
        if len(cells) != 9:
            raise ValueError(f"Bad SFEN rank width: {row}")
        board.append(cells)
    if len(board) != 9:
        raise ValueError(f"Bad SFEN board width: {sfen}")
    tokens = re.findall(r"([0-9]*)([PLNSGBRplnsgbr])", hand)
    if hand != "-" and "".join(number + piece for number, piece in tokens) != hand:
        raise ValueError(f"Bad SFEN hands: {sfen}")
    pieces = Counter()
    for number, piece in tokens:
        pieces[piece] += int(number or 1)
    return board, turn, pieces, int(time[0]) if time else 1


def fingerprint(sfen, equivalence):
    board, turn, hands, _ = parse_sfen(sfen)
    choices = itertools.product([False, True], repeat=2) if equivalence else [(False, False)]
    variants = []
    for reflect_files, exchange_colors in choices:
        ranks = reversed(board) if exchange_colors else board
        squares = [
            piece.swapcase() if exchange_colors else piece
            for rank in ranks
            for piece in (reversed(rank) if reflect_files != exchange_colors else rank)
        ]
        mover = ("w" if turn == "b" else "b") if exchange_colors else turn
        holdings = sorted((piece.swapcase() if exchange_colors else piece, count) for piece, count in hands.items())
        variants.append((tuple(squares), mover, tuple(holdings)))
    return min(variants)


def position_text(row):
    direct = row.get("sfen") or row.get("opening") or row.get("start")
    if isinstance(direct, dict):
        return direct.get("sfen") if not direct.get("holes") else None
    return direct if isinstance(direct, str) and not row.get("holes") else None


def opening_key(row):
    level = row.get("level", row.get("budget"))
    return int(level), row["family"], int(row["pair"])


def source_digest(path):
    return {"file": path.name, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}


def group_positions(rows, equivalent):
    groups = defaultdict(list)
    for name, sfen in rows:
        groups[fingerprint(sfen, equivalent)].append(name)
    return groups


def parse_matches(paths, preview):
    expected = {key: sfen for key, sfen, _ in preview}
    groups = defaultdict(dict)
    identity = defaultdict(set)
    for path in paths:
        rows = list(read_rows(path))
        config = next(row for row in rows if row.get("event") == "config")
        signature = tuple(config.get(name) for name in (
            "opponent", "referenceNodes", "sharedNodes", "rulesSha",
            "wasmSha", "candidateWorkerSha", "officialWorkerSha", "plyCap",
            "gameCommit", "indexSha", "positionSha",
        ))
        announced = {}
        for row in rows:
            event = row.get("event")
            if event not in {"game-start", "game"}:
                continue
            key = opening_key(row)
            side = row.get("candidateSide", row.get("side"))
            identity[key[0]].add(signature)
            if side not in [0, 1] or (expected and key not in expected):
                raise ValueError(f"{path.name}: unexpected seat or opening {key}/{side}")
            sfen = position_text(row)
            if expected and sfen != expected[key]:
                raise ValueError(f"{path.name}: opening changed from the frozen list for {key}")
            if event == "game-start":
                if (key, side) in announced:
                    raise ValueError(f"{path.name}: repeated game-start for {key}/{side}")
                announced[key, side] = sfen
                continue
            if announced.get((key, side)) != sfen:
                raise ValueError(f"{path.name}: finished game differs from its announcement for {key}/{side}")
            if side in groups[key]:
                raise ValueError(f"{path.name}: duplicate finished game for {key}/{side}")
            groups[key][side] = row
    if any(len(signatures)>1 for signatures in identity.values()):
        raise ValueError("Match files mix engine identities, opponents, node controls, or ply caps at one level")
    for key, pair in groups.items():
        if len(pair) == 2 and position_text(pair[0]) != position_text(pair[1]):
            raise ValueError(f"Pair sides use different openings: {key}")
    return groups


def pair_score(pair):
    low, high = 0, 0
    counts = Counter()
    for side, game in pair.items():
        winner = game["winner"]
        if game["reason"] == "ply-cap":
            if winner is not None:
                raise ValueError("Capped game reports a winner")
            counts["capped"] += 1
            high += 1
        elif winner == side:
            counts["wins"] += 1
            low += 1
            high += 1
        elif winner in [0, 1]:
            counts["losses"] += 1
        elif winner is None:
            counts["draws"] += 1
            low += 0.5
            high += 0.5
        else:
            raise ValueError(f"Unsupported winner: {winner}")
    return low / 2, high / 2, counts


def round_pct(value):
    return math.floor(min(1, max(0, value)) * 10000 + 0.5) / 100


def summarize(keys, pairs):
    closed = {key: pair_score(pairs[key]) for key in keys if len(pairs.get(key, {})) == 2}
    partial = [list(key) for key in keys if len(pairs.get(key, {})) == 1]
    without_completed = [list(key) for key in keys if not pairs.get(key)]
    if not closed:
        return {"completedPairs": 0, "partial": partial, "withoutCompletedGames": without_completed}
    scores = list(closed.values())
    count = sum((row[2] for row in scores), Counter())
    lower = mean(row[0] for row in scores)
    upper = mean(row[1] for row in scores)
    radius = math.sqrt(math.log(40) / (2 * len(scores)))
    directions = Counter(
        "positive" if lo > .5 else "negative" if hi < .5 else
        "equal" if lo == hi == .5 else "censored"
        for lo, hi, _ in scores
    )
    blocks = defaultdict(list)
    for (_, _, pair_index), (lo, hi, _) in closed.items():
        blocks[pair_index].append((lo, hi))
    block_lower = mean(mean(lo for lo, _ in group) for group in blocks.values())
    block_upper = mean(mean(hi for _, hi in group) for group in blocks.values())
    block_radius = math.sqrt(math.log(40) / (2 * len(blocks)))
    return {
        "completedPairs": len(closed), "partial": partial, "withoutCompletedGames": without_completed,
        "outcomes": {key: count[key] for key in ("wins", "losses", "draws", "capped")},
        "directions": dict(directions),
        "observedPct": [round_pct(lower), round_pct(upper)],
        "illustrativePaired95Pct": [round_pct(lower-radius), round_pct(upper+radius)],
        "indexBlockSensitivity": {
            "blocks": len(blocks),
            "observedPct": [round_pct(block_lower), round_pct(block_upper)],
            "illustrative95Pct": [round_pct(block_lower-block_radius), round_pct(block_upper+block_radius)],
        },
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--preview", type=Path, nargs="+", default=[])
    parser.add_argument("--prior", type=Path, nargs="+", default=[])
    parser.add_argument("--matches", type=Path, nargs="+", default=[])
    args = parser.parse_args()
    if not (args.preview or args.matches):
        parser.error("pass --preview or --matches")

    preview = []
    for path in args.preview:
        for row in read_rows(path):
            sfen = position_text(row)
            if sfen:
                preview.append((opening_key(row), sfen, row.get("seed")))
    keys = [key for key, _, _ in preview]
    if len(keys) != len(set(keys)) or (args.preview and not keys):
        raise ValueError("A frozen preview has duplicate keys or no openings")

    previous = []
    for path in args.prior:
        for row in read_rows(path):
            sfen = position_text(row)
            if sfen:
                label = f"{path.name}:{row.get('family',row.get('kind','case'))}/{row.get('pair',row.get('id','position'))}"
                previous.append((label, sfen))
            for pos in row.get("positions", []) if isinstance(row.get("positions"), list) else []:
                if isinstance(pos, dict) and pos.get("sfen") and not pos.get("holes"):
                    previous.append((f"{path.name}:{pos.get('name','position')}", pos["sfen"]))
    candidate = [(f"{level}/{family}/{pair}", sfen) for (level, family, pair), sfen, _ in preview]
    prior_exact = group_positions(previous, False)
    prior_canonical = group_positions(previous, True)
    novelty = {}
    for label, equivalence, prior in (("exact", False, prior_exact), ("canonical", True, prior_canonical)):
        groups = group_positions(candidate, equivalence)
        novelty[label] = {
            "priorDistinct": len(prior),
            "previewDistinct": len(groups),
            "duplicatePreview": [names for names in groups.values() if len(names) > 1],
            "previousOverlap": [{"preview": names, "previous": sorted(set(prior[key]))}
                                for key, names in groups.items() if key in prior],
        }

    profiles = []
    level_family = defaultdict(list)
    for ((level, family, _), sfen, _) in preview:
        level_family[level, family].append(parse_sfen(sfen))
    for (level, family), states in sorted(level_family.items()):
        profiles.append({
            "level": level, "family": family, "positions": len(states),
            "turns": dict(Counter(state[1] for state in states)),
            "startPlies": sorted(state[3]-1 for state in states),
            "boardPieces": sorted(sum(piece != "." for rank in state[0] for piece in rank) for state in states),
            "heldPieces": sorted(sum(state[2].values()) for state in states),
        })
    result = {
        "scope": "Normal-shogi SFEN, ignoring move number for novelty. Canonical form includes mirrored files and 180-degree color exchange.",
        "previewFiles": [source_digest(path) for path in args.preview],
        "priorFiles": [source_digest(path) for path in args.prior],
        "matchFiles": [source_digest(path) for path in args.matches],
        "previewCount": len(preview),
        "novelty": novelty,
        "profiles": profiles,
    }
    if args.matches:
        matches = parse_matches(args.matches, preview)
        expected = keys or sorted(matches)
        by_level = {}
        for level in sorted({key[0] for key in expected}):
            subset = [key for key in expected if key[0] == level]
            by_level[level] = {
                "pooled": summarize(subset, matches),
                "family": {family: summarize([key for key in subset if key[1] == family], matches)
                           for family in sorted({key[1] for key in subset})},
            }
        result["matchSummary"] = by_level
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if any(group["duplicatePreview"] or group["previousOverlap"] for group in novelty.values()):
        raise SystemExit(2)


if __name__ == "__main__":
    main()
