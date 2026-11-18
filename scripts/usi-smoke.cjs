// This checks the WebAssembly engine's USI identification command.
// This test does not load 11micro's evaluation weights or assess playing strength.
const fs = require('node:fs');
const path = require('node:path');
const createEngine = require('./yaneuraou.js');

(async () => {
  const wasmBinary = fs.readFileSync(path.join(__dirname, 'yaneuraou.wasm'));
  const engine = await createEngine({ wasmBinary });
  const result = engine.ccall('usi_command', 'number', ['string'], ['usi']);
  if (result !== 0) throw new Error('USI handshake failed (code: ' + result + ')');
  engine.terminate();
  process.exit(0);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
