#include <algorithm>
#include <array>
#include <charconv>
#include <chrono>
#include <cstdint>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

namespace {
constexpr int Stride = 13;
constexpr int BoardSize = Stride * Stride;
constexpr int Empty = 0;
constexpr int Wall = 100;
constexpr int NoSquare = 0;
constexpr int Mate = 30000;
constexpr int Infinity = 32000;
constexpr int MaxPly = 96;
constexpr int Black = 0;
constexpr int White = 1;
enum Piece { Pawn = 1, Lance, Knight, Silver, Gold, Bishop, Rook, King,
             Tokin, PromotedLance, PromotedKnight, PromotedSilver, Horse, Dragon };
constexpr std::array<int, 15> Value = {0, 100, 288, 322, 451, 532, 796, 955, 0,
                                       548, 542, 550, 555, 1088, 1295};
constexpr std::array<int, 8> HandValue = {0, 116, 330, 365, 490, 576, 860, 1030};
constexpr std::array<int, 8> Rays = {-Stride, Stride, -1, 1, -Stride - 1,
                                     -Stride + 1, Stride - 1, Stride + 1};
constexpr int row(int square) { return square / Stride - 2; }
constexpr int col(int square) { return square % Stride - 2; }
constexpr int squareAt(int rank, int file) { return (rank + 2) * Stride + file + 2; }
constexpr int sign(int side) { return side == Black ? 1 : -1; }
constexpr int forward(int side) { return side == Black ? -Stride : Stride; }
constexpr int sideOf(int piece) { return piece > 0 ? Black : White; }
constexpr int promotionRank(int side, int square) { return side == Black ? row(square) : 8 - row(square); }
constexpr bool canPromote(int kind) { return kind < Gold || kind == Bishop || kind == Rook; }
constexpr bool goldLike(int kind) { return kind == Gold || (kind >= Tokin && kind <= PromotedSilver); }
constexpr int promote(int kind) { return kind >= Bishop ? kind + 7 : kind + 8; }
constexpr int demote(int kind) { return kind >= Horse ? kind - 7 : kind >= Tokin ? kind - 8 : kind; }
constexpr bool deadAt(int side, int kind, int square) {
    const int rank = promotionRank(side, square);
    return ((kind == Pawn || kind == Lance) && rank == 0) || (kind == Knight && rank < 2);
}

constexpr int pieceSquareValue(int side, int kind, int square) {
    const int advance = 8 - promotionRank(side, square);
    const int center = 4 - std::abs(col(square) - 4);
    if (kind == King) return 14 - 4 * advance - 3 * center;
    if (kind == Pawn) return Value[kind] + 4 * advance + 2 * center;
    if (kind == Lance) return Value[kind] + 2 * advance - center;
    if (kind == Knight || kind == Silver) return Value[kind] + 4 * advance + 4 * center;
    if (kind == Gold) return Value[kind] + 2 * advance + 3 * center;
    return Value[kind] + 3 * advance + 4 * center;
}

struct Move {
    uint8_t from = 0, to = 0, drop = 0;
    bool promotion = false;
    friend bool operator==(const Move&, const Move&) = default;
    explicit operator bool() const { return to != 0; }
};

struct Hashes {
    std::array<std::array<uint64_t, 31>, BoardSize> piece{};
    std::array<std::array<std::array<uint64_t, 20>, 8>, 2> hand{};
    uint64_t turn;
    Hashes() {
        uint64_t state = 0x2bdbbe3f6194eef0ULL;
        const auto next = [&]() {
            state += 0x9e3779b97f4a7c15ULL;
            uint64_t z = state;
            z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9ULL;
            z = (z ^ (z >> 27)) * 0x94d049bb133111ebULL;
            return z ^ (z >> 31);
        };
        for (auto& bySquare : piece) for (auto& key : bySquare) key = next();
        for (auto& bySide : hand) for (auto& byPiece : bySide) for (auto& key : byPiece) key = next();
        turn = next();
    }
};
const Hashes Keys;
constexpr int hashIndex(int piece) { return piece == Wall ? 30 : piece + 15; }

struct Position {
    std::array<int8_t, BoardSize> board{};
    std::array<std::array<uint8_t, 8>, 2> hands{};
    std::array<uint8_t, 2> king{};
    int turn = Black;
    int materialAndSquares = 0;
    uint64_t key = 0;
};

int parseSquare(std::string_view text) {
    if (text.size() != 2 || text[0] < '1' || text[0] > '9' || text[1] < 'a' || text[1] > 'i') {
        throw std::runtime_error("invalid USI square");
    }
    return squareAt(text[1] - 'a', '9' - text[0]);
}
std::string usiSquare(int square) {
    return {static_cast<char>('9' - col(square)), static_cast<char>('a' + row(square))};
}
constexpr std::string_view PieceLetters = " PLNSGBRK";
std::string usi(const Move& move) {
    if (!move) return "resign";
    if (move.drop) return std::string(1, PieceLetters[move.drop]) + "*" + usiSquare(move.to);
    return usiSquare(move.from) + usiSquare(move.to) + (move.promotion ? "+" : "");
}
int parsePiece(char character) {
    const bool white = character >= 'a' && character <= 'z';
    const char upper = white ? static_cast<char>(character - 'a' + 'A') : character;
    const auto letter = PieceLetters.find(upper);
    if (letter == std::string_view::npos || letter == 0) throw std::runtime_error("invalid SFEN piece");
    return sign(white) * static_cast<int>(letter);
}

std::vector<std::string_view> split(std::string_view input, char delimiter) {
    std::vector<std::string_view> fields;
    for (std::size_t offset = 0;;) {
        const auto next = input.find(delimiter, offset);
        fields.push_back(input.substr(offset, next == std::string_view::npos ? next : next - offset));
        if (next == std::string_view::npos) return fields;
        offset = next + 1;
    }
}
Position readPosition(std::string_view sfen, std::string_view holes) {
    std::istringstream input{std::string(sfen)};
    std::string boardText, side, handText, ply, extra;
    if (!(input >> boardText >> side >> handText >> ply) || (input >> extra) || (side != "b" && side != "w")) {
        throw std::runtime_error("expected four SFEN fields");
    }
    Position position;
    position.board.fill(Wall);
    position.turn = side == "w" ? White : Black;
    if (position.turn == White) position.key ^= Keys.turn;
    const auto rows = split(boardText, '/');
    if (rows.size() != 9) throw std::runtime_error("invalid SFEN board");
    for (int rank = 0; rank < 9; ++rank) {
        int file = 0;
        bool promotion = false;
        for (char c : rows[rank]) {
            if (c >= '1' && c <= '9' && !promotion) {
                for (int i = 0; i < c - '0'; ++i) {
                    if (file >= 9) throw std::runtime_error("invalid SFEN rank width");
                    position.board[squareAt(rank, file++)] = Empty;
                }
                continue;
            }
            if (c == '+' && !promotion) { promotion = true; continue; }
            const int piece = parsePiece(c);
            const int owner = sideOf(piece);
            int kind = std::abs(piece);
            if (file >= 9 || (promotion && !canPromote(kind))) throw std::runtime_error("invalid SFEN rank");
            if (promotion) kind = promote(kind);
            const int square = squareAt(rank, file++);
            position.board[square] = sign(owner) * kind;
            position.key ^= Keys.piece[square][hashIndex(position.board[square])];
            position.materialAndSquares += sign(owner) * pieceSquareValue(owner, kind, square);
            if (kind == King) {
                if (position.king[owner]) throw std::runtime_error("duplicate king");
                position.king[owner] = square;
            }
            promotion = false;
        }
        if (file != 9 || promotion) throw std::runtime_error("invalid SFEN rank width");
    }
    if (!position.king[Black] || !position.king[White]) throw std::runtime_error("two kings required");
    if (handText != "-") {
        unsigned count = 0;
        for (char c : handText) {
            if (c >= '0' && c <= '9') {
                count = count * 10 + c - '0';
                if (count > 18) throw std::runtime_error("too many hand pieces");
                continue;
            }
            const int piece = parsePiece(c);
            const int owner = sideOf(piece);
            const int kind = std::abs(piece);
            if (kind == King) throw std::runtime_error("king in hand");
            auto& n = position.hands[owner][kind];
            count = count ? count : 1;
            if (count + n > 18) throw std::runtime_error("too many hand pieces");
            for (unsigned i = 0; i < count; ++i) position.key ^= Keys.hand[owner][kind][n++];
            position.materialAndSquares += sign(owner) * static_cast<int>(count) * HandValue[kind];
            count = 0;
        }
        if (count) throw std::runtime_error("hand count lacks piece");
    }
    if (!holes.empty() && holes != "-") {
        for (auto coord : split(holes, ',')) {
            const int obstacle = parseSquare(coord);
            if (position.board[obstacle] != Empty) throw std::runtime_error("obstacle overlap");
            position.board[obstacle] = Wall;
            position.key ^= Keys.piece[obstacle][hashIndex(Wall)];
        }
    }
    return position;
}

bool attacked(const Position& position, int target, int attacker) {
    const int dir = forward(attacker);
    const auto at = [&](int sq) { return sign(attacker) * position.board[sq]; };
    if (at(target - 2 * dir - 1) == Knight || at(target - 2 * dir + 1) == Knight) return true;
    for (int i = 0; i < 8; ++i) {
        const int ray = Rays[i];
        int from = target + ray;
        int piece = at(from);
        const bool diagonal = i >= 4;
        if (piece == King || piece == Dragon || piece == Horse) return true;
        if (!diagonal) {
            if (goldLike(piece) || (ray == -dir && (piece == Pawn || piece == Silver))) {
                return true;
            }
        } else {
            const bool fromBehind = ray == -dir + 1 || ray == -dir - 1;
            if (piece == Silver || (fromBehind && goldLike(piece))) return true;
        }
        if (piece == Empty) {
            do { from += ray; piece = at(from); } while (piece == Empty);
        }
        if (diagonal) {
            if (piece == Bishop || piece == Horse) return true;
        } else if (piece == Rook || piece == Dragon || (ray == -dir && piece == Lance)) {
            return true;
        }
    }
    return false;
}

Position apply(const Position& parent, Move move) {
    Position position = parent;
    const int owner = parent.turn;
    const int s = sign(owner);
    int kind = move.drop;
    const int to = move.to;
    if (move.drop) {
        auto& count = position.hands[owner][kind];
        position.key ^= Keys.hand[owner][kind][--count];
        position.materialAndSquares -= s * HandValue[kind];
    } else {
        const int from = move.from;
        kind = std::abs(parent.board[from]);
        position.key ^= Keys.piece[from][hashIndex(parent.board[from])];
        position.materialAndSquares -= s * pieceSquareValue(owner, kind, from);
        position.board[from] = Empty;
        if (kind == King) position.king[owner] = to;
        if (move.promotion) kind = promote(kind);
        if (const int captured = parent.board[to]) {
            const int capturedKind = std::abs(captured);
            const int handKind = demote(capturedKind);
            auto& count = position.hands[owner][handKind];
            position.key ^= Keys.piece[to][hashIndex(captured)] ^ Keys.hand[owner][handKind][count++];
            position.materialAndSquares += s * (pieceSquareValue(1 - owner, capturedKind, to) + HandValue[handKind]);
        }
    }
    position.board[to] = s * kind;
    position.key ^= Keys.piece[to][hashIndex(position.board[to])] ^ Keys.turn;
    position.materialAndSquares += s * pieceSquareValue(owner, kind, to);
    position.turn = 1 - owner;
    return position;
}

enum class Generation { All, Tactical };

template<class Visitor>
bool pseudoMoves(const Position& position, Generation generation, Visitor&& visit) {
    const int owner = position.turn;
    const int s = sign(owner);
    const int f = forward(owner);
    const auto moved = [&](int from, int to, int kind) {
        const int target = position.board[to];
        if (target == Wall || target * s > 0 || std::abs(target) == King) return false;
        const bool promotes = canPromote(kind) && (promotionRank(owner, from) < 3 || promotionRank(owner, to) < 3);
        const bool must = canPromote(kind) && deadAt(owner, kind, to);
        if (promotes && visit(Move{static_cast<uint8_t>(from), static_cast<uint8_t>(to), 0, true})) return true;
        return !must && (generation == Generation::All || target != Empty)
            && visit(Move{static_cast<uint8_t>(from), static_cast<uint8_t>(to), 0, false});
    };
    const auto slide = [&](int from, int ray, int kind) {
        for (int to = from + ray; position.board[to] != Wall; to += ray) {
            if (moved(from, to, kind)) return true;
            if (position.board[to] != Empty) break;
        }
        return false;
    };
    int pawnFiles = 0;
    for (int rank = 0; rank < 9; ++rank) for (int file = 0; file < 9; ++file) {
        const int from = squareAt(rank, file);
        const auto piece = position.board[from];
        if (piece == Wall || piece * s <= 0) continue;
        const int kind = std::abs(piece);
        if (kind == Pawn) { pawnFiles |= 1 << file; if (moved(from, from + f, kind)) return true; }
        else if (kind == Lance) { if (slide(from, f, kind)) return true; }
        else if (kind == Knight) {
            if (moved(from, from + 2 * f - 1, kind) || moved(from, from + 2 * f + 1, kind)) return true;
        } else if (kind == Silver) {
            for (int d : {f - 1, f, f + 1, -f - 1, -f + 1}) if (moved(from, from + d, kind)) return true;
        } else if (goldLike(kind)) {
            for (int d : {f - 1, f, f + 1, -1, 1, -f}) if (moved(from, from + d, kind)) return true;
        } else {
            for (int i = 0; i < 8; ++i) {
                const bool diagonal = i >= 4;
                const int ray = Rays[i];
                if ((diagonal && (kind == Bishop || kind == Horse)) || (!diagonal && (kind == Rook || kind == Dragon))) {
                    if (slide(from, ray, kind)) return true;
                } else if ((kind == King || kind == Horse || kind == Dragon) && moved(from, from + ray, kind)) return true;
            }
        }
    }
    if (generation == Generation::Tactical) return false;
    for (int kind = Pawn; kind <= Rook; ++kind) {
        if (!position.hands[owner][kind]) continue;
        for (int rank = 0; rank < 9; ++rank) for (int file = 0; file < 9; ++file) {
            const int to = squareAt(rank, file);
            if (position.board[to] != Empty || deadAt(owner, kind, to)) continue;
            if (kind == Pawn && (pawnFiles & (1 << file))) continue;
            if (visit(Move{0, static_cast<uint8_t>(to), static_cast<uint8_t>(kind), false})) return true;
        }
    }
    return false;
}

bool hasLegal(const Position& position, bool skipPawnMate = false);
bool legalChild(const Position& parent, Move move, const Position& child, bool skipPawnMate = false) {
    const int owner = parent.turn;
    if (attacked(child, child.king[owner], 1 - owner)) return false;
    return skipPawnMate || move.drop != Pawn || !attacked(child, child.king[1 - owner], owner) || hasLegal(child, true);
}
bool hasLegal(const Position& position, bool skipPawnMate) {
    return pseudoMoves(position, Generation::All, [&](Move move) {
        return legalChild(position, move, apply(position, move), skipPawnMate);
    });
}
std::vector<Move> legalMoves(const Position& position) {
    std::vector<Move> moves;
    pseudoMoves(position, Generation::All, [&](Move move) {
        if (legalChild(position, move, apply(position, move))) moves.push_back(move);
        return false;
    });
    return moves;
}

int chebyshev(int a, int b) { return std::max(std::abs(row(a) - row(b)), std::abs(col(a) - col(b))); }
int kingSafety(const Position& position, int side) {
    const int king = position.king[side];
    const int s = sign(side);
    const int attacker = 1 - side;
    int safety = 0;
    int walls = 0;
    int emptyAdjacent = 0;
    for (int ray : Rays) {
        const int sq = king + ray;
        const int p = position.board[sq];
        if (p == Wall) {
            if (row(sq) >= 0 && row(sq) < 9 && col(sq) >= 0 && col(sq) < 9) ++walls;
            continue;
        }
        if (!p) ++emptyAdjacent;
        else if (p * s > 0) {
            const int kind = std::abs(p);
            safety += goldLike(kind) || kind == Silver ? 16 : kind == Pawn ? 8 : 5;
        } else {
            const int kind = std::abs(p);
            safety -= kind == Pawn ? 19 : 40;
        }
    }
    if (walls) safety -= walls * 4 + (walls >= 2 && !emptyAdjacent ? 26 : 0);
    if (position.hands[attacker][Rook] || position.hands[attacker][Bishop]) safety -= 22;
    if (position.hands[attacker][Gold] || position.hands[attacker][Silver]) safety -= 11;
    return safety;
}

int evaluate(const Position& position) {
    const int score = position.materialAndSquares + kingSafety(position, Black) - kingSafety(position, White);
    return sign(position.turn) * score + 10;
}

struct ScoredMove { Move move; int order; };
struct MoveList {
    std::array<ScoredMove, 1024> entries{};
    std::size_t size = 0;
    void push(Move move, int order) {
        if (size == entries.size()) throw std::runtime_error("move list overflow");
        entries[size++] = {move, order};
    }
    void sort() {
        std::sort(entries.begin(), entries.begin() + size, [](const auto& a, const auto& b) {
            if (a.order != b.order) return a.order > b.order;
            if (a.move.from != b.move.from) return a.move.from < b.move.from;
            if (a.move.to != b.move.to) return a.move.to < b.move.to;
            if (a.move.drop != b.move.drop) return a.move.drop < b.move.drop;
            return a.move.promotion > b.move.promotion;
        });
    }
};
struct SearchResult { Move move; int depth = 0; uint64_t nodes = 0; int elapsed = 0; int score = 0; };
using Clock = std::chrono::steady_clock;

class Search {
    enum Bound : uint8_t { EmptyBound, Exact, Upper, Lower };
    struct TTEntry {
        uint64_t key = 0;
        Move move;
        int16_t score = 0;
        uint8_t depth = 0;
        Bound bound = EmptyBound;
    };
    static constexpr unsigned TableSize = 1 << 18;
    std::vector<TTEntry> table{TableSize};
    std::array<std::array<Move, 2>, MaxPly> killer{};
    std::array<std::array<std::array<int16_t, BoardSize>, BoardSize + 8>, 2> history{};
    std::array<uint64_t, MaxPly> currentLine{};
    Clock::time_point start, deadline;
    uint64_t nodes = 0;
    struct TimeExpired {};

