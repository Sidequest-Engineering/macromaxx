# Plugin ecosystem implementation design

Approved direction: user requested implementation of the architecture discussed in the conversation. Existing application stays in place. No remote deployment, repository creation, signing identity enrollment or publishing is authorized by this work.

## Architecture and alternatives

The Electron main process currently owns USB, profiles and actions. Keep that lifecycle in this increment; extracting a standalone daemon is a separate product decision. Native bundled providers remain trusted components. Legacy user plugins keep their documented full-user-permission execution path and are never treated as store plugins.

Alternatives considered: unrestricted Node workers (not acceptable as standard sandbox); dedicated Chromium renderers (contradicts the strict renderer-free preference); embedded JS engine in separate processes (selected implementation default). Use QuickJS compiled to WebAssembly with no host imports, no module loader, bounded heap, instruction deadline and supervisor process termination. This is an engine/WASM boundary plus crash isolation, not an OS sandbox against a compromised worker host. No shell/network/filesystem capabilities in the initial SDK. Unknown capabilities and privileged runtimes fail closed.

## Components

Sibling SDK, runtime, registry and example directories; no new .git directories. SDK specifies manifest/protocol version 1 and bundles portable JS/TS using esbuild. Runtime owns validation, TUF client, transactional installation and worker supervision. Registry owns publisher policy, immutable content-addressed artifacts and TUF publication. App integrates through main-process-only operations and extends existing plugin UI.

Packages are bounded UTF-8 JSON envelopes (.mmxp), exactly format/manifest/code, with a single JS bundle. No archive paths, links, arbitrary assets or install scripts. Limits: 2 MiB package, 1 MiB code, 32 actions, 32 fields, 16 MiB guest heap, 2 second event deadline and 5 second parent deadline. Manifest IDs use publisher--name, stable semver, explicit app semver range, SDK API 1, platforms and permissions. SDK permits display:write, settings:read, settings:write only. Settings are plugin-scoped non-secret JSON, quota 64 KiB. Configuration is supplied for the assigned action only.

## Trust and publication

Registry JSON is validated against publisher ownership. Releases bind ID/version to hash/length; changes to existing mappings fail validation. PR jobs run without secrets and never execute downloaded code. Reviewed packages are imported as artifacts/sha256/HASH.mmxp; publication rehashes those exact bytes. TUF authenticates catalog/artifacts with pinned offline root and separate role keys, expirations and rollback protection. Root keys never enter CI. Deployment to R2 is an operator step, with bucket locks, separate administration credentials and tested create-only semantics. Locks are administrator-removable; signatures remain necessary.

Client accepts only configured HTTPS endpoints; loopback HTTP is allowed only in explicit developer fixtures. No renderer-controlled registry URLs, roots or package paths. Without configured trust the store is disabled. Refresh is required to establish trusted catalog state; expired/unavailable metadata blocks execution rather than inventing an offline grace policy. Revocation disables execution and terminates live workers once learned, not instantaneously on offline machines.

## Installation/update behavior

Serialize mutations, verify TUF target and SHA-256, validate package against signed release manifest, probe activation before pointer change, keep content-addressed packages and atomically replace private state. Failure preserves the old pointer/settings. No downgrade, no rollback to revoked artifacts. Disable/uninstall terminate workers; uninstall removes installation pointer, not user workspace assignments. Explicit main-process confirmation grants permissions. Automatic updates are opt-in per plugin, only approved compatible versions and no added permissions; escalation waits for confirmation. Privileged plugins remain unsupported, not falsely sandboxed.

## SDK lifecycle

Persistent per-plugin process and guest context; activate, keyDown, keyUp, execute and deactivate dispatch. Action registration is manifest-bound. Display results are transient, settings persist independently of workspace export. Async handlers are supported through bounded QuickJS job draining. Version negotiation is exact protocol v1; future versions require adapters. Schema-driven text configuration reuses existing plugin editor.

## Boundaries and limitations

App signing/notarization, independent daemon, network/file/terminal SDK APIs, arbitrary UI code, privileged third-party execution and live hosting are intentionally not silently enabled. Store must not advertise these as available. Package testing cannot establish publisher benevolence. Engine escape, malicious allowed display/settings behavior, user-host compromise, root-key compromise and unavailable revocation information remain risks.
