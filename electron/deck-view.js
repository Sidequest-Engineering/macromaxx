import { validateDeckFrame, validateDeckLayout } from '@macromaxx/plugin-sdk/contracts';

const backKey = Object.freeze({ title: '↩', subtitle: 'Zurück', color: '#49425c' });
const loading = Object.freeze({ connection: 'loading', active: [], recent: [], activeTruncated: false });

export function finishDeckPress(record, consumed, report) {
  const hold = record?.hold?.then(release => release()).catch(report);
  return { hold, consumed: consumed || !!hold };
}

export function createDeckView({
  render, restore = render, report, dispatch, startSource, onOpen = () => {}, canAnimate = () => true,
  setTimer = setTimeout, clearTimer = clearTimeout,
}) {
  let mode = null, restoring, generation = Symbol();
  const down = new Map();
  const redraw = () => Promise.resolve(render()).catch(report);

  const layout = controls => {
    const slots = (controls || []).filter(control => control.feedbackType === 'lcd')
      .map(({ index, row, column }) => ({ index, row, column }))
      .sort((a, b) => a.row - b.row || a.column - b.column);
    if (slots.length < 5) return;
    const backIndex = slots.find(slot => slot.row === slots.at(-1).row).index;
    return validateDeckLayout({ slots, backIndex });
  };
  const entry = controls => {
    if (mode || restoring) return;
    const deck = layout(controls);
    return deck && { generation, deck };
  };
  function close(owner) {
    if (owner !== undefined && owner !== mode?.owner) return;
    generation = Symbol();
    const old = mode;
    mode = null;
    if (!old) return;
    old.controller.abort();
    clearTimer(old.timer);
    const token = Symbol();
    restoring = token;
    const finish = () => {
      if (restoring !== token) return;
      restoring = undefined;
      generation = Symbol();
    };
    try {
      const pending = restore();
      if (pending?.then) void Promise.resolve(pending).catch(report).finally(finish);
      else finish();
    } catch (error) { report(error); finish(); }
  }
  function schedule(current) {
    if (mode !== current || current.timer || current.animating || !current.animate ||
      ![...current.keys.values()].some(key => key.icon === 'spinner')) return;
    current.timer = setTimer(async () => {
      current.timer = undefined;
      if (mode !== current) return;
      if (canAnimate()) {
        current.animating = true;
        current.phase = (current.phase + 1) % 8;
        try { await redraw(); } finally { current.animating = false; }
      }
      schedule(current);
    }, canAnimate() ? 167 : 1000);
    current.timer?.unref?.();
  }
  function paint(current, frame) {
    current.keys = new Map(frame.keys.map(key => [key.slot, key]));
    current.keys.set(current.context.deck.backIndex, backKey);
    current.animate = frame.animate !== false;
    if (!current.animate || !frame.keys.some(key => key.icon === 'spinner')) {
      clearTimer(current.timer);
      current.timer = undefined;
      current.phase = 0;
    }
    void redraw();
    schedule(current);
  }
  function flush(current) {
    if (mode !== current || current.busy || (!current.dirty && !current.taps.length)) return;
    const keyAction = current.taps.shift();
    current.dirty = false;
    current.busy = true;
    Promise.resolve().then(() => {
      if (mode !== current) return;
      return dispatch(current.owner, {
        ...current.context, keyAction, opencode: current.snapshot,
      }, current.controller.signal);
    }).catch(error => {
      if (mode === current) { report(error); close(); }
    }).finally(() => {
      current.busy = false;
      flush(current);
    });
  }
  function apply(owner, frame, context) {
    if (!frame) { close(owner); return; }
    if (context.event === 'deckRender') {
      if (mode?.owner === owner && mode.context.generation === context.generation)
        paint(mode, validateDeckFrame(frame, mode.context.deck));
      return;
    }
    if (context.event !== 'execute' || mode || restoring || context.generation !== generation) return;
    validateDeckFrame(frame, context.deck);
    generation = Symbol();
    const current = {
      owner, context: { ...context, generation }, controller: new AbortController(),
      phase: 0, taps: [], snapshot: frame.watch === 'opencode' ? loading : undefined,
    };
    mode = current;
    onOpen();
    paint(current, frame);
    if (frame.watch === 'opencode' && startSource) {
      const onSnapshot = snapshot => {
        if (mode !== current) return;
        current.snapshot = snapshot;
        current.dirty = true;
        flush(current);
      };
      Promise.resolve(startSource({ signal: current.controller.signal, onSnapshot })).catch(() => {
        onSnapshot({ connection: 'error', active: [], recent: [], activeTruncated: false });
      });
    }
  }
  function tap(index) {
    if (!mode) return !!restoring;
    if (index === mode.context.deck.backIndex) close();
    else {
      const action = mode.keys.get(index)?.action;
      if (action && mode.taps.length < 8) {
        mode.taps.push(action);
        flush(mode);
      }
    }
    return true;
  }
  function pressDown(index) {
    down.set(index, generation);
    return !!mode || !!restoring;
  }
  function pressUp(index) {
    const started = down.get(index);
    down.delete(index);
    if (started !== generation) return !!mode || !!restoring || started !== undefined;
    return tap(index);
  }
  return { layout, entry, apply, tap, pressDown, pressUp, read: () => mode, close, closeForLifecycle: () => close() };
}
