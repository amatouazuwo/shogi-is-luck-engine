#define main reference_cli_main
#include "../../reference/obstacle-reference.cpp"
#undef main

#include <unordered_map>

namespace {
constexpr std::array<int,15> Material = {
    0, 100, 300, 400, 500, 600, 800, 1000, 0, 600, 600, 600, 600, 1100, 1300,
};

int netMaterial(const Position& p) {
    int result = 0;
    for (int piece : p.board) {
        if (piece == Empty || piece == Wall) continue;
        result += sign(sideOf(piece)) * Material[std::abs(piece)];
    }
    for (int side : {Black, White}) {
        for (int kind = Pawn; kind <= Rook; ++kind) {
            result += sign(side) * p.hands[side][kind] * Material[kind];
        }
    }
    return result;
}

unsigned moveOrder(const Position& p, Move m) {
    const int taken = std::abs(p.board[m.to]);
    return Material[taken] * 4 + (m.promotion ? 1 : 0);
}

struct DeadlineExceeded {};
struct Line {
    int value;
    std::vector<Move> moves;
};

class Oracle {
    Clock::time_point deadline;
    std::unordered_map<uint64_t, bool> mates;

    void checkTime() {
        if ((++nodes & 1023) == 0 && Clock::now() >= deadline) throw DeadlineExceeded{};
    }

public:
    uint64_t nodes = 0;
    explicit Oracle(int ms) : deadline(Clock::now() + std::chrono::milliseconds(ms)) {}

    // The attacker must give check at every attacking node; defenders may play
    // every legal reply. At the leaf, no-legal without check is a separate rule.
    bool forceMate(const Position& p, int attacker, unsigned remaining) {
        checkTime();
        const bool check = attacked(p, p.king[p.turn], 1 - p.turn);
        if (p.turn != attacker && !check) return false;
        if (p.turn == attacker && !remaining) return false;
        const auto raw = p.key ^ ((remaining + 1) * 0xd6e8feb86659fd93ULL);
        if (auto it = mates.find(raw); it != mates.end()) return it->second;
        if (!hasLegal(p)) {
            const bool yes = p.turn != attacker && check;
            mates.emplace(raw, yes);
            return yes;
        }
        if (!remaining) return false;
        if (p.turn == attacker) {
            for (Move m : legalMoves(p)) {
                const auto next = apply(p, m);
                if (attacked(next, next.king[next.turn], attacker) && forceMate(next, attacker, remaining - 1)) {
                    mates.emplace(raw, true);
                    return true;
                }
            }
            mates.emplace(raw, false);
            return false;
        }
        for (Move m : legalMoves(p)) {
            if (!forceMate(apply(p, m), attacker, remaining - 1)) {
                mates.emplace(raw, false);
                return false;
            }
        }
        mates.emplace(raw, true);
        return true;
    }

    Line material(const Position& p, unsigned remaining, int alpha, int beta) {
        checkTime();
        if (!hasLegal(p)) return {-Mate - static_cast<int>(remaining), {}};
        if (!remaining) return {sign(p.turn) * netMaterial(p), {}};
        auto moves = legalMoves(p);
        std::stable_sort(moves.begin(), moves.end(), [&](Move a, Move b) {
            return moveOrder(p, a) > moveOrder(p, b);
        });
        Line best{-Infinity, {}};
        for (Move m : moves) {
            auto child = material(apply(p, m), remaining - 1, -beta, -alpha);
            const int value = -child.value;
            if (value > best.value) {
                best = {value, {m}};
                best.moves.insert(best.moves.end(), child.moves.begin(), child.moves.end());
            }
            alpha = std::max(alpha, best.value);
            if (alpha >= beta) break;
        }
        return best;
    }
};
} // namespace

int main() {
    for (std::string input; std::getline(std::cin, input);) {
        try {
            auto fields = split(input, '\t');
            if (fields.size() != 3) throw std::runtime_error("Expected SFEN, mask and forced move");
            const Position start = readPosition(fields[0], fields[1]);
            const auto legal = legalMoves(start);
            const auto match = std::find_if(legal.begin(), legal.end(), [&](Move m) { return usi(m) == fields[2]; });
            if (match == legal.end()) throw std::runtime_error("Forced root move is illegal");
            const auto child = apply(start, *match);
            const auto replies = legalMoves(child);
            std::cout << "{\"move\":\"" << usi(*match) << "\",\"check\":"
                      << (attacked(child, child.king[child.turn], start.turn) ? "true" : "false")
                      << ",\"enemyReplies\":" << replies.size()
                      << ",\"rootMaterialGain\":" << sign(start.turn) * (netMaterial(child) - netMaterial(start));
            const auto emitProof = [&](const char* field, int side, unsigned remainder) {
                std::cout << ",\"" << field << "\":";
                Oracle oracle(2500);
                try {
                    std::cout << (oracle.forceMate(child, side, remainder) ? "true" : "false");
                } catch (const DeadlineExceeded&) {
                    std::cout << "null";
                }
                std::cout << ",\"" << field << "Nodes\":" << oracle.nodes;
            };
            emitProof("attackerContinuousMate7", start.turn, 6);
            emitProof("defenderContinuousMate5", child.turn, 5);
            std::cout << ",\"material\":[";
            for (unsigned plies : {3U, 5U, 7U}) {
                if (plies != 3) std::cout << ',';
                Oracle oracle(2400);
                std::cout << "{\"plies\":" << plies;
                try {
                    const auto line = oracle.material(child, plies - 1, -Infinity, Infinity);
                    std::cout << ",\"value\":" << -line.value
                              << ",\"delta\":" << -line.value - sign(start.turn) * netMaterial(start)
                              << ",\"pv\":";
                    auto full = std::vector<Move>{*match};
                    full.insert(full.end(), line.moves.begin(), line.moves.end());
                    printMoves(full);
                } catch (const DeadlineExceeded&) {
                    std::cout << ",\"timeout\":true";
                }
                std::cout << ",\"nodes\":" << oracle.nodes << '}';
            }
            std::cout << "]}" << std::endl;
        } catch (const std::exception& error) {
            std::cout << "{\"error\":\"" << error.what() << "\"}" << std::endl;
        }
    }
}
