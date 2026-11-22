import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { PluginStore, TrustedRegistry } from '@macromaxx/plugin-runtime';
import { decodePackage } from '@macromaxx/plugin-sdk/contracts';
import { createDeckView } from '../electron/deck-view.js';

const bundle = process.env.MM_OPENCODE_PLUGIN_PACKAGE;
const registry = process.env.MM_OPENCODE_PLUGIN_REGISTRY;
const controls = Array.from({ length: 15 }, (_, index) => ({
  index, row: Math.floor(index / 5), column: index % 5, feedbackType: 'lcd',
}));

test('signed store installation opens the actual SDK plugin, receives status and restores Back', {
  skip: !bundle || !registry ? 'Set MM_OPENCODE_PLUGIN_PACKAGE and MM_OPENCODE_PLUGIN_REGISTRY for release acceptance.' : false,
}, async t => {
  const { createTrust, importPackage, publishRepository, sha256 } = await import(pathToFileURL(path.join(registry, 'src/repository.js')));
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mm-opencode-integration-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const bytes = await fs.readFile(bundle);
  const { manifest } = decodePackage(bytes);
  const release = { manifest, sha256: sha256(bytes), length: bytes.length, status: 'approved' };
  const trust = createTrust();
  await importPackage(dir, release, bytes);
  await publishRepository({
    directory: dir, registry: { schemaVersion: 1, publishers: [{ id: manifest.publisher, name: 'Test', github: 'test' }], releases: [release] },
    root: trust.root, keys: trust.keys, version: 1,
  });
  const server = createServer(async (req, res) => {
    if (!/^\/(?:metadata|targets)\/[a-z0-9./-]+$/i.test(req.url) || req.url.includes('..')) return res.writeHead(404).end();
    try { res.end(await fs.readFile(path.join(dir, req.url.slice(1)))); }
    catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = new TrustedRegistry({
    directory: path.join(dir, 'client'), metadataUrl: `${base}/metadata/`, targetsUrl: `${base}/targets/`,
    root: trust.root, allowLoopback: true,
  });
  let store, sourceSignal;
  const readout = [];
  const view = createDeckView({
    report: assert.fail,
    render() { readout.push([...view.read()?.keys.values() ?? []]); },
    dispatch: (id, context, signal) => store.execute(id, context.actionId, {}, signal, 'deckRender', context),
    startSource: ({ signal, onSnapshot }) => {
      sourceSignal = signal;
      onSnapshot({
        connection: 'ready', activeTruncated: false,
        active: [
          { id: 'ses_1', title: 'Question', status: 'question', updatedAt: 1 },
          { id: 'ses_2', title: 'Running', status: 'running', updatedAt: 2 },
        ],
        recent: [{ id: 'ses_3', title: 'Completed', status: 'succeeded', updatedAt: 3 }],
      });
    },
  });
  store = new PluginStore({
    directory: path.join(dir, 'store'), registry: client, appVersion: '0.2.0',
    onDeck: (id, frame, context) => view.apply(id, frame, context),
  });
  t.after(() => { view.close(); store.close(); });
  await store.init();
  if (process.env.MM_OPENCODE_LEGACY_SDK) {
    const { validateCatalog } = await import(pathToFileURL(process.env.MM_OPENCODE_LEGACY_SDK));
    const meta = JSON.parse(await fs.readFile(path.join(dir, 'metadata', '1.targets.json')));
    const catalog = async name => {
      const hash = meta.signed.targets[name].hashes.sha256;
      return JSON.parse(await fs.readFile(path.join(dir, 'targets', `${hash}.${name}`)));
    };
    assert.equal(validateCatalog(await catalog('catalog.json')).releases.length, 0);
    const extended = await catalog('catalog-v2.json');
    assert.throws(() => validateCatalog(extended), /permission/i);
  }
  await store.install(manifest.id, manifest.version, manifest.permissions);
  await store.execute(manifest.id, 'open', { keyId: 'launcher' }, undefined, 'execute', view.entry(controls));
  const waitFor = async predicate => {
    const deadline = Date.now() + 2500;
    while (!predicate() && Date.now() < deadline) await nextTurn();
    assert.ok(predicate());
  };
  await waitFor(() => readout.at(-1).some(key => key.title === 'Question' && key.subtitle === '? Rückfrage'));
  assert.ok(readout.at(-1).some(key => key.title === 'Running' && key.icon === 'spinner'));
  const [toggle] = [...view.read().keys].find(([, key]) => key.action === 'toggle');
  assert.equal(view.pressDown(toggle), true);
  assert.equal(view.pressUp(toggle), true);
  await waitFor(() => readout.at(-1).some(key => key.title === 'Completed' && key.subtitle === 'Erfolgreich'));
  assert.equal(view.tap(10), true);
  assert.equal(view.read(), null);
  assert.equal(sourceSignal.aborted, true);
});
