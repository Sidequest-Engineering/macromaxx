import { open } from 'node:fs/promises';
import { isIP } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { OpenCode } from '@opencode/client';
import { fallback, Service } from '@opencode/client/service';
import { validateOpenCodeSnapshot } from '@macromaxx/plugin-sdk/contracts';

const SESSION_ID = /^ses[A-Za-z0-9_-]{1,125}$/;
const PRIORITY = { question: 0, permission: 1, retry: 2, running: 3, unknown: 4 };
const OUTCOMES = new Set(['succeeded', 'failed', 'interrupted']);
const SESSION_PAGE_SIZE = 50;
const SESSION_PAGE_BUDGET = 4;
const ACTIVE_SCAN_BUDGET = 256;
const EVENTS = [
  'session.status', 'session.idle', 'session.execution.started', 'session.execution.succeeded',
  'session.execution.failed', 'session.execution.interrupted', 'session.retry.scheduled',
  'session.created', 'session.deleted', 'session.renamed', 'session.archived', 'session.unarchived',
  'permission.asked', 'permission.replied', 'form.created', 'form.replied', 'form.cancelled',
];
const empty = connection => ({ connection, active: [], recent: [], activeTruncated: false });
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const safeTitle = title => [...(typeof title === 'string' ? title : '')
  .replace(/[\p{Cc}\p{Bidi_Control}\p{Surrogate}]/gu, ' ').replace(/\s+/g, ' ').trim()]
  .slice(0, 80).join('') || 'Unbenannte Session';

function loopback(value) {
  const url = new URL(value);
  const host = url.hostname;
  const local = host === '[::1]' || (isIP(host) === 4 && host.startsWith('127.'));
  if (!['http:', 'https:'].includes(url.protocol) || !local || url.username || url.password ||
    url.pathname !== '/' || url.search || url.hash) throw new Error('Invalid OpenCode local service origin.');
  return url;
}

async function readLimitedJson(response, maximum) {
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`OpenCode HTTP ${response.status}`);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) throw new Error('OpenCode response exceeded its limit.');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function readRegistration() {
  const file = await open(fallback(), 'r').catch(error => {
    if (error.code !== 'ENOENT') throw error;
  });
  if (!file) return;
  try {
    if (!(await file.stat()).isFile()) throw new Error('Invalid OpenCode registration.');
    const buf = Buffer.alloc(8193);
    const { bytesRead } = await file.read(buf, 0, buf.length, 0);
    if (bytesRead === buf.length) throw new Error('OpenCode registration exceeds its limit.');
    return JSON.parse(buf.toString('utf8', 0, bytesRead));
  } finally {
    await file.close();
  }
}

// The upstream service discovery probes with the process-global fetch. Keep
// that credentialed first request under the same origin/redirect policy as all
// subsequent calls while using the SDK registration path and auth format.
export async function discoverRegisteredOpenCode({ signal, registration = readRegistration, fetcher = fetch }) {
  const info = await registration();
  if (!info || signal.aborted) return;
  const base = loopback(info.url);
  if (!Number.isSafeInteger(info.pid) || info.pid <= 0 ||
    (info.password !== undefined && (typeof info.password !== 'string' || info.password.length > 4096)))
    throw new Error('Invalid OpenCode registration.');
  const endpoint = { url: base.origin, auth: info.password === undefined ? undefined :
    { type: 'basic', username: 'opencode', password: info.password } };
  const response = await fetcher(new URL('/api/info', base), {
    method: 'GET', headers: Service.headers(endpoint), redirect: 'error',
    signal: AbortSignal.any([signal, AbortSignal.timeout(1500)]),
  }).catch(() => undefined);
  if (!response?.ok) {
    await response?.body?.cancel().catch(() => {});
    return;
  }
  const server = await readLimitedJson(response, 16384);
  const version = typeof server?.version === 'string' && /^2\.(\d+)\.(\d+)$/.exec(server.version);
  if (!version || +version[1] < 3 || (+version[1] === 3 && +version[2] < 2) ||
    server.pid !== info.pid || (info.version && info.version !== server.version)) return;
  return endpoint;
}

