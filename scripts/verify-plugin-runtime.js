import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Optional entry argument lets this same test import the built ASAR, not source.
const entry = process.argv[2] ? pathToFileURL(path.resolve(process.argv[2])).href : '@macromaxx/plugin-runtime';
const { PluginProcess } = await import(entry);
const manifest = { schemaVersion: 1, id: 'smoke--plugin', publisher: 'smoke', name: 'Smoke', description: 'Packaged runtime verification', version: '1.0.0', apiVersion: 1, appVersion: '>=0.1.0 <1.0.0', runtime: 'standard', platforms: ['linux', 'darwin', 'win32'], permissions: ['display:write'], actions: [{ id: 'smoke', name: 'Smoke' }] };
const worker = new PluginProcess({ manifest, code: `var __pluginModule={default:{actions:{smoke:{execute(e,a){a.display.set({label:'Packaged OK'});a.log(typeof process+','+typeof require+','+typeof fetch);}}}}};` });
try {
  const result = await worker.dispatch('execute', { actionId: 'smoke' });
  assert.equal(result.display.label, 'Packaged OK');
  assert.deepEqual(result.messages, ['undefined,undefined,undefined']);
  console.log('Plugin worker/WASM smoke passed using ' + entry);
} finally { worker.close(); }
