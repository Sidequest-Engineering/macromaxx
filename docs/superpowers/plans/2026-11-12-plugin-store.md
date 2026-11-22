# Secure Plugin Store Implementation Plan

> **For agentic workers:** Use executing-plans inline. Track each task below and verify changes with tests.

**Goal:** Implement a locally verifiable SDK-to-publishing-to-installation pipeline and Electron integration without enabling unsafe plugin execution or deploying infrastructure.

**Architecture:** Four sibling packages, renderer-free QuickJS/WASM workers, a main-process store manager and TUF-authenticated static registry. Build app dependencies from local package tarballs so installers do not depend on sibling paths.

**Tech Stack:** Node.js ESM, TypeScript declarations, QuickJS Emscripten, TUF JS, esbuild, existing Electron/React/Vite/node:test.

**Spec:** `docs/superpowers/specs/2026-11-12-plugin-store-design.md`

## Global Constraints
- No new repositories, remote publication, production secrets or moving existing project.
- Existing profiles/native providers preserved; privileged store plugins fail closed.
- Package/protocol v1, bounded package and VM, no archive extraction or install scripts.
- TUF root is pinned by operator, never TOFU or renderer-configurable.
- Keep changes uncommitted for user inspection; do not commit unrelated existing untracked files.

## Review Focus
- Guest code cannot acquire Node globals via host values or import hooks.
- Stale metadata and revocation block execution, including after restart.
- Failed installation or concurrent operations preserve last working pointer/settings.
- Permission escalation cannot use opt-in unattended updates.
- Packaged Electron resolves worker and WASM without workspace siblings.

### Task 1: SDK and package contracts
Files: sibling `macromaxx-plugin-sdk/{package.json,src/*,test/*}`.
Interfaces: validateManifest, encodePackage, decodePackage, definePlugin, SDK CLI build.
- [x] Write and run failing validation/package/CLI tests.
- [x] Implement strict portable contracts, declarations, schema and deterministic builder.
- [x] Run SDK suite and typecheck example fixture.

### Task 2: Isolated runtime
Files: sibling `macromaxx-plugin-runtime/src/{guest,worker,process}.js`, tests.
Interfaces: PluginProcess(package).dispatch(event, payload, signal), close().
- [x] Write and run failures for action/display/settings, Node access, unknown action, loops, async, cancellation.
- [x] Implement bounded WASM guest and IPC supervisor, pure JSON only.
- [x] Run runtime tests.

### Task 3: Authenticated registry
Files: sibling `macromaxx-plugin-registry/{src,test,.github/workflows}`, runtime trust module.
Interfaces: registry validation, importPackage, publishRepository; TrustedRegistry.refresh/catalog/download.
- [x] Write and run failures for hash mismatch, duplicate/version replacement, fake publisher, TUF tamper/expiry.
- [x] Implement TUF publication using official models/client and protected workflow templates.
- [x] Run real local HTTP TUF fixture tests, no production keys.

### Task 4: Transactional store
Files: runtime `src/store.js`, store tests.
Interfaces: PluginStore.init/snapshot/refresh/install/setEnabled/setAutoUpdate/uninstall/execute.
- [x] Write failures for grants, escalation, corrupted package, failed activation, reload, revocation, concurrency.
- [x] Implement content-addressed storage and atomic pointers with serialized mutation queue.
- [x] Verify full publish/install/execute/update/revoke fixture.

### Task 5: Electron integration and example
Files: app `electron/plugin-store.js`, main/preload/plugins integration, feature UI; sibling example; app package tarballs.
- [x] Write app adapter tests before implementation; analyze graph impact for existing symbols before editing.
- [x] Add trusted main-process consent, installed action dispatch, transient displays, store UI and opt-in background updates.
- [x] Build example and local package tarballs; install locked dependencies with no sibling links.
- [x] Run original app suite, formatting, renderer build, SDK/runtime/registry tests and typecheck.