export function normalizeOpenCodeSessions({
  records, active, pendingQuestions = new Set(), pendingPermissions = new Set(),
  liveStatuses = new Map(), assistantRetry = new Map(), now = Date.now(),
}) {
  const activeRows = [], recent = [];
  for (const record of records) {
    const { id, outcome } = record;
    if (!SESSION_ID.test(id) || record.time?.archived !== undefined) continue;
    const isActive = Object.hasOwn(active, id);
    const live = liveStatuses.get(id);
    const retryAt = assistantRetry.get(id);
    const status = pendingQuestions.has(id) ? 'question' : pendingPermissions.has(id) ? 'permission'
      : isActive ? (
        live === 'retry' || (Number.isFinite(retryAt) && retryAt > now && live !== 'busy') ? 'retry'
          : live === 'busy' || (active[id]?.type === 'running' && retryAt !== false) ? 'running' : 'unknown'
      ) : OUTCOMES.has(outcome) ? outcome : outcome == null ? 'idle' : 'unknown';
    const row = { id, title: safeTitle(record.title), updatedAt: Math.max(0, Number.isFinite(record.time?.updated) ? record.time.updated : 0), status };
    (isActive || status === 'question' || status === 'permission' ? activeRows : recent).push(row);
  }
  const newest = (a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id);
  activeRows.sort((a, b) => PRIORITY[a.status] - PRIORITY[b.status] || newest(a, b));
  recent.sort(newest);
  return { active: activeRows.slice(0, 128), recent: recent.slice(0, SESSION_PAGE_SIZE), activeTruncated: activeRows.length > 128 };
}

function boundedEvents(response) {
  if (!response.body || !response.ok) return response;
  let line = 0;
  const limited = new TransformStream({
    transform(chunk, controller) {
      for (const byte of chunk) {
        if (byte === 10) line = 0;
        else if (++line > 128 * 1024) throw new Error('OpenCode event exceeds its limit.');
      }
      controller.enqueue(chunk);
    },
  });
  return new Response(response.body.pipeThrough(limited), { headers: response.headers, status: response.status });
}

async function chunked(values, mapper, signal) {
  for (let i = 0; i < values.length; i += 8) {
    signal.throwIfAborted();
    await Promise.all(values.slice(i, i + 8).map(mapper));
  }
}