    void checkTime() const {
        if (Clock::now() >= deadline) throw TimeExpired{};
    }
    void enter() {
        if ((++nodes & 63) == 0) checkTime();
    }
    bool seen(uint64_t key, int ply) const {
        for (int i = ply - 2; i >= 0; i -= 2) if (currentLine[i] == key) return true;
        return false;
    }
    static int historyFrom(Move move) { return move.drop ? BoardSize + move.drop : move.from; }
    static int ttWrite(int score, int ply) {
        return score > Mate - MaxPly ? score + ply : score < -Mate + MaxPly ? score - ply : score;
    }
    static int ttRead(int score, int ply) {
        return score > Mate - MaxPly ? score - ply : score < -Mate + MaxPly ? score + ply : score;
    }
    int order(const Position& position, Move move, Move hashMove, int ply) const {
        if (move == hashMove) return 2000000;
        const int mover = move.drop ? move.drop : std::abs(position.board[move.from]);
        const int taken = std::abs(position.board[move.to]);
        if (taken) return 1000000 + 18 * (Value[taken] + HandValue[demote(taken)]) - Value[mover]
            + (move.promotion ? 1400 : 0);
        if (move.promotion) return 900000 + 5 * (Value[promote(mover)] - Value[mover]);
        if (move == killer[ply][0]) return 800000;
        if (move == killer[ply][1]) return 790000;
        const int king = position.king[1 - position.turn];
        const int distance = chebyshev(king, move.to);
        const int proximity = mover != King ? std::max(0, 6 - distance) * (move.drop ? 12 : 5) : 0;
        return history[position.turn][historyFrom(move)][move.to] + proximity;
    }
    void rewardQuiet(int side, Move move, int ply, int depth) {
        auto& pair = killer[ply];
        if (!(move == pair[0])) { pair[1] = pair[0]; pair[0] = move; }
        auto& value = history[side][historyFrom(move)][move.to];
        const int bonus = 60 * depth * depth;
        value = static_cast<int16_t>(std::clamp(value + bonus - value * bonus / 16384, -16383, 16383));
    }