### Task 6: Review and handoff
- [x] Fresh read-only security/integration review; fix significant findings with regression tests.
- [x] Record verification and unresolved platform/hosting limitations.
- [x] Document development, publishing, key rotation/revocation, recovery and deployment.

## Execution ledger

- Baseline: existing app npm test exited 0 (log /tmp/opencode/macromaxx-baseline.log).
- Ruling: work in requested sibling layout and existing checkout on feature branch, without creating worktrees or repositories; user's requested locations are preserved.
- Ruling: keep Electron-bound lifecycle; daemon requirement was never selected. Independent daemon deferred, not implied complete.
- Ruling: use strict no-system-access v1 and disable privileged releases rather than guessing terminal/network policy.
- Ruling: all production deployment/key operations remain explicit operator actions. No commits made automatically.
- Final review: independent read-only reviewer found four Important issues; none was an established engine escape. Reproduced automatic-permission and startup-cancellation races, missing metadata-only publication input and missing authenticated signing history before fixes.
- Final: fixed stale automatic permission decisions — queued manual permission reduction vs unattended update test RED→GREEN; candidate selection and permission/opt-in validation now occur inside the serialized transaction.
- Final: fixed post-cancel startup/probe races — paused real package IO and update download tests RED→GREEN; tracked probes/installations, guarded await/commit boundaries and immediate cancellation epochs.
- Final: fixed metadata-only publication — zero-approved (last release revoked) transfer-input test RED→GREEN; artifact handoff always carries a manifest.
- Final: fixed missing publication history — clean-directory/history tampering/permanent revocation tests RED→GREEN; registry state is a signed target, subsequent publications require authenticated preceding metadata and exactly incremented version. CI restores latest successful main workflow artifact and fails closed if it is unavailable.
- Final: Ruling: keyUp/execute ordering finding regraded Important — ordinary release handlers could overwrite execution feedback; synchronous enqueue helper and event-order regression test added. Cost if wrong: incorrect release/chain ordering; covered by test.
- Final: minor (deferred): graceful store deactivation; narrowed SDK contract explicitly states normal disable/uninstall currently force-stop. Cost: no cleanup callback; v1 owns no OS resources.
- Final: Ruling: OS installers/signing/USB/hosting/key custody/engine exploit resistance were outside the reviewer's executed checks — remain explicit external-release gates, not claims of verification. Cost if skipped: unsupported platform or security assumptions reaching users.
- Final: fixed retained-artifact publishing availability — absent upstream source regression RED→GREEN; CI now reuses hash-verified bytes from authenticated prior publications and fetches only newly approved hashes.
- Final: fixed imported-credential event bypass — physical keyDown/keyUp regression RED→GREEN; both dispatcher and adapter now preserve existing missing-credential execution gates. Graph status UNKNOWN for the newly added (not yet indexed) helper; text confirmation found only the two intended main-process event callers.
- Final verification: SDK 3/3, runtime 18/18, registry 6/6, example 1/1 plus TypeScript typecheck. App 193 passing, 2 existing opt-in skips, 0 failures. Total 221 passed / 2 skipped.
- Final verification: formatting, renderer build, Linux unpacked packaging/native-module checks and actual ASAR-to-unpacked worker/WASM smoke passed. All shipped SDK/runtime JavaScript files match sibling source byte-for-byte. New workflow YAML parsed locally; remote Actions/deployment unexecuted. npm audit: zero reported vulnerabilities in app/runtime/registry.
- Verification note: a first parallel runtime check overlapped registry dependency replacement and failed module resolution; after installs finished, full runtime rerun passed. A new replay test initially required the wrong rejection wording; it now asserts the actual TUF rollback error plus fail-closed execution. Package source comparison excludes intentionally omitted TypeScript declaration files and compares executable JavaScript.
- Task 1–6: complete for the documented v1 scope. Existing checkout and all sibling sources remain in place, uncommitted; no external deployment or repository initialization.
