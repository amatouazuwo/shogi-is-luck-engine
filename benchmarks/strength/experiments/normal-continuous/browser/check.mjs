import assert from 'node:assert/strict';
import { get } from 'node:http';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const { chromium, devices } = createRequire(join(process.env.NODE_MODULES_DIR, '..', 'package.json'))('playwright');
const base = process.env.BASE_URL;
const normal = '/ai/sdk/continuous-worker.mjs';
const obstacle = '/ai/obstacle-sdk/worker.js';
const options = process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {};
const log = (event, info) => console.log(JSON.stringify({event,...info}));
assert.equal((await fetch(base + normal)).status, 200);
const restrictedStatus = await new Promise((resolve, reject) => {
  get(base + normal, {headers:{Host:'shogi-is-luck.onrender.com'}}, res => {
    res.resume();
    resolve(res.statusCode);
  }).on('error', reject);
});
assert.equal(restrictedStatus, 404);

const browser = await chromium.launch(options);
try {
  for (const [profile, device] of [['desktop', {}], ['Pixel 7', devices['Pixel 7']]]) {
    const page = await browser.newPage(device);
    try {
      await page.route(url => url.origin !== base, route => route.abort());
      await page.addInitScript(() => {
        window.trace = [];
        window.workers = [];
        const NativeWorker = window.Worker;
        window.Worker = class extends NativeWorker {
          constructor(url, options) {
            super(url, options);
            this.number = window.workers.push(this);
            this.path = new URL(url).pathname;
            this.record('created');
            this.addEventListener('message', ({data}) => this.record('received', data));
          }
          record(type, data) {
            window.trace.push({type,path:this.path,worker:this.number,data});
          }
          postMessage(data, ...options) {
            this.record('sent', data);
            return super.postMessage(data, ...options);
          }
          terminate() {
            this.record('terminated');
            return super.terminate();
          }
        };
      });
      await page.goto(base, {waitUntil:'domcontentloaded'});
      await page.waitForFunction(() => typeof kickCPU === 'function');
      await page.evaluate(async () => {
        window.toUsi = (await import('/ai/rsshogi-position.mjs')).toUsi;
        window.fixture = () => {
          newGame();
          mode = 'cpu';
          localSide = 1;
          g.board = Array(81).fill(null);
          const back = ['L','N','S','G','K','G','S','N','L'];
          for (let col = 0; col < 9; col++) {
            g.board[col] = piece(back[col], 1);
            g.board[18+col] = piece('P', 1);
            g.board[54+col] = piece('P', 0);
            g.board[72+col] = piece(back[col], 0);
          }
          g.board[10] = piece('R', 1);
          g.board[16] = piece('B', 1);
          g.board[64] = piece('B', 0);
          g.board[70] = piece('R', 0);
          g.turn = 0;
          g.testMode = true;
          g.testTriggered = true;
        };
      });

      async function play(budget, withHole, first = false) {
        const prepared = await page.evaluate(async ({budget, withHole, first}) => {
          const offset = window.trace.length;
          if (first) {
            window.fixture();
            warmCpuEngine();
            await (await cpuEnginePromise).init();
            g.started = true;
          }
          window.SHOGILUCK_RSSHOGI_BUDGET = budget;
          if (withHole) {
            const square = [40,39,41,31,49].find(i => !g.board[i]);
            if (square === undefined) throw Error('No empty fixture square');
            g.holes = [square];
          } else g.holes = [];
          if (!first && !applyMove(getLegal(g, 1)[0], 1)) throw Error('Fixture reply rejected');
          const legal = getLegal(g, 0).map(move => ({usi:window.toUsi(move),from:move.from,to:move.to}));
          if (first) kickCPU();
          return {offset, legal, session:g.session, step:g.steps+1};
        }, {budget, withHole, first});
        await page.waitForFunction(({session, step}) => g.session === session && (g.steps >= step || g.over), prepared, {timeout:20000});
        const actual = await page.evaluate(offset => ({trace:window.trace.slice(offset), last:g.lastMove, steps:g.steps}), prepared.offset);
        assert.equal(actual.steps, prepared.step);
        const path = withHole ? obstacle : normal;
        const sent = actual.trace.find(entry => entry.type === 'sent' && entry.path === path && entry.data.command === 'go');
        assert.ok(sent, profile + ' did not search with ' + path);
        assert.equal(sent.data.movetime_ms, budget);
        const received = actual.trace.find(entry => entry.type === 'received' && entry.worker === sent.worker && entry.data.id === sent.data.id && entry.data.event === 'bestmove');
        assert.ok(received?.data.ok, 'missing real Worker result: ' + JSON.stringify(actual.trace.map(entry=>[entry.type,entry.path,entry.data?.command,entry.data?.error])));
        const {bestmove, depth, nodes, elapsed_ms} = received.data.result;
        assert.ok(prepared.legal.some(move => move.usi === bestmove && move.from === actual.last.from && move.to === actual.last.to));
        const positions = actual.trace.filter(entry => entry.type === 'sent' && entry.worker === sent.worker && entry.data.command === 'position');
        assert.equal(positions.at(-1).data.holes?.length ?? 0, withHole ? 1 : 0);
        log('legal-cpu-move', {profile,path,budget,bestmove,depth,nodes,elapsed_ms,worker:sent.worker});
        return {worker:sent.worker, session:prepared.session, trace:actual.trace};
      }

      const low = await play(100, false, true);
      assert.equal((await play(500, false)).worker, low.worker);
      assert.equal((await play(1500, false)).worker, low.worker);
      const blocked = await play(500, true);
      assert.equal(blocked.session, low.session);
      assert.ok(blocked.trace.some(entry => entry.type === 'terminated' && entry.worker === low.worker));
      const restored = await play(500, false);
      assert.equal(restored.session, low.session);
      assert.notEqual(restored.worker, low.worker);
      assert.ok(restored.trace.some(entry => entry.type === 'terminated' && entry.worker === blocked.worker));
      log('switch-and-release', {profile,workers:[low.worker,blocked.worker,restored.worker]});

      await page.evaluate(() => {
        window.cancelOffset = window.trace.length;
        window.oldSession = g.session;
        window.SHOGILUCK_RSSHOGI_BUDGET = 1500;
        if (!applyMove(getLegal(g, 1)[0], 1)) throw Error('Cancellation reply rejected');
      });
      await page.waitForFunction(() => window.trace.slice(window.cancelOffset).some(entry => entry.type === 'sent' && entry.data.command === 'go'), null, {timeout:12000});
      const cancellation = await page.evaluate(() => {
        const sent = window.trace.slice(window.cancelOffset).find(entry => entry.type === 'sent' && entry.data.command === 'go');
        const worker = window.workers[sent.worker-1];
        const alreadyReplied = window.trace.some(entry => entry.type === 'received' && entry.worker === sent.worker && entry.data.id === sent.data.id && entry.data.event === 'bestmove');
        const oldHandler = worker.onmessage;
        newGame();
        window.staleAttempt = () => oldHandler({data:{id:sent.data.id,ok:true,event:'bestmove',result:{bestmove:'7g7f'}}});
        return {worker:sent.worker,id:sent.data.id,alreadyReplied,replaced:g.session!==window.oldSession};
      });
      assert.equal(cancellation.alreadyReplied, false);
      assert.equal(cancellation.replaced, true);
      await page.waitForFunction(worker => window.trace.some(entry => entry.type === 'terminated' && entry.worker === worker), cancellation.worker);
      await page.evaluate(() => window.staleAttempt());
      await page.waitForTimeout(1650);
      assert.deepEqual(await page.evaluate(({worker,id}) => ({
        steps:g.steps,
        staleReply:window.trace.some(entry => entry.type === 'received' && entry.worker === worker && entry.data.id === id && entry.data.event === 'bestmove'),
        engineReleased:cpuEnginePromise===null,
      }), cancellation), {steps:0,staleReply:false,engineReleased:true});
      log('cancel-and-ignore-stale-result', {profile,oldWorker:cancellation.worker,id:cancellation.id});
      await play(100, false, true);
      log('profile-pass', {profile});
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
}
