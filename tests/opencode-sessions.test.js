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
