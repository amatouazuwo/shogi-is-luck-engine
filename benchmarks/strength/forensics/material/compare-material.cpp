#define main original_reference_main
#include "../../reference/obstacle-reference.cpp"
#undef main

namespace {
constexpr std::array<int, 9> Unit{0,1,3,4,5,6,8,10,0};
int captured(const Position& position, Move move) {
    return Unit[demote(std::abs(position.board[move.to]))];
}
Move findMove(const Position& position, std::string_view text) {
    for (const auto move : legalMoves(position)) if (usi(move) == text) return move;
    throw std::runtime_error("illegal forced root move");
}

struct BoundExhausted {};
struct Evaluation {
    int score;
    std::vector<Move> moves;
    uint64_t nodes;
    int elapsed;
    bool complete;
};

class MaterialTree {
    enum Bound : uint8_t { Unset, Exact, Upper, Lower };
    struct Entry {
        uint64_t key = 0;
        Move move;
        int score = 0;
        int8_t depth = -1;
        Bound bound = Unset;
    };
    static constexpr std::size_t Entries = 1 << 19;
    const uint64_t nodeLimit;
    const std::chrono::seconds timeLimit;
    std::vector<Entry> table{Entries};
    uint64_t nodes = 0;
    Clock::time_point deadline;

    int negamax(const Position& position, int materialForTurn, int remaining, int ply, int alpha, int beta) {
        ++nodes;
        if (nodes >= nodeLimit || ((nodes & 4095) == 0 && Clock::now() >= deadline)) throw BoundExhausted{};
        const int originalAlpha = alpha;
        const auto index = position.key & (Entries - 1);
        const Entry cached = table[index];
        Move likely;
        if (cached.key == position.key && cached.bound != Unset) {
            likely = cached.move;
            if (cached.depth == remaining && (cached.bound == Exact ||
                (cached.bound == Lower && cached.score >= beta) ||
                (cached.bound == Upper && cached.score <= alpha))) return cached.score;
        }
        if (!remaining) {
            const int score = hasLegal(position) ? materialForTurn : -Mate + ply;
            table[index] = {position.key, {}, score, 0, Exact};
            return score;
        }
        MoveList ordered;
        pseudoMoves(position, Generation::All, [&](Move move) {
            const int enemy = captured(position, move);
            const int mover = !move.drop ? Unit[demote(std::abs(position.board[move.from]))] : Unit[move.drop];
            const int estimate = enemy ? 1000 + 40 * enemy - 2 * mover : 0;
            ordered.push(move, move == likely ? 1000000 : estimate + (move.promotion ? 30 : 0));
            return false;
        });
        ordered.sort();
        int best = -Mate + ply;
        Move bestMove;
        for (std::size_t i = 0; i < ordered.size; ++i) {
            const Move move = ordered.entries[i].move;
            const Position next = apply(position, move);
            if (!legalChild(position, move, next)) continue;
            const int score = -negamax(next, -materialForTurn - captured(position, move),
                                       remaining - 1, ply + 1, -beta, -alpha);
            if (score > best || !bestMove) { best = score; bestMove = move; }
            alpha = std::max(alpha, score);
            if (alpha >= beta) break;
        }
        const Bound bound = best <= originalAlpha ? Upper : best >= beta ? Lower : Exact;
        table[index] = {position.key, bestMove, best, static_cast<int8_t>(remaining), bound};
        return best;
    }

    std::vector<Move> line(Position position, int depth, Move first) const {
        std::vector<Move> result{first};
        while (--depth > 0) {
            const auto& e = table[position.key & (Entries - 1)];
            if (e.key != position.key || e.depth != depth || !e.move) break;
            result.push_back(e.move);
            position = apply(position, e.move);
        }
        return result;
    }

public:
    MaterialTree(uint64_t nodeLimit, std::chrono::seconds timeLimit) : nodeLimit(nodeLimit), timeLimit(timeLimit) {}

    Evaluation forced(const Position& position, Move rootMove, int depth) {
        nodes = 0;
        const auto started = Clock::now();
        deadline = started + timeLimit;
        const Position child = apply(position, rootMove);
        Evaluation result{0, {}, 0, 0, false};
        try {
            result.score = -negamax(child, -captured(position, rootMove), depth - 1, 1, -Infinity, Infinity);
            result.complete = true;
            result.moves = line(child, depth, rootMove);
        } catch (const BoundExhausted&) {}
        result.nodes = nodes;
        result.elapsed = static_cast<int>(std::chrono::duration_cast<std::chrono::milliseconds>(Clock::now() - started).count());
        return result;
    }
};
void printMaterial(Evaluation result) {
    std::cout << "{\"complete\":" << (result.complete ? "true" : "false") << ",\"score\":";
    if (result.complete) std::cout << result.score;
    else std::cout << "null";
    std::cout << ",\"nodes\":" << result.nodes << ",\"elapsed_ms\":" << result.elapsed << ",\"pv\":";
    printMoves(result.moves);
    std::cout << '}';
}
}  // namespace

int main() {
    std::ios::sync_with_stdio(false);
    for (std::string line; std::getline(std::cin, line);) {
        const auto words = split(line, '\t');
        try {
            if ((words[0] == "material" || words[0] == "deeper" || words[0] == "defense") && words.size() == 4) {
                const auto p = readPosition(words[1], words[2]);
                const auto forced = findMove(p, words[3]);
                const bool extended = words[0] == "deeper";
                MaterialTree tree(extended ? 20000000 : 3500000, std::chrono::seconds(extended ? 20 : 3));
                const auto levels = words[0] == "defense" ? std::array{2,4,6} : std::array{3,5,7};
                bool first = true;
                std::cout << '{';
                for (const int ply : levels) {
                    if (!first) std::cout << ',';
                    std::cout << '"' << ply << "\":";
                    printMaterial(tree.forced(p, forced, ply));
                    first = false;
                }
                std::cout << '}';
            } else if (words[0] == "reference" && words.size() == 5) {
                const auto p = readPosition(words[2], words[3]);
                const auto move = findMove(p, words[4]);
                Search reference;
                const auto result = reference.run(apply(p, move), parseMilliseconds(words[1]));
                std::cout << "{\"opponent_bestmove\":\"" << usi(result.move)
                          << "\",\"opponent_depth\":" << result.depth << ",\"score\":" << -result.score
                          << ",\"nodes\":" << result.nodes << ",\"elapsed_ms\":" << result.elapsed << '}';
            } else throw std::runtime_error("unsupported command or argument count");
        } catch (const std::exception& error) {
            std::cout << "{\"error\":\"" << error.what() << "\"}";
        }
        std::cout << '\n' << std::flush;
    }
}
