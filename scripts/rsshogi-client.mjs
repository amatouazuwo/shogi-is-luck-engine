// SDK is supplied separately, unmodified. Never use an unvalidated engine move.
import {toSfen,matchLegal,immediateKingCapture} from './rsshogi-position.mjs';
export class BrowserEngine {
  constructor(workerUrl, wasmUrl, {workerFactory = url => new Worker(url,{type:'module'}), timeout=10000}={}) {
    this.workerUrl=workerUrl; this.wasmUrl=wasmUrl; this.factory=workerFactory; this.timeout=timeout;
    this.seq=0; this.generation=0; this.pending=new Map(); this.worker=null; this.ready=null;
  }
  reset(){
    this.generation++;
    this.worker?.terminate(); this.worker=null; this.ready=null;
    for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('engine cancelled'));}
    this.pending.clear();
  }
  async init(){
    if(this.ready)return this.ready;
    const w=this.factory(this.workerUrl);this.worker=w;
    w.onmessage=({data})=>{
      if(this.worker!==w)return;
      const p=this.pending.get(data.id);if(!p)return;
      if(data.ok!==false&&p.search&&data.event!=='bestmove')return;
      this.pending.delete(data.id);clearTimeout(p.timer);
      if(data.ok===false)p.reject(new Error(data.error||'engine error'));else p.resolve(data.result);
    };
    w.onerror=()=>{if(this.worker===w)this.reset();};
    this.ready=this.request('init',{url:this.wasmUrl,hash_mb:16}).catch(e=>{if(this.worker===w)this.reset();throw e;});
    return this.ready;
  }
  request(command,args={},search=false){
    return new Promise((resolve,reject)=>{
      const id=++this.seq;
      const timer=setTimeout(()=>{this.reset();},this.timeout);
      this.pending.set(id,{resolve,reject,timer,search});
      try{this.worker.postMessage({id,command,...args});}catch(e){this.reset();}
    });
  }
  async choose(g,legal,ms=500){
    const capture=immediateKingCapture(g,legal);if(capture)return capture;
    const sfen=toSfen(g);if(!sfen)return null;
    if(this.busy)this.reset();
    const gen=++this.generation;this.busy=gen;
    try{
      await this.init();if(gen!==this.generation)return null;
      await this.request('position',{sfen,moves:[]});if(gen!==this.generation)return null;
      const result=await this.request('go',{depth:64,movetime_ms:Math.max(1,Math.floor(ms))},true);
      return gen===this.generation?matchLegal(result?.bestmove,legal):null;
    }catch{return null;}finally{if(this.busy===gen)this.busy=0;}
  }
}
