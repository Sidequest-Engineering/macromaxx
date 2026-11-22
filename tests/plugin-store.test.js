import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Actions } from '../electron/actions.js';
import { liveKey } from '../shared/visuals.js';
import { mergePluginStatus, parseStoreReference, dispatchPluginKeyEvent, storeDataDirectory, createPluginStore } from '../electron/plugin-store.js';
import { createDeckView, finishDeckPress } from '../electron/deck-view.js';

test('disabled activation reports its reason without loading or deleting retired authority data', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mmx-disabled-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.mkdir(path.join(directory, 'electron'));
  await fs.writeFile(path.join(directory, 'electron/plugin-store-config.json'), JSON.stringify({ enabled: false, reason: 'Production key custody is pending.' }));
  await fs.mkdir(path.join(directory, 'plugin-store'));
  await fs.writeFile(path.join(directory, 'plugin-store/keep'), 'retired data');
  const store = await createPluginStore({ app: { isPackaged: true, getPath: () => directory, getAppPath: () => directory, getVersion: () => '0.1.0' }, dialog: {}, getWindow: () => null, getState: () => ({ profiles: [] }), changed: () => {}, report: error => { throw error; } });
  t.after(() => store.close());
  assert.equal(store.snapshot().configured, false);
  assert.equal(store.snapshot().disabledReason, 'Production key custody is pending.');
  assert.equal(await fs.readFile(path.join(directory, 'plugin-store/keep'), 'utf8'), 'retired data');
});

test('pinned root and endpoints isolate installed plugins, settings and metadata caches', () => {
  const config = { enabled: true, root: { signed: { keys: { a: 'test-key' }, version: 1 }, signatures: [] }, metadataUrl: 'https://example.org/test/metadata/', targetsUrl: 'https://example.org/test/targets/' };
  const selected = storeDataDirectory('/data', config);
  assert.match(selected, /^\/data\/plugin-stores\/[a-f0-9]{64}$/);
  assert.notEqual(selected, '/data/plugin-store');
  assert.equal(storeDataDirectory('/data', { ...config, root: { signatures: [], signed: { version: 1, keys: { a: 'test-key' } } } }), selected);
  assert.notEqual(storeDataDirectory('/data', { ...config, root: { ...config.root, signed: { version: 2 } } }), selected);
  assert.notEqual(storeDataDirectory('/data', { ...config, metadataUrl: 'https://example.org/production/metadata/' }), selected);
  assert.notEqual(storeDataDirectory('/data', { ...config, targetsUrl: 'https://cdn.example.org/targets/' }), selected);
  assert.notEqual(storeDataDirectory('/data', { enabled: false }), selected);
});

test('action runner forwards only trusted key context to plugin execution', async () => {
  let context;
  const actions = new Actions({ plugins: { execute: async (_id, _config, _signal, c) => { context = c; return {}; } }, native: { handles: () => false }, log: () => {}, status: () => {}, updateKey: () => {} });
  await actions.execute({ id: 'key1', label: 'Key', actions: [{ type: 'plugin', pluginId: 'store:example--counter:count', config: '{}' }] });
  assert.deepEqual(context, { keyId: 'key1', long: false });
});

test('physical keyUp is enqueued before the action chain execute event', async () => {
  const events = [];
  const store = { keyEvent: (_key, event) => { events.push(event); return Promise.resolve(); } };
  const key = { id: 'key1', label: 'Counter', actions: [{ type: 'plugin', pluginId: 'store:example--counter:count', config: '{}' }] };
  const actions = new Actions({ plugins: { execute: async () => { events.push('execute'); } }, native: { handles: () => false }, log: () => {}, status: () => {}, updateKey: () => {} });
  dispatchPluginKeyEvent(store, key, 'keyUp', error => { throw error; });
  await actions.execute(key);
  assert.deepEqual(events, ['keyUp', 'execute']);
});

test('native holds are released even when the deck consumes the physical key-up', async () => {
  let released = false;
  const hold = Promise.resolve(() => { released = true; });
  await finishDeckPress({ hold }, true, error => { throw error; }).hold;
  assert.equal(released, true);
});

test('a delayed action chain cannot mount a deck view after its workspace generation ends', async () => {
  const controls = [0, 1, 2, 3, 4].map(index => ({ index, row: 0, column: index, feedbackType: 'lcd' }));
  const view = createDeckView({ render() {}, report: assert.fail, dispatch() {} });
  let called = false;
  const actions = new Actions({ plugins: {
    execute(_id, config, _signal, context) {
      called = true;
      assert.ok(context.deckEntry, 'the generation is captured once at action-chain start');
      view.apply('test', { keys: [] }, { ...context.deckEntry, event: 'execute', config });
    },
  }, native: { handles: () => false }, log: (level, _, message) => { assert.notEqual(level, 'error', message); }, status() {} });
  const pending = actions.execute({
    id: 'launch', actions: [{ type: 'delay', ms: 10 }, { type: 'plugin', pluginId: 'store:test--opencode:open' }],
  }, false, view.entry(controls));
  view.closeForLifecycle();
  await pending;
  assert.equal(called, true);
  assert.equal(view.read(), null);
});

test('physical plugin events cannot bypass incomplete imported credentials', () => {
  const invocations = [];
  const key = { id: 'key1', actions: [{ type: 'plugin', pluginId: 'store:example--counter:count', config: '{}', missingCredentials: ['config'] }] };
  for (const event of ['keyDown', 'keyUp']) dispatchPluginKeyEvent({ keyEvent: () => invocations.push(event) }, key, event, () => {});
  assert.deepEqual(invocations, []);
});

test('store display is transient and status merge preserves native provider fields', () => {
  const key = { id: 'key1', label: 'Saved', color: '#ffffff' };
  const native = { obs: { connected: true }, native: { plugins: [{ id: 'keyboard' }], visuals: { other: { active: true } } } };
  const merged = mergePluginStatus(native, { key1: { label: 'Live', color: '#86efac' } }, { configured: false });
  assert.equal(merged.obs.connected, true); assert.deepEqual(merged.native.plugins, [{ id: 'keyboard' }]);
  assert.equal(merged.native.visuals.other.active, true);
  assert.equal(liveKey(key, merged).color, '#86efac'); assert.equal(liveKey(key, merged).label, 'Live');
  assert.equal(key.label, 'Saved'); assert.equal(key.color, '#ffffff');
  assert.deepEqual(parseStoreReference('store:example--counter:count'), { id: 'example--counter', actionId: 'count' });
  assert.equal(parseStoreReference('hello'), null);
  assert.throws(() => parseStoreReference('store:../escape:count'));
});
