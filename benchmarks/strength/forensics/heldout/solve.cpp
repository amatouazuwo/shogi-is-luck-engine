#define main original_reference_main
#include "../../reference/obstacle-reference.cpp"
#undef main
#include <limits>

namespace {
struct SearchLimit {};
class ForcingSolver {
    struct Entry {
        uint64_t key = 0;
        uint32_t generation = 0;
        int8_t minWin = 127;
        int8_t maxFailure = -1;
    };
    static constexpr std::size_t TableSize = 1 << 18;
    std::vector<Entry> table{TableSize};
    uint64_t limit = 0;
    uint32_t generation = 0;
    int attacker = Black;
    bool onlyChecks = false;

    int order(const Position& p, Move move) const {
        const int captured = std::abs(p.board[move.to]);
        const int moving = move.drop ? move.drop : std::abs(p.board[move.from]);
        const int distance = chebyshev(move.to, p.king[1 - attacker]);
        if (p.turn == attacker) {
            return 10 * Value[captured] + (move.promotion ? 1200 : 0) - 300 * distance
                   - (moving == King ? 1400 : 0);
        }
        return 20 * Value[captured] + (moving == King ? 2200 : 0) - (move.drop ? 500 : 0);
    }
    void remember(const Position& p, int remaining, bool win) {
        Entry& entry = table[p.key & (TableSize - 1)];
        if (entry.generation != generation || entry.key != p.key)
            entry = {p.key, generation, 127, -1};
        if (win) entry.minWin = std::min<int>(remaining, entry.minWin);
        else entry.maxFailure = std::max<int>(remaining, entry.maxFailure);
    }

public:
    uint64_t nodes = 0;
    void configure(int forcingSide, bool checking, uint64_t maxNodes) {
        attacker = forcingSide;
        onlyChecks = checking;
        limit = maxNodes;
        nodes = 0;
        ++generation;
    }
    bool canWin(const Position& p, int remaining) {
        if (++nodes > limit) throw SearchLimit{};
        const Entry entry = table[p.key & (TableSize - 1)];
        if (entry.generation == generation && entry.key == p.key) {
            if (remaining >= entry.minWin) return true;
            if (remaining <= entry.maxFailure) return false;
        }

        const bool attacking = p.turn == attacker;
        if (remaining <= 0) {
            const bool value = !attacking && !hasLegal(p);
            remember(p, remaining, value);
            return value;
        }
        MoveList moves;
        pseudoMoves(p, Generation::All, [&](Move move) {
            moves.push(move, order(p, move));
            return false;
        });
        moves.sort();
        for (std::size_t i = 0; i < moves.size; ++i) {
            const Move move = moves.entries[i].move;
            const auto next = apply(p, move);
            if (!legalChild(p, move, next)) continue;
            if (onlyChecks && attacking && !attacked(next, next.king[next.turn], p.turn)) continue;
            const bool result = canWin(next, remaining - 1);
            if (result == attacking) {
                remember(p, remaining, result);
                return result;
            }
        }
        const bool result = !attacking;
        remember(p, remaining, result);
        return result;
    }
    std::vector<Move> winMoves(const Position& p, const std::vector<Move>& root, int depth) {
        std::vector<Move> good;
        for (const Move move : root) {
            if (canWin(apply(p, move), depth - 1)) good.push_back(move);
        }
        return good;
    }
};

void describe(const char* status, uint64_t nodes) {
    std::cout << "{\"status\":\"" << status << "\",\"nodes\":" << nodes << '}';
}
void printAttack(const Position& p, int upper, ForcingSolver& solver) {
    const auto root = legalMoves(p);
    solver.configure(p.turn, false, 4500000);
    std::vector<uint64_t> depthNodes;
    for (int depth = 1; depth <= upper; depth += 2) {
        const auto winners = solver.winMoves(p, root, depth);
        depthNodes.push_back(solver.nodes);
        if (winners.empty()) continue;
        std::cout << "{\"status\":\"ok\",\"kind\":\"attack\",\"depth\":" << depth
                  << ",\"nodes\":" << solver.nodes << ",\"available\":";
        printMoves(root);
        std::cout << ",\"goodMoves\":";
        printMoves(winners);
        std::cout << ",\"nodesByHorizon\":[";
        for (std::size_t i = 0; i < depthNodes.size(); ++i) {
            if (i) std::cout << ',';
            std::cout << depthNodes[i];
        }
        std::cout << "]}";
        return;
    }
    describe("none", solver.nodes);
}
void printEscape(const Position& p, int horizon, ForcingSolver& solver) {
    const auto root = legalMoves(p);
    if (root.size() < 2 || root.size() > 20) {
        describe("none", 0);
        return;
    }
    solver.configure(1 - p.turn, false, 4500000);
    std::vector<Move> safe;
    std::vector<std::pair<Move, int>> loseBy;
    bool hasDeepThreat = false;
    for (const Move move : root) {
        const auto after = apply(p, move);
        if (!solver.canWin(after, horizon)) {
            safe.push_back(move);
            continue;
        }
        for (int depth = 1; depth <= horizon; depth += 2) {
            if (!solver.canWin(after, depth)) continue;
            if (depth == horizon) hasDeepThreat = true;
            loseBy.emplace_back(move, depth);
            break;
        }
    }
    if (safe.empty() || !hasDeepThreat || 5 * safe.size() > 4 * root.size()) {
        describe("none", solver.nodes);
        return;
    }
    std::cout << "{\"status\":\"ok\",\"kind\":\"escape\",\"depth\":" << horizon
              << ",\"nodes\":" << solver.nodes << ",\"available\":";
    printMoves(root);
    std::cout << ",\"goodMoves\":";
    printMoves(safe);
    std::cout << ",\"lossPliesAfterDefense\":{";
    for (std::size_t i = 0; i < loseBy.size(); ++i) {
        if (i) std::cout << ',';
        std::cout << '"' << usi(loseBy[i].first) << "\":" << loseBy[i].second;
    }
    std::cout << "}}";
}
}  // namespace

int main() {
    std::ios::sync_with_stdio(false);
    ForcingSolver solver;
    for (std::string line; std::getline(std::cin, line);) {
        const auto fields = split(line, '\t');
        try {
            if (fields.size() != 4) throw std::runtime_error("expected four fields");
            const auto p = readPosition(fields[1], fields[2]);
            const int depth = parseMilliseconds(fields[3]);
            if (depth != 1 && depth != 3 && depth != 5 && depth != 7)
                throw std::runtime_error("expected horizon 1, 3, 5 or 7");
            if (fields[0] == "sample") {
                solver.configure(p.turn, true, 35000);
                if (solver.canWin(p, 1)) describe("one", solver.nodes);
                else {
                    int result = 0;
                    for (int horizon = 3; horizon <= depth; horizon += 2) {
                        if (solver.canWin(p, horizon)) { result = horizon; break; }
                    }
                    std::cout << "{\"status\":\"" << (result ? "found" : "none") << "\",\"depth\":" << result << ",\"nodes\":" << solver.nodes << '}';
                }
            } else if (fields[0] == "attack") {
                printAttack(p, depth, solver);
            } else if (fields[0] == "escape") {
                printEscape(p, depth, solver);
            } else {
                throw std::runtime_error("unknown command");
            }
        } catch (const SearchLimit&) {
            describe("limit", solver.nodes);
        } catch (const std::exception&) {
            describe("invalid", solver.nodes);
        }
        std::cout << '\n' << std::flush;
    }
    return 0;
}
