# MacroMaxx OpenCode Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A configurable key opens a read-only OpenCode V2 dashboard on the physical MacroMaxx Stream Deck.

**Architecture:** The signed standard plugin supplies a bounded deck frame using normalized session data; the Electron main process owns device input, animation, and credentialed OpenCode reads. The SDK adds two independent permissions; runtime validates IPC on both sides and rechecks store authorization before host application.

**Tech Stack:** Electron, JavaScript/TypeScript, QuickJS/WASM, `@opencode/client` 2.3.2, Node test runner, MacroMaxx SDK, `.mmxp`, TUF.

**Spec:** `docs/superpowers/specs/2026-11-22-mm-opencode-plugin-design.md`

## Global Constraints

- `deck:write` and `opencode:sessions:read` are independently consented.
- Linux-LCD, OpenCode ≥2.3.2, MacroMaxx ≥0.2.0 <0.3.0.
- ≤50 recent sessions; at most six animation frames per second with one render in flight.
- Only a registered local V2 service; read-only, no arbitrary socket destinations, no guest Node/I/O, no persistent snapshots.
- Before modifying existing code, run upstream GitNexus impact in the owning repository and report callers/processes/risk. If `UNKNOWN`, confirm with source references; warn on `HIGH`/`CRITICAL`. Before committing, verify graph change scope and do not accept partial or truncated output as a pass. Use one isolated workspace per existing repo; sibling dependency pins must point at the intended worktree artifact, never silently at primary checkout sources.
- Keep review, signing, publisher enrollment and production publication separate from implementation; do not sign with live keys or add a fabricated source or publisher entry.

## Review Focus

- Key down before a view switch and key up afterward must not trigger the underlying workspace action — task 2.
- A late snapshot/frame after Back, revocation or reconnect must not reopen the overlay — tasks 1 and 2.
- An existing pending form or permission on a different project and a retry already scheduled before launch must be visible — task 3.
- A malicious/corrupt frame or session payload must not escape validation or reach underlying host actions — tasks 1–3.
- Old clients must not silently lose access to the catalog when the registry acknowledges the new plugin — task 5.

### Task 1: Versioned capability contracts and sandbox bridge

**Files:** `../macromaxx-plugin-sdk/src/{contracts.js,manifest.schema.json,index.d.ts,deck.js}`, `../macromaxx-plugin-sdk/test/{contracts.test.js,deck.test.js}`, `../macromaxx-plugin-runtime/src/{guest.js,process.js,output.js,store.js}`, `../macromaxx-plugin-runtime/test/{runtime.test.js,store.test.js}`.

**Interfaces:** SDK exports `validateDeckLayout(layout)`, `validateDeckFrame(frame, layout?)`; `DeckLayout = { slots: { index: number, row: number, column: number }[], backIndex: number }`; `DeckFrame = { keys: { slot: number, title: string, subtitle?: string, color: string, icon?: 'spinner', action?: string }[], animate?: boolean, watch?: 'opencode' }`. Frame bounds: 128 slots, unique indices, title/subtitle ≤32 Unicode code points and no control/bidi characters, six-digit colors, action IDs match `^[a-z][a-z0-9-]{0,47}$`, no placement on the host Back slot. `api.deck.open(frame)` on `execute`, which receives an optional `event.deck`; `api.deck.set(frame)` on `deckRender`. `deckRender({ actionId, config, keyId, deck, keyAction? }, api)` is optional and used for both refresh and modal key navigation. `api.opencode.sessions()` reads only the current dispatch snapshot from the host and only with the relevant grant. `onDeck` host context carries entry/update kind, action ID, configuration, key ID and the host generation identifier; a frame update cannot change the source attached at open.

