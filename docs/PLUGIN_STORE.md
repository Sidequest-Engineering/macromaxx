# Plugin Store integration

## What is implemented

- Sibling SDK, renderer-free QuickJS/WASM runtime, static TUF registry tooling and reference plugin.
- Main-process-only download/install/update/consent endpoints. No renderer-supplied trust roots or URLs.
- Store discovery/search/details, installation/removal, enable/disable, version/permission/error display and opt-in safe updates.
- Persistent isolated plugin processes, async guest actions, physical events, transient key appearance and plugin-scoped settings.
- Authenticated metadata/targets, SHA-256, bounded package format, atomic installation pointers, backup recovery and revocation checks.
- Existing native providers and local legacy plugin contract preserved. Local legacy plugins are **not sandboxed** and must be trusted.

The test channel is retired. The local store now connects to the independently pinned **production** authority at `https://sidequest-engineering.github.io/macromaxx-plugin-registry/metadata/` and `targets/`. Operator custody confirmation, the isolated governance App, actual signed bootstrap and a normal +1 renewal were verified before enabling this configuration. Fresh and persisted real clients authenticated the live empty catalog and retained immutable bytes. No root is downloaded opportunistically or accepted from renderer IPC. An empty verified catalog is not a connection error or a demo listing.

Each pinned-root/endpoint combination uses its own `userData/plugin-stores/<authority-sha256>/` for installed plugins, settings and metadata. The previous `userData/plugin-store/` is untouched and is not implicitly migrated. Real workspaces/profiles are unchanged. Restart the local app after changing configuration. Do not distribute this test root as production trust.

## Workspace layout and verification

Sibling components have separate Git repositories. The app remains in `macromaxx` on branch `feat/secure-plugin-store`; app integration changes remain local.

```sh
# From each SDK/runtime/registry directory:
npm ci --ignore-scripts
npm test
# Example:
npm ci --ignore-scripts
npm run typecheck
npm test
# App:
npm test
npm run format:check
npm run build
```

Runtime integration tests exercise real local TUF publication → refresh → install → execution → update → revoke. Test signing keys are generated temporarily, not committed or reused as production keys.

When editing sibling runtime/SDK source, refresh app snapshots explicitly:

```sh
npm run vendor:plugins
npm install --ignore-scripts ./vendor/plugin-packages/macromaxx-plugin-sdk-0.1.0.tgz ./vendor/plugin-packages/macromaxx-plugin-runtime-0.1.0.tgz
```

The registry/example also receive updated tarballs; refresh their lockfiles with explicit `npm install` paths. This is a development synchronization step, not a client installation step. Packaged apps do not refer to workspace siblings.

## Trust setup

Read `../macromaxx-plugin-registry/README.md`, `docs/KEY_CUSTODY.md`, `docs/GO_LIVE.md` and `docs/OPERATIONS.md`. Test online keys/workflow are retired. Production private keys never enter Git; only the three online roles enter the signing environment after operator-confirmed root custody/backup. The root private key never enters CI. The separate main-only governance audit uses a scoped GitHub App administrative token without exposing it to signing. EinCloudy's explicit PR-review exception permits self-merge, while independent PR/CI rules remain mandatory. Renewals run every six hours; timestamp/catalog expiry is 24 hours. Rebuild and sign the app for wider distribution; TUF is not a substitute for app code signing/notarization.

## Runtime boundaries

The Electron main process still owns USB/actions/profiles. Closing to tray retains it; quitting/crashing it stops controller and plugins. A standalone background daemon is not implemented. Key artwork still partly depends on the configuration renderer. Worker separation is not the same as a daemon or an OS sandbox.

Store assignments retain the existing portable `plugin` action type. A store action reference is `store:publisher--plugin:action`. Config fields reuse the existing editor. Plugin display changes are transient (not written to workspace); local legacy plugin display results retain their old persisted behavior.

Settings are unencrypted plugin-local non-secret JSON, separate from workspace exports and removed on uninstall. Known revocations disable execution; expired metadata fail closed. Downloads cannot add permissions without consent. Automatic updates are opt-in and cannot add rights. Forced shutdown/cancellation cannot guarantee guest deactivation hooks.

## Deliberate limitations and release gates

