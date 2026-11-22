import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as source from '../electron/opencode-sessions.js';

const record = (name, outcome) => ({
  id: `ses_${name}`, title: name, projectID: 'proj_demo', cost: {}, tokens: {},
  time: { created: 1, updated: 2 }, location: { directory: '/private/canary' },
  outcome, metadata: { prompt: 'private-prompt' },
});
const empty = { data: [] };
const client = { event: { async *subscribe({ signal }) {
  assert.ok(signal, 'OpenCode 2.3.2 takes cancellation in the same options as the filters');
  if (!signal.aborted) await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
} } };

test('normalizes every session status, prioritizing questions and permissions over running and retry', () => {
  assert.equal(typeof source.normalizeOpenCodeSessions, 'function');
  const result = source.normalizeOpenCodeSessions({
    records: [
      ...['running', 'permission', 'question', 'retry', 'idle', 'unknown'].map(name => record(name)),
      record('succeeded', 'succeeded'), record('failed', 'failed'), record('interrupted', 'interrupted'),
    ],
    active: { ses_running: { type: 'running' }, ses_question: { type: 'running' }, ses_retry: { type: 'running' }, ses_unknown: { type: 'future' } },
    pendingQuestions: new Set(['ses_question']),
    pendingPermissions: new Set(['ses_question', 'ses_permission']),
    assistantRetry: new Map([['ses_retry', 10]]),
    now: 5,
  });
  assert.deepEqual(result.active.map(row => row.status), ['question', 'permission', 'retry', 'running', 'unknown']);
  assert.deepEqual(result.recent.map(row => row.status).sort(), ['failed', 'idle', 'interrupted', 'succeeded']);
  assert.deepEqual(Object.keys(result.active[0]).sort(), ['id', 'status', 'title', 'updatedAt']);
});

test('reads pending inputs for sessions outside the default location and restores an already scheduled retry', async () => {
  assert.equal(typeof source.watchOpenCodeSessions, 'function');
  const controller = new AbortController();
  const seen = [];
  const fetcher = async (url, request) => {
    const { pathname, searchParams } = new URL(url);
    assert.equal(request.redirect, 'error');
    if (pathname === '/api/session/active') return Response.json({ data: { ses_retry: { type: 'running' }, ses_form: { type: 'running' } } });
    if (pathname === '/api/session') return Response.json({ data: [record('form'), record('permission')], cursor: {} });
    if (pathname === '/api/session/ses_retry') return Response.json({ data: record('retry') });
    if (pathname === '/api/session/ses_form/form') return Response.json({ data: [{ id: 'form_demo', sessionID: 'ses_form', title: 'secret-form', fields: [] }] });
    if (pathname === '/api/session/ses_permission/permission') return Response.json({ data: [{ sessionID: 'ses_permission', resources: ['secret-resource'] }] });
    if (pathname === '/api/session/ses_retry/message') {
      assert.equal(searchParams.get('limit'), '1');
      return Response.json({ data: [{ type: 'assistant', retry: { at: 20, error: { secret: 'secret-error' } }, content: ['secret-assistant'] }] });
    }
    return Response.json(empty);
  };
  await source.watchOpenCodeSessions({
    signal: controller.signal, discover: async () => ({ url: 'http://127.0.0.1:4096' }),
    makeClient: () => client, fetcher, now: () => 10,
    onSnapshot(snapshot) {
      seen.push(snapshot);
      if (snapshot.connection !== 'loading') controller.abort();
    },
  });
  assert.deepEqual(seen.map(s => s.connection), ['loading', 'ready']);
  assert.deepEqual(seen[1].active.map(row => row.status), ['question', 'permission', 'retry']);
  assert.doesNotMatch(JSON.stringify(seen), /private-|secret-/);
});