    int quiescence(const Position& position, int alpha, int beta, int ply, int tacticalDepth) {
        enter();
        const int side = position.turn;
        const bool check = attacked(position, position.king[side], 1 - side);
        if (!hasLegal(position)) return -Mate + ply;
        if (seen(position.key, ply)) return 0;
        currentLine[ply] = position.key;
        int best = check ? -Infinity : evaluate(position);
        if (ply >= MaxPly - 1 || tacticalDepth >= (check ? 7 : 5)) return check ? evaluate(position) - 50 : best;
        if (!check) {
            if (best >= beta) return best;
            alpha = std::max(alpha, best);
        }
        MoveList moves;
        pseudoMoves(position, check ? Generation::All : Generation::Tactical, [&](Move move) {
            moves.push(move, order(position, move, {}, ply));
            return false;
        });
        moves.sort();
        for (std::size_t i = 0; i < moves.size; ++i) {
            const Move move = moves.entries[i].move;
            const int taken = std::abs(position.board[move.to]);
            const int gain = Value[taken] + HandValue[demote(taken)];
            if (!check && !move.promotion && evaluate(position) + gain + 180 < alpha) continue;
            const Position child = apply(position, move);
            if (!legalChild(position, move, child)) continue;
            const int score = -quiescence(child, -beta, -alpha, ply + 1, tacticalDepth + 1);
            best = std::max(best, score);
            if (score >= beta) return score;
            alpha = std::max(alpha, score);
        }
        return best;
    }