- [ ] Add failing `deckFrameRejectsExtraFieldsAndDuplicateSlots`, `opencodeCapabilityRequiresExplicitGrant`, and `renderEventCannotMountAfterClose` tests. Assert malformed frames fail in worker/supervisor, store denies a missing grant, old actions still work, and a canceled dispatch never reaches the modal output callback.
- [ ] Run SDK and runtime `npm test`; observe failures caused by missing capability support.
- [ ] Add manifest/SDK contract and independently checked worker/supervisor JSON output. Gate both input inclusion and output at `PluginStore.execute()`; use `onDeck(id, frame, context)` on success and `onDeck(id, null, null)` on lifecycle stop, preserving existing trust/generation checks. Keep `watch` orthogonal and require both grants for it; activation/probes never receive geometry or session data. Keep host modal token/signal out of the guest payload.
- [ ] Run SDK and runtime `npm test`; require existing and new cases to pass. Build `0.2.0` SDK/runtime archives without overwriting the existing `0.1.0` snapshots.
- [ ] Run applicable graph checks before committing the two scoped changes separately.

### Task 2: Temporary deck mode and hardware rendering

**Files:** `electron/deck-view.js`, `electron/deck-view-art.js`, `electron/{main.js,devices.js,plugin-store.js}`, `tests/{deck-view.test.js,display.test.js,plugin-store.test.js}`.

**Interfaces:** `createDeckView({ render, report, dispatch, startSource, setTimer, clearTimer })` exposes `layout(controls)`, `apply(owner, frame, context)`, `pressDown(index)`, `pressUp(index)`, `read()`, `close(owner?)` and `closeForLifecycle()`. It exposes `null` when inactive, otherwise Host Back plus the validated frame. `renderDeckViewKey(key, control, phase)` returns host-built RGB artwork from escaped text, bounded colors and fixed spinner geometry.

- [ ] Add failing `backAlwaysRestoresWorkspace`, `modalKeyNeverRunsUnderlyingAction`, `releaseOfPreModalPressIsConsumed`, `frameFromClosedGenerationCannotReopen`, `noStaleUsbFrameAfterDisconnect`, and `spinnerFramesStopAndDontQueue` tests; cover both physical and existing simulated press paths.
- [ ] Run `node --test tests/deck-view.test.js tests/display.test.js tests/plugin-store.test.js`; observe missing mode/art boundary failures.
- [ ] Route input and visual geometry through a single generation-bound view in `electron/main.js`; host handles Back synchronously even with a blocked guest, swallows stale releases, and dispatches only opaque actions belonging to the current frame. Integrate device-sourced rows/columns, LCD-only slots, existing render revisions, normal render restoration, screensaver suppression of animation, and all shutdown/profile/store teardown hooks. Render fixed SVG internally with escaped text through the existing Sharp pipeline; never accept SVG from a plugin. Cache bounded frame visuals, avoid unchanged USB writes, and cap spinner cadence at six frames/sec.
- [ ] Run the targeted tests and full MacroMaxx test suite; verify without renderer availability using the fake USB deck.
- [ ] Run graph change analysis before committing the scoped host changes.

### Task 3: OpenCode source, privacy boundary and status normalization

**Files:** `electron/opencode-sessions.js`, `electron/plugin-store.js`, `package.json`, `package-lock.json`, `tests/opencode-sessions.test.js`, SDK `src/index.d.ts`.

**Interfaces:** `watchOpenCodeSessions({ signal, onSnapshot, discover, makeClient, now }) => Promise<void>`; `normalizeOpenCodeSessions({ records, active, pendingQuestions, pendingPermissions, liveStatuses, assistantRetry, now }) => { active, recent, activeTruncated }`; worker receives `OpenCodeSnapshot = { connection: 'loading' | 'ready' | 'offline' | 'error', active: SessionRow[], recent: SessionRow[], activeTruncated: boolean }`. Each `SessionRow` contains only `id`, `title`, `updatedAt`, `status`; permitted statuses are `question`, `permission`, `retry`, `running`, `idle`, `succeeded`, `failed`, `interrupted`, `unknown`. Bound payload to the worker's existing JSON quota; at most 128 active rows and 50 recent rows, prioritizing pending human input before truncation.