test('rejects a non-loopback registration before making requests and does not treat a malformed snapshot as empty', async () => {
  for (const [url, status] of [['http://example.invalid:4096', 'error'], ['http://127.0.0.1:4096', 'error']]) {
    const controller = new AbortController();
    let calls = 0;
    const seen = [];
    await source.watchOpenCodeSessions({
      signal: controller.signal, discover: async () => ({ url }), makeClient: () => client,
      fetcher: async () => { calls++; return Response.json({ broken: true }); },
      onSnapshot(snapshot) { seen.push(snapshot.connection); if (snapshot.connection !== 'loading') controller.abort(); },
    });
    assert.deepEqual(seen, ['loading', status]);
    assert.equal(calls > 0, url.includes('127.0.0.1'));
  }
});

test('registration probe follows no redirect and keeps the credential at the pinned loopback origin', async () => {
  assert.equal(typeof source.discoverRegisteredOpenCode, 'function');
  const endpoint = await source.discoverRegisteredOpenCode({
    signal: new AbortController().signal,
    registration: async () => ({ url: 'http://127.0.0.1:4096', pid: 42, version: '2.3.2', password: 'local-token' }),
    fetcher: async (url, options) => {
      assert.equal(new URL(url).href, 'http://127.0.0.1:4096/api/info');
      assert.equal(options.redirect, 'error');
      return Response.redirect('https://example.invalid/');
    },
  });
  assert.equal(endpoint, undefined);
});

test('the real client sends a server-side event allowlist, not the full content stream', async () => {
  const controller = new AbortController();
  const requests = [];
  await source.watchOpenCodeSessions({
    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(3000)]),
    discover: async () => ({ url: 'http://127.0.0.1:4096' }),
    fetcher(input) {
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.pathname === '/api/event') {
        requests.push(url);
        return Promise.resolve(new Response(new ReadableStream({}), { headers: { 'content-type': 'text/event-stream' } }));
      }
      return Promise.resolve(Response.json({ data: url.pathname.endsWith('/active') ? {} : [], cursor: {} }));
    },
    onSnapshot(snapshot) { if (snapshot.connection !== 'loading') controller.abort(); },
  });
  const types = requests[0]?.searchParams.getAll('types') ?? [];
  assert.ok(types.includes('session.status'));
  assert.ok(types.includes('form.created'));
  assert.ok(!types.includes('session.text.delta'));
});

test('a full first page of active sessions does not hide inactive sessions on the next page', async () => {
  const controller = new AbortController();
  const seen = [];
  const head = Array.from({ length: 50 }, (_, i) => record(`active${i}`));
  const active = Object.fromEntries(head.map(row => [row.id, { type: 'running' }]));
  await source.watchOpenCodeSessions({
    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(3000)]),
    discover: async () => ({ url: 'http://127.0.0.1:4096' }), makeClient: () => client,
    fetcher: async input => {
      const url = new URL(input);
      if (url.pathname.endsWith('/active')) return Response.json({ data: active });
      if (url.pathname === '/api/session') return Response.json(url.searchParams.get('cursor') === 'second'
        ? { data: [record('older', 'succeeded')], cursor: { next: null } }
        : { data: head, cursor: { next: 'second' } });
      return Response.json(empty);
    },
    onSnapshot(snapshot) {
      if (snapshot.connection !== 'loading') { seen.push(snapshot); controller.abort(); }
    },
  });
  assert.deepEqual(seen[0]?.recent.map(row => row.status), ['succeeded']);
});

const form = (id, sessionID) => ({ id, sessionID, title: 'private question', fields: [] });

test('lists an already-open question outside the history window for a known location', async () => {
  const controller = new AbortController();
  const seen = [];
  await source.watchOpenCodeSessions({
    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(3000)]),
    discover: async () => ({ url: 'http://127.0.0.1:4096' }), makeClient: () => client,
    fetcher: async input => {
      const { pathname, searchParams } = new URL(input);
      if (pathname === '/api/session/active') return Response.json({ data: {} });
      if (pathname === '/api/session') return Response.json({ data: [record('newer')], cursor: {} });
      if (pathname === '/api/session/ses_older') return Response.json({ data: record('older', 'succeeded') });
      if (pathname === '/api/form' && searchParams.get('location[directory]') === '/private/canary')
        return Response.json({ data: [form('form_open', 'ses_older')], location: record('newer').location });
      return Response.json(empty);
    },
    onSnapshot(snapshot) {
      if (snapshot.connection !== 'loading') { seen.push(snapshot); controller.abort(); }
    },
  });
  assert.equal(seen[0]?.connection, 'ready');
  assert.deepEqual(seen[0].active.map(({ id, status }) => [id, status]), [['ses_older', 'question']]);
  assert.deepEqual(seen[0].recent.map(row => row.id), ['ses_newer']);
  assert.doesNotMatch(JSON.stringify(seen), /private/);
});

