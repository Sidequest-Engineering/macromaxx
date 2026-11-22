# OpenCode Session Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show questions, permissions, running work, and recently used OpenCode sessions together on the deck's first page.

**Architecture:** Keep the existing SDK snapshot shape: MacroMaxx produces disjoint `active` (working or awaiting input) and `recent` arrays; the dashboard combines them for its default view. The host discovers pending input independently of the foreground list, using read-only OpenCode endpoints and session metadata.

**Tech Stack:** Electron main process, OpenCode V2, JavaScript and TypeScript, Node test runner, MacroMaxx plugin SDK.

**Spec:** `docs/superpowers/specs/2026-11-22-opencode-session-overview-design.md`

## Global Constraints

- No text analysis of chat messages. The deck remains read-only: no answers, permission grants, or changes to OpenCode.
- Only the configured local OpenCode V2 service; preserve loopback, request budgets and abort-on-close.
- Keep the existing SDK contract, grants, spinner and pagination. No new permission or protocol version.
- Only open structured requests change the attention status; the history still lists recently used sessions without an open request or foreground work.
- Run GitNexus impact before edits and graph change analysis before commits. Do not overwrite the published `1.0.0` asset.

## Review Focus

- A pending form predates opening the dashboard and its session is outside the scanned history but belongs to a known project — Task 1.
- A new request arrives for a session absent from both scans; resolving one of multiple requests must not clear the indicator prematurely — Task 1.
- Session archives/deletions and partial reads must not show stale requests or wipe all other rows — Task 1.
- Idle and failed sessions appear on the default view without a spinner and do not crowd critical requests off the first page — Task 2.
- Switching to history and back must clamp against the actual filtered list, including when a request is resolved — Task 2.

### Task 1: Find outstanding input outside foreground work

**Files:** `electron/opencode-sessions.js`, `tests/opencode-sessions.test.js`.

**Interfaces:** Keep `watchOpenCodeSessions({ signal, onSnapshot, fetcher, discover, makeClient, now })` and `normalizeOpenCodeSessions(...)` unchanged for callers. `OpenCodeSnapshot.active` contains structured pending forms, permission requests, retry and foreground statuses; `recent` remains disjoint. Pass only session ID, title, update time and normalized status downstream.

- [ ] Add failing `lists an already-open question outside the history window for a known location` and `tracks a late form for an unlisted session until the last request settles` tests. Expect `active[0].status === 'question'` for an idle session found through a location snapshot or a `form.created` event. Model two pending form IDs, then assert the row remains `question` until the last form clears. Assert chat/API contents are not in the snapshot.
- [ ] Add failing `an unavailable location or a deleted request session does not hide other live sessions` test. Expect a still-running session to remain visible; a deleted/archived session must leave the queue. Mark partial data with the existing `activeTruncated` flag rather than treating it as a complete list.
- [ ] Run `node --test tests/opencode-sessions.test.js`; expected: new state/visibility assertions fail, existing tests pass.
- [ ] Extend `watchOpenCodeSessions` to combine foreground IDs and paged session records with pending lookups at the documented location-scoped form and permission endpoints for known locations. Limit the additional scan to 16 distinct locations per cycle, keep per-session lookups as a fallback and as the canonical check for bounded candidates learned from `form.created` or `permission.asked`. Form events carry the new form under `event.data.form`; permission events use `event.data.sessionID`. Hydrate missing candidate records through `GET /api/session/{id}`, ignore missing/archived records and prune resolved event candidates. Never use events as permanent proof that input is still pending.
- [ ] Run the targeted tests, full app tests, and the isolated real OpenCode V2 smoke test for a pending form. Expected: all pass; watch abort and origin tests still pass. Run GitNexus graph analysis before committing.

### Task 2: Combine rows on the default view

**Files:** `../mm-opencode-plugin/src/layout.ts`, `../mm-opencode-plugin/test/layout.test.js`, `../mm-opencode-plugin/README.md`, `tests/opencode-deck-integration.test.js`.

**Interfaces:** `buildDashboard(deck, snapshot, view, page, animate)` and `clampPage(deck, snapshot, view, page)` retain their existing signatures. Both use the same row selection: the default uses active plus recent, the history uses recent only.

- [ ] Add failing layout tests asserting `? Rückfrage` and `! Freigabe` precede `Läuft`, and idle/terminal states also appear in the default view without a spinner. On a five-key deck, the final page must clamp to the last combined row; switching to history shows no active rows and clamps against the history length.
- [ ] Extend the signed-bundle integration test to expect `Completed` in the default view as well as in history, and assert `Question`/`Running` are absent from history. Verify Back still works. Run layout tests and the explicit bundle integration test; expect the new default-view assertions to fail against `1.0.0`.
- [ ] Extract one row-selection helper in `layout.ts`; sort attention states ahead of working and recent rows, and sort the recent group by update time. Reuse that selection for `clampPage`. Keep the existing labels, colors and host-owned Back.
- [ ] Run `npm run typecheck` and `npm test` in the plugin, build a separate candidate bundle from its manifest, and run the signed-bundle integration test with that artifact. Verify the existing public `1.0.0` asset is untouched. Prepare a new version for registry submission separately from live publication.
- [ ] Run GitNexus graph analysis before committing the plugin layout and MacroMaxx integration changes.