- [ ] Add failing `mapsAllStatusesAndPrioritizesHumanInput`, `findsPendingInputOutsideDefaultLocation`, `recoversRetryAlreadyInProgress`, `doesNotLeakPathOrResponseContent`, `rejectsNonLoopbackAndRedirect`, `malformedIsNotEmpty`, and `abortStopsStreamAndRefresh` tests. Use mock OpenCode 2.3.2 contract data with prompt/credential canaries and a late-event scenario.
- [ ] Run `node --test tests/opencode-sessions.test.js`; observe missing implementation failures.
- [ ] Pin the documented Node client; discover without starting and verify origin is loopback before authorization. Seed from `/api/session/active` and `/api/session?archived=false`; hydrate missing active IDs and use session-owned `/form` and `/permission` endpoints so lookups are not default-location scoped. Subscribe only to statuses, session lifecycle, forms and permissions; borrow retry metadata only as needed, with request timeouts, size/concurrency limits and a bounded scan. After a stream loss, clear live inferences and refresh before presenting fresh data; stop delivery on abort. Apply the spec's precedence and never forward raw API fields or errors to the guest.
- [ ] Run targeted tests, an authorized read-only smoke check against installed local V2 if connected (log counts, not titles), and the full app suite.
- [ ] Run graph change analysis before committing integration.

### Task 4: Independent plugin and end-to-end package test

**Files:** `../mm-opencode-plugin/{.gitignore,README.md,package.json,package-lock.json,manifest.json,tsconfig.json,src/index.ts,src/layout.ts,test/layout.test.js}`, MacroMaxx `tests/opencode-deck-integration.test.js`.

**Interfaces:** `buildDashboard(layout: DeckLayout, snapshot: OpenCodeSnapshot, view: 'active' | 'recent', page: number, animate: boolean): DeckFrame`. Launcher action ID `open`; modal action IDs `prev`, `next`, `toggle`; manifest has `deck:write` and `opencode:sessions:read` only. Start in `active`, page zero on every mount. `animate` is a non-secret action setting, enabled unless configured otherwise.

- [ ] Add failing layout tests: five and 15 buttons, all status labels/colors, stable sorting, safe clipping/empty/error labels, active truncation indicator, no spinner outside `running`, switch to recent and last-page clamping when a session disappears. Define end-to-end assertion: a real `.mmxp` installed by an ephemeral TUF registry, opened through a mock physical key, shows a question and running spinner, switches to recent, then Back restores the underlying key without executing it.
- [ ] Run plugin tests and targeted app integration test; observe missing layout/package failures.
- [ ] Implement `definePlugin` and the pure layout, vendor exact SDK archive with lockfile and documentation, then build and validate with the SDK CLI. Bridge the new app's vendored dependencies without overwriting old published archives. Use a development-only publisher profile until a real registry namespace is approved.
- [ ] Run plugin typecheck, tests, deterministic rebuild/byte comparison, app integration and all SDK/runtime/app tests, then app format/build/plugin runtime verification. Verify physical hardware separately if available; do not claim hardware or multiple OSes based on mock tests.
- [ ] Run graph analysis before commits in the affected app/plugin repos.

### Task 5: Registry handoff without breaking older apps

**Files:** `../macromaxx-plugin-registry/{package.json,package-lock.json,vendor/,docs/submissions/mm-opencode-plugin.md,registry.json,sources/}`; release descriptors are conditional.

**Interfaces:** registry `node src/cli.js request <exact.mmxp>` emits the real digest, length and full manifest. `sources/<actual-sha256>.json` pins authorized publisher repo, full commit SHA, version tag, exact asset.

- [ ] Add a registry validation fixture using the new SDK, assert the release descriptors are byte-exact. Test catalog decoding using both the old SDK snapshot and the new one; exercise and record old-client rejection as a publication gate.
- [ ] Run registry tests against the current validator and observe new-permission rejection.
- [ ] Pin the reviewed new SDK alongside the retained historical snapshot locally. Document reproducible packaging and review in the registry. Stage public enrollment and descriptors only after the approved publisher, actual tagged source, exact public artifact and old-client transition are established. The registry remains independently deployable; no dummy descriptors or live keys.
- [ ] Run registry `npm test` and `npm run validate`; verify the old and new client release channels cannot serve incompatible catalogs. If the transition is not decided, hand back the built package and registry submission draft and report precisely what is missing for live publication.
- [ ] Run graph change analysis before committing, and link any actual registry PR through the harness.