    int alphaBeta(const Position& position, int depth, int alpha, int beta, int ply) {
        if (depth <= 0 || ply >= MaxPly - 1) return quiescence(position, alpha, beta, ply, 0);
        enter();
        const int rawAlpha = alpha;
        const bool pv = beta - alpha > 1;
        const int side = position.turn;
        if (seen(position.key, ply)) return 0;
        currentLine[ply] = position.key;
        const auto index = position.key & (TableSize - 1);
        const TTEntry entry = table[index];
        Move preferred;
        if (entry.bound && entry.key == position.key) {
            preferred = entry.move;
            const int score = ttRead(entry.score, ply);
            if (!pv && entry.depth >= depth && (entry.bound == Exact
                || (entry.bound == Upper && score <= alpha) || (entry.bound == Lower && score >= beta))) return score;
        }
        const bool check = attacked(position, position.king[side], 1 - side);
        MoveList moves;
        pseudoMoves(position, Generation::All, [&](Move move) {
            moves.push(move, order(position, move, preferred, ply));
            return false;
        });
        moves.sort();
        int seenLegal = 0;
        int best = -Mate + ply;
        Move bestMove;
        for (std::size_t i = 0; i < moves.size; ++i) {
            const Move move = moves.entries[i].move;
            const Position child = apply(position, move);
            if (!legalChild(position, move, child)) continue;
            ++seenLegal;
            const bool quiet = !position.board[move.to] && !move.promotion;
            int score;
            if (seenLegal == 1) {
                score = -alphaBeta(child, depth - 1, -beta, -alpha, ply + 1);
            } else {
                const bool late = depth >= 3 && seenLegal >= (pv ? 8 : 5) && quiet && !check
                    && !attacked(child, child.king[child.turn], side);
                score = late ? -alphaBeta(child, depth - 2, -alpha - 1, -alpha, ply + 1) : alpha + 1;
                if (score > alpha) score = -alphaBeta(child, depth - 1, -alpha - 1, -alpha, ply + 1);
                if (pv && score > alpha && score < beta) score = -alphaBeta(child, depth - 1, -beta, -alpha, ply + 1);
            }
            if (score > best) { best = score; bestMove = move; }
            if (score > alpha) alpha = score;
            if (alpha >= beta) {
                if (quiet) rewardQuiet(side, move, ply, depth);
                break;
            }
        }
        const auto bound = best >= beta ? Lower : best > rawAlpha ? Exact : Upper;
        if (depth >= entry.depth || entry.key != position.key || bound == Exact) {
            table[index] = {position.key, bestMove, static_cast<int16_t>(ttWrite(best, ply)), static_cast<uint8_t>(depth), bound};
        }
        return best;
    }
public:
    void reset() {
        std::fill(table.begin(), table.end(), TTEntry{});
        killer = {};
        history = {};
    }
    SearchResult run(const Position& position, int milliseconds) {
        start = Clock::now();
        deadline = start + std::chrono::milliseconds(milliseconds);
        nodes = 0;
        killer = {};
        const std::vector<Move> moves = legalMoves(position);
        SearchResult out;
        if (moves.empty()) { out.score = -Mate; return out; }
        out.move = moves.front();
        out.score = evaluate(position);
        currentLine[0] = position.key;
        try {
            for (int depth = 1; depth <= 24; ++depth) {
                checkTime();
                MoveList ordered;
                for (const auto move : moves) ordered.push(move, order(position, move, out.move, 0));
                ordered.sort();
                int alpha = -Infinity;
                Move principal;
                for (std::size_t i = 0; i < ordered.size; ++i) {
                    checkTime();
                    const auto move = ordered.entries[i].move;
                    const auto child = apply(position, move);
                    int score = i ? -alphaBeta(child, depth - 1, -alpha - 1, -alpha, 1)
                        : -alphaBeta(child, depth - 1, -Infinity, Infinity, 1);
                    if (i && score > alpha) score = -alphaBeta(child, depth - 1, -Infinity, -alpha, 1);
                    if (score > alpha) { alpha = score; principal = move; }
                }
                out.move = principal;
                out.depth = depth;
                out.score = alpha;
                if (std::abs(alpha) >= Mate - MaxPly) break;
            }
        } catch (const TimeExpired&) {}
        out.nodes = nodes;
        out.elapsed = static_cast<int>(std::chrono::duration_cast<std::chrono::milliseconds>(Clock::now() - start).count());
        return out;
    }
};

void printMoves(const std::vector<Move>& moves) {
    std::cout << '[';
    bool first = true;
    for (const auto move : moves) {
        if (!first) std::cout << ',';
        first = false;
        std::cout << '"' << usi(move) << '"';
    }
    std::cout << ']';
}
void printMate(const Position& position) {
    std::vector<Move> checkmates, otherTerminals;
    for (const auto move : legalMoves(position)) {
        const auto child = apply(position, move);
        if (hasLegal(child)) continue;
        auto& outcomes = attacked(child, child.king[child.turn], position.turn) ? checkmates : otherTerminals;
        outcomes.push_back(move);
    }
    std::cout << "{\"mate\":";
    printMoves(checkmates);
    std::cout << ",\"noLegalWithoutCheck\":";
    printMoves(otherTerminals);
    std::cout << '}';
}
int parseMilliseconds(std::string_view text) {
    int value = 0;
    const auto [end, error] = std::from_chars(text.data(), text.data() + text.size(), value);
    if (error != std::errc{} || end != text.data() + text.size() || value < 1 || value > 60000) {
        throw std::runtime_error("invalid time budget");
    }
    return value;
}
}  // namespace

