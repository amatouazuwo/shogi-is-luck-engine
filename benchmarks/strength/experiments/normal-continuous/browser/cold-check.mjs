import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const { chromium, devices } = createRequire(join(process.env.NODE_MODULES_DIR, '..', 'package.json'))('playwright');
const base = process.env.BASE_URL;
const options = process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {};
const browser = await chromium.launch(options);
const variants = {stock:'worker.js',continuous:'continuous-worker.mjs'};
const repetitions = Number(process.env.NORMAL_BROWSER_REPETITIONS ?? 2);
const profileFilter = process.env.NORMAL_BROWSER_PROFILE;
const conditions = process.env.NORMAL_BROWSER_COLD_ONLY === '1' ? [false] : [false,true];

try {
  for (const [profile, device] of [['desktop',{}], ['Pixel 7',devices['Pixel 7']]]) {
    if (profileFilter && profileFilter !== profile) continue;
    const page = await browser.newPage(device);
    try {
      await page.route(url => url.origin !== base, route => route.abort());
      await page.goto(base, {waitUntil:'domcontentloaded'});
      await page.waitForFunction(() => typeof getLegal === 'function');
      await page.evaluate(async () => {
        window.BrowserEngine = (await import('/ai/rsshogi-client.mjs')).BrowserEngine;
        const {toSfen,toUsi} = await import('/ai/rsshogi-position.mjs');
        const board = Array(81).fill(null);
        const back = ['L','N','S','G','K','G','S','N','L'];
        for (let col=0; col<9; col++) {
          board[col] = piece(back[col],1);
          board[18+col] = piece('P',1);
          board[54+col] = piece('P',0);
          board[72+col] = piece(back[col],0);
        }
        for (const [cell,type,side] of [[10,'R',1],[16,'B',1],[64,'B',0],[70,'R',0]]) board[cell]=piece(type,side);
        const fixture = emptyGame(board);
        window.sampleSfen = toSfen(fixture);
        window.sampleLegal = getLegal(fixture,0).map(toUsi);
      });

      for (const primed of conditions) {
        for (let repetition=1; repetition<=repetitions; repetition++) {
          const order = repetition % 2 ? Object.keys(variants) : Object.keys(variants).reverse();
          for (const engine of order) {
            const result = await page.evaluate(async ({filename,primed}) => {
              const sdk = new URL('/ai/sdk/',location.href);
              const worker = new window.BrowserEngine(new URL(filename,sdk).href,new URL('rsshogi_nnue_mini.wasm',sdk).href);
              try {
                const start = performance.now();
                await worker.init();
                const initMs = performance.now()-start;
                let prime = null;
                if (primed) {
                  const primeStart=performance.now();
                  await worker.request('position',{sfen:window.sampleSfen,moves:['7g7f']});
                  const probe=await worker.request('go',{depth:2,movetime_ms:100},true);
                  await worker.request('new_game');
                  prime={depth:probe.depth,nodes:probe.nodes,primeMs:performance.now()-primeStart};
                }
                await worker.request('position',{sfen:window.sampleSfen,moves:[]});
                const before=performance.now();
                const result=await worker.request('go',{depth:64,movetime_ms:100},true);
                return {initMs,prime,goWallMs:performance.now()-before,depth:result.depth,nodes:result.nodes,
                  engineMs:result.elapsed_ms,bestmove:result.bestmove,legal:window.sampleLegal.includes(result.bestmove)};
              } finally { worker.reset(); }
            }, {filename:variants[engine],primed});
            console.log(JSON.stringify({event:'first-100ms-go',profile,engine,primed,repetition,...result}));
            assert.equal(result.legal,true);
          }
        }
      }

      for (const [engine,filename] of Object.entries(variants)) {
        const cancellation = await page.evaluate(async filename => {
          const sdk = new URL('/ai/sdk/',location.href);
          const wrapper = new window.BrowserEngine(new URL(filename,sdk).href,new URL('rsshogi_nnue_mini.wasm',sdk).href);
          try {
            await wrapper.init();
            await wrapper.request('position',{sfen:window.sampleSfen,moves:[]});
            const oldWorker=wrapper.worker;
            const oldHandler=oldWorker.onmessage;
            let actualBestmove=false;
            oldWorker.addEventListener('message',({data})=>{if(data.event==='bestmove')actualBestmove=true;});
            const search=wrapper.request('go',{depth:64,movetime_ms:1500},true);
            const requestId=wrapper.seq;
            const outcome=search.then(()=> 'completed',error=>error.message);
            await new Promise(resolve=>setTimeout(resolve,30));
            wrapper.reset();
            await wrapper.init();
            oldHandler({data:{id:requestId,ok:true,event:'bestmove',result:{bestmove:'7g7f'}}});
            return {outcome:await outcome,actualBestmove,replaced:oldWorker!==wrapper.worker,pending:wrapper.pending.size};
          } finally { wrapper.reset(); }
        }, filename);
        console.log(JSON.stringify({event:'cancellation',profile,engine,...cancellation}));
        assert.deepEqual(cancellation,{outcome:'engine cancelled',actualBestmove:false,replaced:true,pending:0});
      }
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
}
