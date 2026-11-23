let engine;

function unwrap(response) {
  if (!response.ok) throw Error(response.error);
  return response;
}

self.onmessage = async ({data:message}) => {
  const {id,command} = message;
  const reply = value => self.postMessage({id,command,ok:true,...value});
  try {
    if (command === 'init') {
      const {MiniEngine} = await import(message.moduleUrl);
      engine = await MiniEngine.create(message.wasm ?? message.url);
      unwrap(engine.request({command:'load_embedded'}));
      unwrap(engine.request({command:'configure',hash_mb:message.hash_mb ?? 16,threads:1}));
      reply({});
      return;
    }
    if (!engine) throw Error('initialize first');
    if (command === 'position') {
      unwrap(engine.request({command:'set_position',sfen:message.sfen,moves:message.moves ?? []}));
      reply({});
    } else if (command === 'new_game') {
      unwrap(engine.request({command}));
      reply({});
    } else if (command === 'go') {
      const {movetime_ms,nodes,depth = 64} = message;
      if (movetime_ms === undefined && nodes === undefined) throw Error('search requires a time or node bound');
      const result = unwrap(engine.request({command:'search',depth,movetime_ms,nodes})).result;
      // The synchronous C API blocks this Worker until the search completes.
      // To cancel in progress, the caller terminates this Worker instance.
      reply({event:'bestmove',result});
    } else if (command === 'dispose') {
      engine.dispose();
      engine = undefined;
      reply({});
    } else {
      throw Error(`Unsupported command ${command}`);
    }
  } catch (error) {
    self.postMessage({id,command,ok:false,error:error.message});
  }
};
