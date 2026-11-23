import { readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2];
const input = readFileSync(file,'utf8');
const anchor = "      unwrap(engine.request({command:'configure',hash_mb:message.hash_mb ?? 16,threads:1}));\n      reply({});";
if (input.split(anchor).length !== 2) throw new Error('Expected exactly one configure/init-reply anchor');
const patch = `      unwrap(engine.request({command:'configure',hash_mb:message.hash_mb ?? 16,threads:1}));
      const prime = new URL(self.location.href).searchParams.get('startupPrime');
      if (!prime) {
        reply({});
      } else {
        if (prime !== 'time' && prime !== 'nodes') throw new Error('Unsupported startup prime');
        const start = performance.now();
        unwrap(engine.request({command:'set_position',sfen:'startpos',moves:['7g7f']}));
        const limit = prime === 'time' ? {movetime_ms:100} : {nodes:256};
        const probe = unwrap(engine.request({command:'search',depth:2,...limit})).result;
        unwrap(engine.request({command:'new_game'}));
        reply({result:{depth:probe.depth,nodes:probe.nodes,primeMs:performance.now()-start}});
      }`;
writeFileSync(file,input.replace(anchor,patch));
