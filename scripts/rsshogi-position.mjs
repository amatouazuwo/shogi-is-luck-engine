// Game coordinates: row 0 is opponent's home rank; column 0 is file 9.
const TYPES = "RBGSNLP";
export function toSfen(g) {
  if (!g || !Array.isArray(g.board) || g.board.length !== 81 || ![0,1].includes(g.turn)) return null;
  if (g.holes?.length || g.effect === 'dragon' || g.effect === 'doubleSecond' || g.teleportActive != null || g.seatShuffleClaim) return null;
  const kings=[0,0], rows=[];
  for(let r=0;r<9;r++){
    let row="", empty=0;
    for(let c=0;c<9;c++){
      const p=g.board[r*9+c];
      if(!p){empty++;continue;}
      if(!"KRBGSNLP".includes(p.type)||p.type.length!==1||![0,1].includes(p.side)|| (p.pr&&! "RB SNLP".replace(" ","").includes(p.type))) return null;
      if(p.type==="K")kings[p.side]++;
      if(empty){row+=empty;empty=0;}
      row+=(p.pr?"+":"")+(p.side===0?p.type:p.type.toLowerCase());
    }
    if(empty)row+=empty;
    rows.push(row);
  }
  if(kings.some(n=>n!==1))return null;
  let hand="";
  for(const side of [0,1])for(const t of TYPES){
    const n=g.hands?.[side]?.[t]??0;
    if(!Number.isInteger(n)||n<0||n>18)return null;
    if(n)hand+=(n>1?n:"")+(side===0?t:t.toLowerCase());
  }
  return rows.join("/")+" "+(g.turn===0?"b":"w")+" "+(hand||"-")+" "+(Math.max(0,Number(g.steps)||0)+1);
}
const square=i=>Number.isInteger(i)&&i>=0&&i<81?String(9-i%9)+String.fromCharCode(97+Math.floor(i/9)):null;
export function toUsi(m){
  if(!m||m.dragon||m.teleport)return null;
  const to=square(m.to);if(!to)return null;
  if(m.drop)return TYPES.includes(m.drop)&&m.drop.length===1?m.drop+"*"+to:null;
  const from=square(m.from);return from?from+to+(m.promote?"+":""):null;
}
export function matchLegal(bestmove,legal) {
  if(typeof bestmove!=="string")return null;
  return legal.find(m=>toUsi(m)===bestmove)??null;
}

// The game's legal generator is authoritative, including special moves.
export function immediateKingCapture(g, legal) {
  return legal.find(m => { const p=g.board[m.to]; return p?.type==='K' && p.side===1-g.turn; }) ?? null;
}
