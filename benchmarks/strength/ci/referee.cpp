// Standalone referee adapter. Uses only the already published independent C++ rules.
#define main archived_reference_main
#include "../reference/obstacle-reference.cpp"
#undef main
std::string serialize(const Position& p, int ply) {
    std::string s;
    for(int r=0;r<9;++r){
        if(r) s+='/';
        int empty=0;
        for(int c=0;c<9;++c){
            int v=p.board[squareAt(r,c)];
            if(v==Empty||v==Wall){++empty;continue;}
            if(empty){s+=std::to_string(empty);empty=0;}
            int k=std::abs(v), d=demote(k);
            if(d!=k)s+='+';
            char ch=PieceLetters[d];
            s+=v<0?char(ch-'A'+'a'):ch;
        }
        if(empty)s+=std::to_string(empty);
    }
    s+=p.turn==Black?" b ":" w ";
    std::string h;
    for(int side=0;side<2;++side)for(int k=Rook;k>=Pawn;--k){
        int count=p.hands[side][k];
        if(!count)continue;
        if(count>1)h+=std::to_string(count);
        char ch=PieceLetters[k]; h+=side==White?char(ch-'A'+'a'):ch;
    }
    return s+(h.empty()?"-":h)+" "+std::to_string(ply);
}
int main(){
    Search engine;
    for(std::string line; std::getline(std::cin,line);){
        try{
            auto w=split(line,'\t');
            if(w.size()==1&&w[0]=="reset"){engine.reset();std::cout<<"{\"ok\":true}";}
            else if(w.size()==3&&w[0]=="legal"){std::cout<<"{\"moves\":";printMoves(legalMoves(readPosition(w[1],w[2])));std::cout<<'}';}
            else if(w.size()==3&&w[0]=="features"){
                const auto p=readPosition(w[1],w[2]);
                const auto legal=legalMoves(p);
                int captures=0, promotions=0;
                for(const auto m:legal){
                    if(p.board[m.to]!=Empty && p.board[m.to]!=Wall)++captures;
                    if(m.promotion)++promotions;
                }
                const bool check=attacked(p,p.king[p.turn],1-p.turn);
                std::cout<<"{\"inCheck\":"<<(check?"true":"false")
                         <<",\"legalCount\":"<<legal.size()
                         <<",\"captureMoves\":"<<captures
                         <<",\"promotionMoves\":"<<promotions<<'}';
            }
            else if(w.size()==4&&w[0]=="go"){
                auto r=engine.run(readPosition(w[2],w[3]),parseMilliseconds(w[1]));
                std::cout<<"{\"bestmove\":\""<<usi(r.move)<<"\",\"depth\":"<<r.depth<<",\"nodes\":"<<r.nodes<<",\"elapsed_ms\":"<<r.elapsed<<'}';
            }else if(w.size()==4&&w[0]=="step"){
                auto p=readPosition(w[1],w[2]);auto legal=legalMoves(p);
                auto m=std::find_if(legal.begin(),legal.end(),[&](auto a){return usi(a)==w[3];});
                if(m==legal.end())throw std::runtime_error("illegal move");
                auto fields=split(w[1],' ');
                auto next=apply(p,*m);
                std::cout<<"{\"sfen\":\""<<serialize(next,std::stoi(std::string(fields.at(3)))+1)<<"\"}";
            }else throw std::runtime_error("invalid command");
        }catch(const std::exception&){std::cout<<"{\"error\":\"referee request failed\"}";}
        std::cout<<'\n'<<std::flush;
    }
}