export async function watchOpenCodeSessions({
  signal, onSnapshot, fetcher = fetch, discover = options => discoverRegisteredOpenCode({ ...options, fetcher }),
  makeClient = OpenCode.make, now = Date.now,
}) {
  let previous;
  const emit = snapshot => {
    if (signal.aborted) return;
    const key = JSON.stringify(snapshot);
    if (key !== previous) { previous = key; onSnapshot(validateOpenCodeSnapshot(snapshot)); }
  };
  emit(empty('loading'));
  while (!signal.aborted) {
    const attempt = new AbortController();
    const run = AbortSignal.any([signal, attempt.signal]);
    try {
      const endpoint = await discover({ signal: run });
      if (!endpoint) { emit(empty('offline')); await delay(2500, undefined, { signal }); continue; }
      const base = loopback(endpoint.url);
      const headers = Service.headers(endpoint);
      const get = async (route, query, max = 256 * 1024) => {
        const url = new URL(route, base);
        if (query) url.search = new URLSearchParams(query);
        const response = await fetcher(url, {
          method: 'GET', headers, redirect: 'error',
          signal: AbortSignal.any([run, AbortSignal.timeout(1750)]),
        });
        return readLimitedJson(response, max);
      };
      const service = makeClient({ baseUrl: base.origin, headers, fetch: async (input, options) => {
        const url = new URL(input instanceof Request ? input.url : input);
        if (url.origin !== base.origin || url.pathname !== '/api/event' ||
          (options?.method || (input instanceof Request ? input.method : 'GET')) !== 'GET')
          throw new Error('Invalid OpenCode event request.');
        url.searchParams.delete('types');
        for (const type of EVENTS) url.searchParams.append('types', type);
        const request = input instanceof Request ? new Request(url, input) : url;
        return boundedEvents(await fetcher(request, { ...options, redirect: 'error' }));
      } });
      const statuses = new Map();
      let revision = 0;
      const stream = (async () => {
        try {
          for await (const event of service.event.subscribe({ types: EVENTS, signal: run })) {
            if (run.aborted) break;
            const id = event.data?.sessionID;
            if (SESSION_ID.test(id)) {
              const status = event.type === 'session.status' ? event.data.status?.type
                : event.type === 'session.retry.scheduled' ? 'retry'
                  : event.type === 'session.execution.started' ? 'busy' : undefined;
              if (status === 'busy' || status === 'retry') {
                statuses.set(id, { status, until: event.data?.status?.next ?? event.data?.at });
                if (statuses.size > 256) statuses.delete(statuses.keys().next().value);
              } else if (event.type.startsWith('session.execution.') || event.type === 'session.status' ||
                event.type === 'session.idle' || event.type === 'session.deleted') statuses.delete(id);
            }
            revision++;
          }
        } catch { /* The next iteration reconnects and retrieves a fresh snapshot. */ }
        if (!run.aborted) { emit(empty('error')); attempt.abort(); }
      })();
      let synced = -1, last = -Infinity;
      try {
        while (!run.aborted) {
          if (synced === revision && now() - last < 3000) {
            await delay(350, undefined, { signal: run });
            continue;
          }
          synced = revision;
          last = now();
          const foreground = await get('/api/session/active');
          if (!isObject(foreground?.data)) throw new Error('Invalid OpenCode session response.');
          const ids = Object.keys(foreground.data);
          if (ids.some(id => !SESSION_ID.test(id))) throw new Error('Invalid OpenCode session identifier.');
          const activeIds = ids.slice(0, ACTIVE_SCAN_BUDGET);
          const records = new Map();
          let cursor;
          for (let page = 0; page < SESSION_PAGE_BUDGET; page++) {
            const query = { archived: 'false', limit: String(SESSION_PAGE_SIZE),
              ...(cursor ? { cursor } : { order: 'desc' }) };
            const latest = await get('/api/session', query, 1024 * 1024);
            if (!Array.isArray(latest?.data) ||
              latest.data.some(item => !isObject(item) || !SESSION_ID.test(item.id)))
              throw new Error('Invalid OpenCode session response.');
            for (const item of latest.data.slice(0, SESSION_PAGE_SIZE)) records.set(item.id, item);
            cursor = latest.cursor?.next;
            if (cursor == null) break;
            if (typeof cursor !== 'string' || !cursor || cursor.length > 4096)
              throw new Error('Invalid OpenCode session cursor.');
          }
          await chunked(activeIds.filter(id => !records.has(id)), async id => {
            const row = (await get(`/api/session/${id}`).catch(() => null))?.data;
            records.set(id, row?.id === id ? row : { id });
          }, run);
          const pendingQuestions = new Set(), pendingPermissions = new Set(), assistantRetry = new Map();
          const requests = await Promise.allSettled([
            chunked([...records.keys()], async id => {
              const [forms, permissions] = await Promise.all([
                get(`/api/session/${id}/form`), get(`/api/session/${id}/permission`),
              ]);
              if (!Array.isArray(forms?.data) || !Array.isArray(permissions?.data))
                throw new Error('Invalid OpenCode requests.');
              if (forms.data.some(form => form?.sessionID === id)) pendingQuestions.add(id);
              if (permissions.data.some(permission => permission?.sessionID === id)) pendingPermissions.add(id);
            }, run),
            chunked(activeIds.filter(id => !statuses.has(id)), async id => {
              const result = await get(`/api/session/${id}/message`, { type: 'assistant', limit: '1', order: 'desc' })
                .catch(() => undefined);
              if (!Array.isArray(result?.data)) assistantRetry.set(id, false);
              else if (!result.data[0]?.time?.completed && Number.isFinite(result.data[0]?.retry?.at))
                assistantRetry.set(id, result.data[0].retry.at);
            }, run),
          ]);
          if (requests.some(result => result.status === 'rejected')) throw new Error('OpenCode pending state unavailable.');
          run.throwIfAborted();
          const liveStatuses = new Map([...statuses].filter(([, value]) => value.status !== 'retry' || !value.until || value.until > now())
            .map(([id, value]) => [id, value.status]));
          const result = normalizeOpenCodeSessions({
            records: [...records.values()], active: foreground.data, pendingQuestions, pendingPermissions,
            liveStatuses, assistantRetry, now: now(),
          });
          emit({ connection: 'ready', ...result,
            activeTruncated: result.activeTruncated || ids.length > ACTIVE_SCAN_BUDGET || !!cursor });
          await delay(1000, undefined, { signal: run });
        }
      } finally {
        attempt.abort();
        await stream;
      }
    } catch {
      if (!signal.aborted) emit(empty('error'));
    } finally { attempt.abort(); }
    if (!signal.aborted) await delay(1500, undefined, { signal }).catch(() => {});
  }
}
