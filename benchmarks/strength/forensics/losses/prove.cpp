#define main reference_main
#include "../../reference/obstacle-reference.cpp"
#undef main
#include <unordered_map>

namespace {
bool same(const Position& lhs, const Position& rhs) {
    return lhs.key == rhs.key && lhs.board == rhs.board && lhs.hands == rhs.hands && lhs.turn == rhs.turn;
}

struct Proof {
    std::vector<Move> line;
};

struct Forcer {
    struct MemoEntry { Position board{}; int depth = -1; bool result = false; };
    int attacker;
    std::unordered_map<uint64_t, std::vector<Position>> old;
    std::vector<Position> line;
    std::vector<MemoEntry> memo;
    bool repetitionPossible = true;
    uint64_t nodes = 0;

    bool repetition(const Position& position) const {
        int seen = 0;
        if (auto iter = old.find(position.key); iter != old.end()) {
            for (const auto& p : iter->second) if (same(p, position)) ++seen;
        }
        for (const auto& p : line) if (same(p, position)) ++seen;
        return seen >= 4;
    }

    bool force(const Position& position, int moves, Proof* proof) {
        ++nodes;
        if (!repetitionPossible) {
            if (proof || moves < 1) return forceCurrent(position, moves, proof);
            auto& entry = memo[(position.key ^ (static_cast<uint64_t>(moves) * 0x9e3779b97f4a7c15ULL)) & (memo.size() - 1)];
            if (entry.depth == moves && same(entry.board, position)) return entry.result;
            const auto result = forceCurrent(position, moves, nullptr);
            entry = {position, moves, result};
            return result;
        }
        line.push_back(position);
        if (repetition(position)) { line.pop_back(); return false; }
        const bool win = forceCurrent(position, moves, proof);
        line.pop_back();
        return win;
    }

    bool forceCurrent(const Position& position, int moves, Proof* proof) {
        if (!moves) return position.turn != attacker && !hasLegal(position);
        if (position.turn == attacker) {
            const auto legal = legalMoves(position);
            for (bool givesCheck : {true, false}) for (auto turn : legal) {
                auto child = apply(position, turn);
                if (attacked(child, child.king[child.turn], position.turn) != givesCheck) continue;
                Proof branch;
                if (force(child, moves - 1, proof ? &branch : nullptr)) {
                    if (proof) {
                        proof->line = {turn};
                        proof->line.insert(proof->line.end(), branch.line.begin(), branch.line.end());
                    }
                    return true;
                }
            }
            return false;
        }

        bool escaped = pseudoMoves(position, Generation::All, [&](Move turn) {
            auto child = apply(position, turn);
            if (!legalChild(position, turn, child)) return false;
            Proof branch;
            if (!force(child, moves - 1, proof ? &branch : nullptr)) return true;
            if (proof && branch.line.size() + 1 > proof->line.size()) {
                proof->line = {turn};
                proof->line.insert(proof->line.end(), branch.line.begin(), branch.line.end());
            }
            return false;
        });
        return !escaped;
    }
};

int parseBound(const char* text) {
    const int n = std::stoi(text);
    if (n < 1 || n % 2 == 0) throw std::runtime_error("odd positive ply bound required");
    return n;
}
}

int main(int argc, char** argv) {
    const int limit = argc > 1 ? parseBound(argv[1]) : 3;
    const int maxAlternatives = argc > 2 ? std::stoi(argv[2]) : 0;
    for (std::string request; std::getline(std::cin, request);) {
        const auto f = split(request, '\t');
        if (f.size() != 5) throw std::runtime_error("expected five fields");
        const auto position = readPosition(f[1], f[2]);
        Forcer forcer{1-position.turn};
        for (auto sfen : split(f[4], '|')) if (!sfen.empty()) {
            const auto past = readPosition(sfen, f[2]);
            forcer.old[past.key].push_back(past);
        }
        int oldMax = 0;
        for (const auto& [key,positions] : forcer.old) oldMax = std::max(oldMax,static_cast<int>(positions.size()));
        // An exact state cannot return in two plies. Old history is excluded
        // from memoization only when even repetitions every four plies cannot
        // combine with the recorded visits to produce a draw.
        forcer.repetitionPossible = oldMax + 1 + (limit + 1) / 4 >= 4;
        if (!forcer.repetitionPossible) forcer.memo.resize(1 << 16);
        forcer.line.push_back(position);
        const auto legal = legalMoves(position);
        const auto find = std::find_if(legal.begin(), legal.end(), [&](Move m) { return usi(m) == f[3]; });
        if (find == legal.end()) throw std::runtime_error("played move not legal");
        const auto child = apply(position, *find);
        int distance = 0;
        Proof example;
        for (int n = 1; n <= limit; n += 2) {
            Proof attempt;
            if (forcer.force(child, n, &attempt)) {
                distance = n;
                example = std::move(attempt);
                break;
            }
        }
        std::cout << "{\"id\":\"" << f[0] << "\",\"distance\":" << distance << ",\"legal\":" << legal.size();
        if (distance) {
            std::vector<Move> safeAtDistance;
            std::vector<Move> safeAtLimit;
            bool fullAlternatives = true;
            for (auto m : legal) if (!(m == *find)) {
                const auto alt = apply(position, m);
                if (!forcer.force(alt, distance, nullptr)) {
                    safeAtDistance.push_back(m);
                    if (distance == limit || !forcer.force(alt, limit, nullptr)) safeAtLimit.push_back(m);
                    if (maxAlternatives > 0 && static_cast<int>(safeAtLimit.size()) >= maxAlternatives) {
                        fullAlternatives = false;
                        break;
                    }
                }
            }
            std::cout << ",\"line\":";
            printMoves(example.line);
            std::cout << ",\"safeAtDistance\":";
            printMoves(safeAtDistance);
            std::cout << ",\"safeAtLimit\":";
            printMoves(safeAtLimit);
            std::cout << ",\"fullAlternatives\":" << (fullAlternatives ? "true" : "false");
            Position end = child;
            for (const auto m : example.line) end = apply(end, m);
            std::cout << ",\"terminal\":\"" << (attacked(end,end.king[end.turn],1-end.turn) ? "mate" : "no-legal") << '"';
        }
        std::cout << ",\"nodes\":" << forcer.nodes << "}\n" << std::flush;
    }
}