- Terminal, arbitrary network access, direct files, arbitrary plugin UI, native addons and privileged third-party runtimes are rejected, not falsely authorized by a dialog.
- Independent daemon, platform-specific OS containment, graceful deactivation hooks and threshold/offline signing automation need further agreed implementation.
- Version 1 uses the app's bundled plugin icon; custom publisher icon assets are not yet part of its intentionally narrow package format.
- Reviewed code may still be malicious. Engine/WASM vulnerabilities, local account compromise and unavailable offline revocation are residual risks.
- Production code uses pinned Actions, separated main-only governance/signing jobs, serialized publishing and authenticated history on `production-publication`. Old `gh-pages` is inactive test audit history. Actual bootstrap and normal renewal have succeeded; separate one-key-per-role signing is not a multi-person threshold. Pages is not administrator-proof immutable storage. External Healthchecks/notification services are deliberately deferred; internal signed health checks remain. Real48-hour operation and untested platforms are not certified by this activation.
- Validate Linux/Windows/macOS packaged workers, process shutdown, USB behavior and app signatures before external release. Linux unit/build results alone do not certify those platforms.

## OpenCode Sessions

MacroMaxx 0.2 adds a temporary, host-rendered view for LCD Stream Decks. A compatible OpenCode Sessions plugin adds the **OpenCode öffnen** action to the existing key editor. **Zurück** restores the original workspace, **Zuletzt** switches to recent outcomes, and the action's `animate` setting can turn off the busy spinner. An indicator for a question or permission is read-only; respond in OpenCode.

The two new plugin capabilities are independently authorized by the manifest. `deck:write` is limited to declarative key visuals and plugin-local navigation on the active view. `opencode:sessions:read` returns sanitized status data from the already-running registered local OpenCode V2 service, only while the view is open. It does not start a service or open a remote/standalone OpenCode server. Linux, OpenCode V2.3.2 or newer V2, and at least five LCD keys are required for this plugin.

New clients prefer the signed `catalog-v2.json` target. Registry publications retain a separate signed `catalog.json` for older permission validators. An invalid or unavailable advertised full catalog does not fall back to the legacy target.

To exercise a real plugin bundle with an ephemeral signed registry, set `MM_OPENCODE_PLUGIN_PACKAGE` to its `.mmxp` and `MM_OPENCODE_PLUGIN_REGISTRY` to the compatible registry checkout and run `node --test tests/opencode-deck-integration.test.js`. Optionally set `MM_OPENCODE_LEGACY_SDK` to the original SDK's `src/contracts.js` to check that the original parser accepts the old catalog but rejects the new capability manifest.

## Verification performed in this workspace

Production activation on 2026-11-13: registry39/39, runtime/TUF/store23/23 and app197passing/2existing skips. Formatting/build/native dependency checks and fresh Linux packaging passed. Both the source and actual ASAR app adapters authenticated the live production catalog with an independently pinned root using isolated temporary user data. The catalog is honestly empty; no test release was migrated into production.

Real production bootstrap `43410380590` and ordinary renewal `43410814812` succeeded: audit/import/sign/publish/deploy all green. A real packaged runtime client retained its v1 cache, authenticated live v2 anonymously, and compared all historical numbered metadata/target bytes unchanged against authenticated publication history. No root private key was read/uploaded; the operator explicitly confirmed offline custody and tested encrypted backup. The repository-only governance App was provisioned and its real token checked/revoked separately from signing.

The actual packaged-ASAR fixture harness (`../macromaxx-plugin-registry/scripts/verify-packaged-store.js`) verified permission denial, install/action, persisted store close/reopen, update retaining settings, and revocation blocking execution/reinstallation through real worker/WASM. It uses throwaway loopback keys/packages/state, not a production plugin or real workspace. Close/reopen in that harness is not a GUI restart; the local source app was separately restarted after enabling production config.

Earlier test-channel runs `43290804956`/`43291222593` and visual fixtures are historical verification only, not the current production authority. External Healthchecks services are deliberately omitted. Real48-hour stability, physical-device acceptance on all supported OSes, Windows/macOS installers and app code signing are not claimed. App integration/config changes remain local pending a separate coherent app commit/release; running this build is not publishing an installer.
