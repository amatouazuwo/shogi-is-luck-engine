import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(join(process.env.NODE_MODULES_DIR,'..','package.json'));
const {chromium,devices} = require('playwright');
const base = process.env.BASE_URL;
const options = process.env.CHROMIUM_EXECUTABLE ? {executablePath:process.env.CHROMIUM_EXECUTABLE} : {};
const permutations = [
  ['none','time','nodes'], ['time','nodes','none'], ['nodes','none','time'],
  ['nodes','time','none'], ['time','none','nodes'], ['none','nodes','time'],
];
const blocks = Math.max(1,Number(process.env.STARTUP_PRIME_BLOCKS ?? permutations.length));
const profiles = [['desktop',{}],['Pixel 7',devices['Pixel 7']]];
for (const [profile,device] of profiles) {
  const browser = await chromium.launch(options);
  try {
    for (let block=0; block<blocks; block++) {
      const page = await browser.newPage(device);
      try {
        await page.route(url=>url.origin!==base,route=>route.abort());
        await page.goto(base,{waitUntil:'domcontentloaded'});
        await page.waitForFunction(()=>typeof getLegal==='function');
        const fixture = await page.evaluate(block=>{
          const seed=0x7816d3+block;
          const standard=block%3===0;
          const board=standard?Array(81).fill(null):(() => {
            const random=Math.random;
            let state=seed;
            try {
              Math.random=()=>((state=(Math.imul(1664525,state)+1013904223)>>>0)/2**32);
              return independentBoard();
            } finally { Math.random=random; }
          })();
          if (standard) {
            const row=['L','N','S','G','K','G','S','N','L'];
            for (let col=0; col<9; col++) {
              board[col]=piece(row[col],1);
              board[18+col]=piece('P',1);
              board[54+col]=piece('P',0);
              board[72+col]=piece(row[col],0);
            }
            for (const [cell,type,side] of [[10,'R',1],[16,'B',1],[64,'B',0],[70,'R',0]]) board[cell]=piece(type,side);
          }
          window.startupFixture=emptyGame(board);
          return standard?'standard':`random-0x${seed.toString(16)}`;
        },block);
        const order = permutations[(block+(profile==='desktop'?0:3))%permutations.length];
        for (const mode of order) {
          const sample = await page.evaluate(async mode => {
            const {BrowserEngine}=await import('/ai/rsshogi-client.mjs');
            const {toUsi}=await import('/ai/rsshogi-position.mjs');
            const sdk=new URL('/ai/sdk/',location.href);
            const workerUrl=new URL('/ai/rsshogi-continuous-worker.mjs',location.href);
            if (mode!=='none') workerUrl.searchParams.set('startupPrime',mode);
            const engine=new BrowserEngine(workerUrl.href,new URL('rsshogi_nnue_mini.wasm',sdk).href,
              {moduleUrl:new URL('mini.js',sdk).href});
            const legal=getLegal(window.startupFixture,0);
            try {
              const start=performance.now();
              const prime=await engine.init()??null;
              const ready=performance.now();
              const request=engine.request.bind(engine);
              let outcome;
              engine.request=async (command,...args) => {
                if (command!=='go') return request(command,...args);
                const goStart=performance.now();
                const raw=await request(command,...args);
                outcome={goWallMs:performance.now()-goStart,depth:raw.depth,nodes:raw.nodes,
                  engineMs:raw.elapsed_ms,bestmove:raw.bestmove};
                return raw;
              };
              const move=await engine.choose(window.startupFixture,legal,100);
              const stop=performance.now();
              return {initMs:ready-start,initThroughMoveMs:stop-start,prime,...outcome,
                legal:!!move&&legal.includes(move)&&toUsi(move)===outcome?.bestmove};
            } finally { engine.reset(); }
          },mode);
          console.log(JSON.stringify({profile,block:block+1,fixture,mode,...sample}));
          assert.ok(sample.legal,'Game rejected Worker result');
          assert.equal(typeof sample.depth,'number');
          assert.equal(mode==='none',sample.prime===null);
        }
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
  console.error(`Completed ${profile}: ${blocks*3} samples`);
}
