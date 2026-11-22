import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as host from '../electron/deck-view.js';

const controls = Array.from({ length: 6 }, (_, index) => ({
  index, row: Math.floor(index / 3), column: index % 3, feedbackType: 'lcd',
}));
const frame = {
  keys: [{ slot: 0, title: 'OpenCode', color: '#16483e' }, { slot: 2, title: 'Weiter', color: '#333333', action: 'next' }],
};
function setup(options = {}) {
  assert.equal(typeof host.createDeckView, 'function');
  const actions = [];
  const view = host.createDeckView({ render() {}, report: assert.fail, dispatch: (...args) => actions.push(args), ...options });
  return { view, actions };
}
const opening = view => ({ ...view.entry(controls), actionId: 'open', keyId: 'launch', config: {}, event: 'execute' });

test('Back is host-owned and always restores the workspace without invoking the guest', () => {
  const { view, actions } = setup();
  const entry = opening(view);
  assert.equal(entry.deck.backIndex, 3);
  view.apply('plugin', frame, entry);
  assert.equal(view.read().keys.get(3).subtitle, 'Zurück');
  assert.equal(view.pressDown(3), true);
  assert.equal(view.pressUp(3), true);
  assert.equal(view.read(), null);
  assert.equal(actions.length, 0);
});

test('modal keys consume presses and only dispatch their own opaque navigation actions', async () => {
  const { view, actions } = setup();
  view.apply('plugin', frame, opening(view));
  for (const index of [0, 1, 2]) {
    assert.equal(view.pressDown(index), true);
    assert.equal(view.pressUp(index), true);
  }
  assert.equal(view.tap(1), true, 'simulated input is consumed as well');
  await Promise.resolve();
  assert.equal(actions.length, 1);
  assert.equal(actions[0][0], 'plugin');
  assert.equal(actions[0][1].keyAction, 'next');
});

test('a release from before opening or closing a view cannot reach workspace input', () => {
  const { view, actions } = setup();
  assert.equal(view.pressDown(2), false);
  view.apply('plugin', frame, opening(view));
  view.close();
  assert.equal(view.pressUp(2), true);
  assert.equal(view.pressDown(2), false);
  assert.equal(view.pressUp(2), false);
  assert.deepEqual(actions, []);
});

test('closed generations cannot reopen a deck or accept late source updates', () => {
  let deliver, sourceSignal;
  const { view, actions } = setup({ startSource: args => { deliver = args.onSnapshot; sourceSignal = args.signal; } });
  const old = opening(view);
  view.apply('plugin', { ...frame, watch: 'opencode' }, old);
  view.closeForLifecycle();
  assert.equal(sourceSignal.aborted, true);
  deliver({ connection: 'offline', active: [], recent: [], activeTruncated: false });
  view.apply('plugin', frame, old);
  assert.equal(view.read(), null);
  assert.deepEqual(actions, []);
});

test('spinner caps cadence and schedules no additional frame while a USB draw is pending', async () => {
  const pending = new Map();
  const drawn = [];
  let resolve;
  const { view } = setup({
    setTimer(fn, delay) { assert.ok(delay >= 167); pending.set(fn, fn); return fn; },
    clearTimer(id) { pending.delete(id); },
    render() {
      drawn.push(view.read()?.phase);
      if (view.read()?.phase === 1) return new Promise(done => { resolve = done; });
    },
  });
  view.apply('plugin', { keys: [{ ...frame.keys[0], icon: 'spinner' }] }, opening(view));
  const [tick] = pending.keys();
  pending.delete(tick); const rendered = tick();
  assert.deepEqual(drawn, [0, 1]);
  assert.equal(pending.size, 0);
  view.close();
  resolve(); await rendered;
  assert.equal(pending.size, 0);
  assert.deepEqual(drawn, [0, 1, undefined]);
});

test('workspace input stays consumed until Back restores the device', async () => {
  let restore;
  const { view } = setup({ render: () => view.read() ? undefined : new Promise(resolve => { restore = resolve; }) });
  view.apply('plugin', frame, opening(view));
  view.tap(3);
  assert.equal(view.read(), null, 'normal artwork can now be rendered');
  assert.equal(view.tap(2), true, 'simulated workspace taps are blocked too');
  assert.equal(view.pressDown(2), true);
  restore();
  await new Promise(setImmediate);
  assert.equal(view.pressUp(2), true, 'a key held through restoration is not replayed');
  assert.equal(view.tap(2), false);
});