test('tracks a late form for an unlisted session until the last request settles', async () => {
  const controller = new AbortController();
  let sendEvent, pending = [], snapshots = [];
  const listen = { event: { async *subscribe({ signal }) {
    while (!signal.aborted) {
      const event = await new Promise(resolve => {
        sendEvent = resolve;
        signal.addEventListener('abort', () => resolve(null), { once: true });
      });
      if (event) yield event;
    }
  } } };
  await source.watchOpenCodeSessions({
    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(6000)]),
    discover: async () => ({ url: 'http://127.0.0.1:4096' }), makeClient: () => listen,
    fetcher: async input => {
      const { pathname } = new URL(input);
      if (pathname === '/api/session/active') return Response.json({ data: {} });
      if (pathname === '/api/session/ses_late/form') {
        const result = Response.json({ data: pending });
        if (pending.length === 2) queueMicrotask(() => {
          pending = pending.slice(1);
          sendEvent({ type: 'form.replied', data: { sessionID: 'ses_late', id: 'form_first' } });
        });
        if (pending.length === 1) queueMicrotask(() => {
          pending = [];
          sendEvent({ type: 'form.cancelled', data: { sessionID: 'ses_late', id: 'form_second' } });
        });
        return result;
      }
      if (pathname === '/api/session/ses_late') {
        const row = record('late');
        return Response.json({ data: { ...row, time: { ...row.time, updated: 3 + pending.length } } });
      }
      return Response.json(empty);
    },
    onSnapshot(snapshot) {
      if (snapshot.connection !== 'ready') return;
      snapshots.push(snapshot.active.map(row => row.status));
      if (snapshots.length === 1) {
        pending = [form('form_first', 'ses_late'), form('form_second', 'ses_late')];
        sendEvent({ type: 'form.created', data: { form: pending[0] } });
      } else if (snapshots.length === 4) controller.abort();
    },
  });
  assert.deepEqual(snapshots, [[], ['question'], ['question'], []]);
});

test('an unavailable location or a deleted request session does not hide other live sessions', async () => {
  const controller = new AbortController();
  const seen = [];
  await source.watchOpenCodeSessions({
    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(3000)]),
    discover: async () => ({ url: 'http://127.0.0.1:4096' }), makeClient: () => client,
    fetcher: async input => {
      const { pathname, searchParams } = new URL(input);
      if (pathname === '/api/session/active') return Response.json({ data: { ses_running: { type: 'running' } } });
      if (pathname === '/api/session') return Response.json({
        data: [record('running'), { ...record('other'), location: { directory: '/missing' } }], cursor: {},
      });
      if (pathname === '/api/session/ses_deleted' || (pathname === '/api/form' && searchParams.get('location[directory]') === '/missing'))
        return new Response(null, { status: 404 });
      if (pathname === '/api/form') return Response.json({ data: [form('form_stale', 'ses_deleted')] });
      if (pathname === '/api/session/ses_other/form') return new Response(null, { status: 404 });
      return Response.json(empty);
    },
    onSnapshot(snapshot) {
      if (snapshot.connection !== 'loading') { seen.push(snapshot); controller.abort(); }
    },
  });
  assert.equal(seen[0]?.connection, 'ready');
  assert.equal(seen[0].activeTruncated, true);
  assert.deepEqual(seen[0].active.map(({ id, status }) => [id, status]), [['ses_running', 'running']]);
});