int main() {
    std::ios::sync_with_stdio(false);
    Search engine;
    for (std::string line; std::getline(std::cin, line);) {
        const auto words = split(line, '\t');
        try {
            if (words[0] == "id" && words.size() == 1) {
                std::cout << "{\"name\":\"Independent obstacle reference\",\"version\":\"1.0\",\"search\":\"iterative PVS + quiescence + TT\",\"threads\":1}";
            } else if (words[0] == "reset" && words.size() == 1) {
                engine.reset();
                std::cout << "{\"ok\":true}";
            } else if (words[0] == "legal" && words.size() == 3) {
                std::cout << "{\"moves\":";
                const auto position = readPosition(words[1], words[2]);
                printMoves(legalMoves(position));
                std::cout << ",\"inCheck\":"
                          << (attacked(position, position.king[position.turn], 1-position.turn) ? "true" : "false");
                std::cout << '}';
            } else if (words[0] == "mate" && words.size() == 3) {
                printMate(readPosition(words[1], words[2]));
            } else if (words[0] == "go" && words.size() == 4) {
                const int time = parseMilliseconds(words[1]);
                const auto out = engine.run(readPosition(words[2], words[3]), time);
                std::cout << "{\"bestmove\":\"" << usi(out.move) << "\",\"depth\":" << out.depth
                          << ",\"nodes\":" << out.nodes << ",\"elapsed_ms\":" << out.elapsed << ",\"score\":" << out.score << '}';
            } else {
                throw std::runtime_error("unsupported command or wrong number of fields");
            }
        } catch (const std::exception& error) {
            std::cout << "{\"error\":\"" << error.what() << "\"}";
        }
        std::cout << '\n' << std::flush;
    }
}
