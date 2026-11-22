import { MiniEngine } from "./mini.js";

// Experimental native-continuous obstacle search. Same rsshogi WASM/NNUE
// and legality as baseline; ONLY search scheduling is changed.
// Unlike the official 35ms cooperative-slice Worker, one search runs for the
// requested time uninterrupted, improving iterative-deepening continuity.
// IMPORTANT: synchronous WASM search blocks this Worker. It cannot service a
// stop/cancel command mid-search. Not suitable for deployment without a safe
// cancellation design and explicit latency validation.
let engine = null;
let generation = 0;
let initialization = 0;
const reply=(message,data)=>postMessage({id:message.id,command:message.command,...data});
const requireEngine=()=>{if(!engine)throw Error('engine is not initialized');return engine;};
const unwrap=value=>{if(!value?.ok)throw Error(value?.error??'engine request failed');return value;};
const nextGeneration=()=>{generation++;};

self.onmessage=async ({data:message})=>{
 try{
  switch(message.command){
   case 'init': {
    nextGeneration();
    const token=++initialization;
    engine?.dispose();
    engine=null;
    const created=await MiniEngine.create(message.url??message.wasm);
    if(token!==initialization){created.dispose();return;}
    try{
     const loaded=unwrap(message.model
       ?created.loadModel(message.model)
       :created.request({command:'load_embedded'}));
     unwrap(created.request({command:'configure',hash_mb:message.hash_mb??16,threads:1}));
     engine=created;
     reply(message,loaded);
    }catch(error){created.dispose();throw error;}
    break;
   }
   case 'position': {
    nextGeneration();
    const holes=message.holes??[];
    if(!Array.isArray(holes))throw Error('holes must be an array of USI squares');
    if(holes.length){
     if(message.moves?.length)throw Error('obstacle position requires SFEN without replay');
     reply(message,unwrap(requireEngine().request({
      command:'set_obstacle_position',sfen:message.sfen,holes
     })));
    }else{
     reply(message,unwrap(requireEngine().request({
      command:'set_position',sfen:message.sfen??'startpos',moves:message.moves??[]
     })));
    }
    break;
   }
   case 'legalMoves':
    reply(message,unwrap(requireEngine().request({command:'legal_moves'})));
    break;
   case 'new_game':
    nextGeneration();
    reply(message,unwrap(requireEngine().request({command:'new_game'})));
    break;
   case 'go':{
    requireEngine();
    const depth=message.depth??64;
    if(!Number.isInteger(depth)||depth<1||depth>64)
     throw Error('depth must be an integer in 1..64');
    for(const field of ['nodes','movetime_ms']){
     if(message[field]!==undefined &&
        (!Number.isSafeInteger(message[field])||message[field]<1))
      throw Error(field+' must be a positive safe integer');
    }
    if(message.nodes===undefined&&message.movetime_ms===undefined)
     throw Error('search requires a node or time limit');
    const token=++generation;
    const started=performance.now();
    // ONE uninterrupted, C-API-bounded search. This intentionally differs
    // from the reference Worker's repeated 35ms searches and keeps rsshogi's
    // normal iterative-deepening behavior throughout a single request.
    const response=unwrap(requireEngine().request({
     command:'search',depth,nodes:message.nodes,movetime_ms:message.movetime_ms
    }));
    if(token!==generation)throw Error('stale search result');
    reply(message,{ok:true,event:'bestmove',result:{
     ...response.result,elapsed_ms:Math.round(performance.now()-started)
    }});
    break;
   }
   case 'stop':
    // Synchronous WASM search blocks this Worker, so stop cannot execute
    // while go is running. Never acknowledge it as a successful cancellation.
    // The controller must terminate this Worker and discard its old results.
    reply(message,{ok:false,error:'Continuous search is not cooperatively cancellable; terminate this Worker from the controller'});
    break;
   case 'dispose':
    nextGeneration();initialization++;
    engine?.dispose();engine=null;
    reply(message,{ok:true});
    break;
   default:throw Error('unknown worker command');
  }
 }catch(error){
  reply(message,{ok:false,error:String(error?.message??error)});
 }
};
