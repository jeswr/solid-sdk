<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# DNS-pinning caller audit — sst-8xm.83

Audited 2026-11-11 before changing the Node default. Searched all of `packages/`,
`apps/` and `tools/` for `@jeswr/guarded-fetch`, then inspected static imports,
re-exports and dynamic imports with the TypeScript parser (excluding generated/build
artifacts and dependency directories). Found **204 importing files across 40 projects**:
152 production/demo files and 52 test files. No imports were found in `tools/`.
The complete file inventory is below; manifest/build-script references were also checked.

## Runtime and action for every importing project

| Project | Runtime, dispatcher availability and action |
| --- | --- |
| `apps/agent-daemon` | Node demos/tests; existing `createNodeGuardedFetch` uses installed undici. No change. |
| `apps/coeliac` | Browser foreign-fetch wrapper explicitly sets `requireDnsPinning: false`; browser-owned DNS and a Fetch-only transport cannot consume a Node dispatcher. Pod layout uses only normalization. |
| `apps/issues` | Browser authenticated discovery explicitly sets `requireDnsPinning: false` with its reason. URL validation and redirect refusal remain unchanged. |
| `apps/mcp-server` | Node handlers/config/pod/single-user already use the Node pinned transport. Undici available via guarded-fetch. No change. |
| `apps/notification-relay` | Node outbound path already uses `createNodeGuardedFetch`. Undici available. No change. |
| `apps/pod-docs` | Portable browser/session identity-read transport explicitly sets `requireDnsPinning: false`: it owns DNS and opaque browser redirects and cannot promise an undici dispatcher. Validation-only calls remain unchanged. |
| `apps/pod-migrator` | Browser/portable scope and normalization helpers only; no SSRF transport constructed. No change. |
| `apps/suite` | Browser/portable scope, redirect and snapshot helpers only; no SSRF transport constructed. No change. |
| `packages/agent-audit` | Node CLI/demos already pinned; reader/transport use URL-redaction/scope helpers. Undici available. No change. |
| `packages/agent-channels` | Node default transport already pinned; outer guard supplies an explicitly attested `pinningFetch`. Undici available. No change. |
| `packages/agent-memory` | Test-only Node pinned fetch import. Undici available. No change. |
| `packages/agent-model-gateway` | Node root `guardedFetch` now automatically pins its default transport. Type-only imports do not load a transport. Package uses tsc and preserves the guarded-fetch dependency, whose undici is installed. No caller change. |
| `packages/agent-session-capture` | Node capture/export-import already use `createNodeGuardedFetch`. Undici available. No change. |
| `packages/agentic-legacy-bridge` | Node upgrade/LLM HTTP already pinned; safe-IRI uses only scope checking. Undici available. No change. |
| `packages/auth-solid` | Portable redirect-refusal helper only; root helper is inlined/tree-shaken without executing the Node transport. No change. |
| `packages/federation-client` | Root guard re-export feeds `registry.ts` default reads, which now automatically pin on Node. Its inline bundle already declares/externalizes undici. Node entry remains pinned. Updated inert test transports and inherited-policy README/SKILL documentation; no production caller change. |
| `packages/ldp-container` | Portable scope/container helpers only. No change. |
| `packages/matrix-chat-to-pod` | Node importer already pinned; safe-IRI uses only scope checking. Undici available. No change. |
| `packages/mcp-oauth` | Node client/session/vault transports already pinned; other imports are scope/IP helpers. Undici available. No change. |
| `packages/n8n-nodes-solid` | Portable scope/container/redaction helpers only. No change. |
| `packages/personal-agent` | Node Gmail reader and undici regression already use the pinned Node entry. Undici available. No change. |
| `packages/pod-access` | Portable address classification and scope helpers only. No change. |
| `packages/pod-auth` | Portable redirect-refusal helper only. No change. |
| `packages/pod-connectors` | Portable and Node scope, redirect and snapshot helpers only. No SSRF transport constructed. No change. |
| `packages/rxdb-solid` | Portable scope and snapshot helpers/re-exports only. No change. |
| `packages/solid-agent-card` | Lazy Node default already pinned. Node chunk and inline build already declare/externalize undici. No change. |
| `packages/solid-agent-notify` | Node egress already pinned. Browser authenticated client explicitly requires a `pinningFetch` on Node and accepts unresolved hosts only in a real browser. Address shim is utility-only. Round 2 adds `pinningFetch: transport` to the redirect-test mock (inert, no sockets). |
| `packages/solid-api-auth` | Lazy Node WebID fetch already pinned; inline build already declares/externalizes undici. No change. |
| `packages/solid-community-feeds` | Default is already Node-pinned. Injected FetchLike has no dispatcher contract and owns its SSRF policy; its existing DNS-less exception now explicitly sets `requireDnsPinning: false` with a reason. Validator remains real-DNS and creates no socket. |
| `packages/solid-components` | Lazy root remote-shape fetch now automatically pins on Node; browsers retain their DNS-less policy. Guarded-fetch stays an optional external peer, so its own undici dependency resolves in Node. Data writer loads scope helpers only. No change. |
| `packages/solid-dav-bridge` | Lazy Node remote fetch already pinned; ingestion uses scope helpers. Guarded-fetch dependency supplies undici. Round 2 attests both inert redirect fixture transports. |
| `packages/solid-granary` | Lazy Node remote fetch already pinned; guarded-fetch dependency supplies undici. Round 2 attests the inert redirect fixture transport. |
| `packages/solid-mcp` | Node client-credentials uses `assertSafeUrl` for validation and `createPinningDispatcher` for transport. Undici available; standalone validation does not need a dispatcher. Other imports are scope/container helpers. No change. |
| `packages/solid-memory` | Portable scope helpers only. No change. |
| `packages/solid-pod-guard` | Lazy Node owner fetches already pinned; guarded-fetch dependency supplies undici. No change. |
| `packages/solid-vc` | Lazy Node WebID fetch already pinned; browser mapping excludes the Node entry. Guarded-fetch dependency supplies undici. No change. |
| `packages/storage-client` | Portable scope/redaction helpers only. No change. |
| `packages/suite-sdk` | Portable scope/normalization/redirect helpers only. No change. |
| `packages/unstorage-solid` | Portable scope, redirect and snapshot helpers/re-exports only. No change. |
| `packages/y-solid` | Portable scope/normalization/container helpers/re-exports only. No change. |

## Round 2: effective proxies and custom-fetch decisions

Re-audited 2026-11-11 with `rg` across **every** package/app/tool importing the root entry,
including federation-client's local re-export and fixture re-exports. Inspected guard factory
calls with the TypeScript parser, including object spreads and dynamic imports. No tool
constructs a custom root guard. Plain scope/redirect/snapshot helpers do not invoke SSRF
transports and require no pinning attestation.

The Node entry has always owned its per-request Agent, so global dispatchers remain outside
its policy. Both entries now refuse only **effective** environment proxies: a URL selected
for the target scheme with `NODE_USE_ENV_PROXY=1` or `--use-env-proxy` in `NODE_OPTIONS` /
`process.execArgv`, after target-specific `NO_PROXY` exclusions. Bare HTTP(S)/ALL_PROXY values
are inert. The root additionally checks non-default global dispatchers. Proxy refusals on
the Node entry direct callers to the **root** entry for opt-out/custom pinning; the Node
entry itself cannot opt out. This restores ordinary Node callers (mcp-oauth, mcp-server,
notification-relay, solid-vc, solid-pod-guard, agent-channels, solid-agent-notify and the other
Node rows below) in environments that merely export proxy URLs.

Every custom root SSRF transport is accounted for here. Test transports are inert and open
no sockets; their attestation exercises guard policy without pretending an arbitrary
production authenticated fetch pins DNS.

| Caller(s), relative to workspace root | Decision |
| --- | --- |
| `packages/solid-agent-notify/src/security/guardedFetch.redirect.test.ts` | **Fixed:** the Node-entry mock passes `pinningFetch: transport` alongside its injected `fetch` and DNS. All redirect assertions must reach the fixture. |
| `packages/solid-granary/test/remote.test.ts` | **Fixed:** attests the inert redirect fixture with `pinningFetch`. |
| `packages/solid-dav-bridge/test/remote.test.ts` | **Fixed:** both redirect fixtures use `pinningFetch`, retaining cross-origin credential stripping and metadata refusal. |
| `packages/federation-client/src/registry.ts` (`guardedFetchFor`) | Keep strict Node default; callers of `discoverFromRegistry` / `resolveStorageSpecVersion` with custom `fetch` must pass `guard.pinningFetch`, or explicitly accept rebinding via `guard.requireDnsPinning: false`. Never attest `options.fetch` automatically. The package README/SKILL already document this contract. |
| `packages/federation-client/test/registry.test.ts` | Existing `STUB_GUARD` explicitly opts inert RDF fixtures out with a no-socket reason. |
| `packages/federation-client/test/ssrf.test.ts`, `test/ssrf-no-regression.adversarial.test.ts` | Existing `pinningFetch` fixtures; plain `fetch` cases deliberately test refusal, IP literals, or explicit weaker opt-outs. |
| `packages/federation-client/test/ssrf-dns-fallback.test.ts` | Existing plain-fetch cases exercise DNS-less refusal, positively identified browsers, and public IP literals. These are deliberate policy cases; no blanket attestation or opt-out. |
| `packages/solid-agent-notify/src/security/clientFetch.ts` | Requires explicit `options.pinningFetch` on Node; plain authenticated fetch remains refused. Do not auto-attest it. Browser-only unresolved policy is unchanged. |
| `packages/agent-channels/src/origins.ts` | Existing outer `pinningFetch` delegates to its Node-pinned inner transport. |
| `packages/agent-channels/test/origins.test.ts`, `test/send-authority.test.ts`, `test/graph-mail.test.ts` (and `test/fixtures/matrix.ts` re-export) | Existing inert `pinningFetch` fixtures; retained. |
| `packages/agent-executor/test/channels.test.ts` | Existing inert `pinningFetch` fixture; retained. This consumer reaches the root factory through the channel fixture seam. |
| `packages/mcp-oauth/src/clients.test.ts` | Existing inert `pinningFetch` fixture; retained. |
| `apps/notification-relay/src/outbound.test.ts` | Custom transport targets only IP literals, which have no DNS rebinding window. Existing `requireDnsPinning: true` is retained. |
| `packages/solid-community-feeds/src/safeFetch.ts` | Existing `INJECTED_FETCH_GUARD_OPTIONS.requireDnsPinning: false` documents that injected FetchLike owns DNS/SSRF policy and cannot consume an undici dispatcher. Default remains Node-pinned. |
| `apps/coeliac/src/lib/fetch/guarded.ts` | Existing explicit `requireDnsPinning: false`: browser-owned DNS and Fetch-only transport. |
| `apps/issues/src/lib/announce.ts` | Existing explicit browser opt-out; `guardOptions` can supply Node pinning when used outside a browser. |
| `apps/pod-docs/src/type-index.ts` | Existing explicit opt-out: portable browser/session transport owns DNS and opaque redirects. |

Default root transports in `agent-model-gateway` and `solid-components` inject no custom
`fetch`, so they keep built-in pinning. All `/node` imports retain mandatory pinning.

### Round 2 validation

Ran each caller file separately with `--coverage.enabled=false --maxWorkers=1
--no-file-parallelism` on Node 24; where a package had no local Vitest bin, used the root
runner with `--root <project>`. Dependency-first Turbo builds were attempted before testing.

| Project | Individually run files and outcome |
| --- | --- |
| `guarded-fetch` | `test/node-request-snapshot.test.ts`: **108 passed**, including pristine installed/default Node dispatchers, inactive/active proxy variables, all three activation sources, NO_PROXY domains/ports/IP literals, redirects, and changes at the authority fence. The 19 files without socket-binding requirements pass **913 tests** in total. |
| `solid-agent-notify` | `src/security/guardedFetch.redirect.test.ts` **8**, `src/security/clientFetch.test.ts` **3**, `src/client.test.ts` **56**, `src/inbox-client.test.ts` **36**: all pass. |
| `solid-dav-bridge`, `solid-granary` | Each `test/remote.test.ts`: **17 passed**. |
| `federation-client` | `test/registry.test.ts` **16**, `test/ssrf.test.ts` **87**, `test/ssrf-dns-fallback.test.ts` **8**, `test/ssrf-no-regression.adversarial.test.ts` **5**, `test/node-dist.test.ts` **2**: all pass. |
| `mcp-oauth` | `src/clients.test.ts`: **60 passed**. |
| `notification-relay` | `src/outbound.test.ts`: **4 passed**. |
| `solid-community-feeds` | `test/safeFetch.test.ts`: **64 passed**. |
| `issues` | `src/lib/announce.test.ts`: **35 passed**. |
| `coeliac` | `src/lib/off/off.test.ts` **9**, `src/lib/knowledge/fetch.test.ts` **10**: both pass. |
| `pod-docs` | `src/type-index.test.ts` **44**, `src/type-index-browser.test.ts` **33**, `src/type-index-identity.test.ts` **35**: all pass. |
| `solid-components` | `test/shacl-view-fetch.test.ts`: **25 passed**. |
| `agent-channels` | `test/origins.test.ts`: **41 passed**, 10 socket tests fail because this sandbox denies `listen` with EPERM. `test/send-authority.test.ts` and `test/graph-mail.test.ts` cannot collect without the package's built exports. |
| `agent-executor` | `test/channels.test.ts` cannot collect without built `@jeswr/agent-channels/discord/send` exports. |
| `agent-model-gateway` | `test/gateway.test.ts` cannot collect without built `@jeswr/agentic-legacy-bridge/metadata` exports. |

Fail-first evidence: the new offline proxy/dispatcher expectations initially produced
**42 failures / 48 passes** against the previous transport. The notify redirect mock
initially failed all **8** tests before pinning attestation; DAV and Granary each had
**1 failing / 16 passing** remote tests. These files now pass. The real socket regression
suite cannot start here (`listen EPERM`); its IPv6-only case now skips specifically when
binding `::1` reports EAFNOSUPPORT, EADDRNOTAVAIL or EPROTONOSUPPORT.

The broad dependency build stops at the existing `packages/ldp-container/src/listing.ts:37`
TS2339 (`ListingMemberWrapper.types`), leaving some downstream artifacts unavailable.
These blocked caller files still need a run in CI with built workspace exports and socket
binding enabled.

Edited-code Biome checks and guarded-fetch typecheck pass. The requested
`pnpm turbo run lint build typecheck test --filter=...@jeswr/guarded-fetch --concurrency=4
--output-logs=errors-only` exits **2** at the unrelated `@jeswr/app-session` build
(TS2688: missing `@testing-library/jest-dom`, package node_modules absent).
The required `pnpm run gate:full` also exits **2**, at `@jeswr/suite-charts`' missing
React/JSX dependencies. No out-of-scope source or dependency changes were made for these
checkout failures.

## Complete import inventory

Paths are relative to each project. “Node” means the `/node` entry; “root” means the
browser-safe root entry. Multiple entries in a file are listed together.

| Project | Production/demo importers | Test importers |
| --- | --- | --- |
| `apps/agent-daemon` | [demos/d2-audit.ts](../../../apps/agent-daemon/demos/d2-audit.ts) (Node) | [demos/test/css.ts](../../../apps/agent-daemon/demos/test/css.ts) (Node)<br>[test/css.test.ts](../../../apps/agent-daemon/test/css.test.ts) (Node) |
| `apps/coeliac` | [src/lib/fetch/guarded.ts](../../../apps/coeliac/src/lib/fetch/guarded.ts) (root)<br>[src/lib/pod/layout.ts](../../../apps/coeliac/src/lib/pod/layout.ts) (root) | — |
| `apps/issues` | [src/lib/announce.ts](../../../apps/issues/src/lib/announce.ts) (root) | [src/lib/announce.test.ts](../../../apps/issues/src/lib/announce.test.ts) (root) |
| `apps/mcp-server` | [src/config.ts](../../../apps/mcp-server/src/config.ts) (Node)<br>[src/handler.ts](../../../apps/mcp-server/src/handler.ts) (Node)<br>[src/pod.ts](../../../apps/mcp-server/src/pod.ts) (Node)<br>[src/single-user.ts](../../../apps/mcp-server/src/single-user.ts) (Node, root) | — |
| `apps/notification-relay` | [src/outbound.ts](../../../apps/notification-relay/src/outbound.ts) (Node) | [src/config.test.ts](../../../apps/notification-relay/src/config.test.ts) (Node)<br>[src/outbound.test.ts](../../../apps/notification-relay/src/outbound.test.ts) (Node, root) |
| `apps/pod-docs` | [src/type-index.ts](../../../apps/pod-docs/src/type-index.ts) (root) | — |
| `apps/pod-migrator` | [src/App.tsx](../../../apps/pod-migrator/src/App.tsx) (root)<br>[src/auth/connections.ts](../../../apps/pod-migrator/src/auth/connections.ts) (root)<br>[src/engine/planner.ts](../../../apps/pod-migrator/src/engine/planner.ts) (root)<br>[src/engine/pod-http.ts](../../../apps/pod-migrator/src/engine/pod-http.ts) (root)<br>[src/engine/rdf.ts](../../../apps/pod-migrator/src/engine/rdf.ts) (root)<br>[src/engine/target-access.ts](../../../apps/pod-migrator/src/engine/target-access.ts) (root) | — |
| `apps/suite` | [src/apps/agent/lib/client.ts](../../../apps/suite/src/apps/agent/lib/client.ts) (root)<br>[src/apps/agent/lib/mandates.ts](../../../apps/suite/src/apps/agent/lib/mandates.ts) (root)<br>[src/apps/agent/lib/paths.ts](../../../apps/suite/src/apps/agent/lib/paths.ts) (root)<br>[src/apps/agent/lib/profile.ts](../../../apps/suite/src/apps/agent/lib/profile.ts) (root)<br>[src/apps/calendar/lib/model/io.ts](../../../apps/suite/src/apps/calendar/lib/model/io.ts) (root)<br>[src/apps/calendar/state/calendar-context.tsx](../../../apps/suite/src/apps/calendar/state/calendar-context.tsx) (root)<br>[src/apps/calendar/state/editing.ts](../../../apps/suite/src/apps/calendar/state/editing.ts) (root)<br>[src/apps/calendar/state/intents.ts](../../../apps/suite/src/apps/calendar/state/intents.ts) (root)<br>[src/apps/calendar/state/repository.ts](../../../apps/suite/src/apps/calendar/state/repository.ts) (root)<br>[src/apps/chat/lib/client/client.ts](../../../apps/suite/src/apps/chat/lib/client/client.ts) (root)<br>[src/apps/chat/lib/client/preferences-store.ts](../../../apps/suite/src/apps/chat/lib/client/preferences-store.ts) (root)<br>[src/apps/chat/lib/model/extras.ts](../../../apps/suite/src/apps/chat/lib/model/extras.ts) (root)<br>[src/apps/chat/lib/model/io.ts](../../../apps/suite/src/apps/chat/lib/model/io.ts) (root)<br>[src/apps/chat/lib/model/paths.ts](../../../apps/suite/src/apps/chat/lib/model/paths.ts) (root)<br>[src/apps/contacts/components/contact-detail.tsx](../../../apps/suite/src/apps/contacts/components/contact-detail.tsx) (root)<br>[src/apps/contacts/lib/model/transport.ts](../../../apps/suite/src/apps/contacts/lib/model/transport.ts) (root)<br>[src/apps/docs/editor/copy.ts](../../../apps/suite/src/apps/docs/editor/copy.ts) (root)<br>[src/apps/docs/editor/operations.ts](../../../apps/suite/src/apps/docs/editor/operations.ts) (root)<br>[src/apps/docs/lib/model/store.ts](../../../apps/suite/src/apps/docs/lib/model/store.ts) (root)<br>[src/apps/docs/lib/model/type-index-access.ts](../../../apps/suite/src/apps/docs/lib/model/type-index-access.ts) (root)<br>[src/apps/docs/lib/model/type-index.ts](../../../apps/suite/src/apps/docs/lib/model/type-index.ts) (root)<br>[src/apps/drive/lib/client/access.ts](../../../apps/suite/src/apps/drive/lib/client/access.ts) (root)<br>[src/apps/drive/lib/client/ancestors.ts](../../../apps/suite/src/apps/drive/lib/client/ancestors.ts) (root)<br>[src/apps/drive/lib/client/bootstrap.ts](../../../apps/suite/src/apps/drive/lib/client/bootstrap.ts) (root)<br>[src/apps/drive/lib/client/ownership.ts](../../../apps/suite/src/apps/drive/lib/client/ownership.ts) (root)<br>[src/apps/drive/lib/model/root.ts](../../../apps/suite/src/apps/drive/lib/model/root.ts) (root)<br>[src/apps/health/lib/model/io.ts](../../../apps/suite/src/apps/health/lib/model/io.ts) (root)<br>[src/apps/home/components/home-card.tsx](../../../apps/suite/src/apps/home/components/home-card.tsx) (root)<br>[src/apps/home/components/item/data.ts](../../../apps/suite/src/apps/home/components/item/data.ts) (root)<br>[src/apps/home/components/item/delete-controller.ts](../../../apps/suite/src/apps/home/components/item/delete-controller.ts) (root)<br>[src/apps/home/components/item/manual-data.ts](../../../apps/suite/src/apps/home/components/item/manual-data.ts) (root)<br>[src/apps/home/components/item/private-acl.ts](../../../apps/suite/src/apps/home/components/item/private-acl.ts) (root)<br>[src/apps/home/lib/permissions/records.ts](../../../apps/suite/src/apps/home/lib/permissions/records.ts) (root)<br>[src/apps/home/lib/permissions/revoke.ts](../../../apps/suite/src/apps/home/lib/permissions/revoke.ts) (root)<br>[src/apps/home/lib/permissions/walk.ts](../../../apps/suite/src/apps/home/lib/permissions/walk.ts) (root)<br>[src/apps/home/state/permissions.ts](../../../apps/suite/src/apps/home/state/permissions.ts) (root)<br>[src/apps/home/state/requests.ts](../../../apps/suite/src/apps/home/state/requests.ts) (root)<br>[src/apps/mail/lib/client/client.ts](../../../apps/suite/src/apps/mail/lib/client/client.ts) (root)<br>[src/apps/mail/lib/model/io.ts](../../../apps/suite/src/apps/mail/lib/model/io.ts) (root)<br>[src/apps/money/lib/data/categories.ts](../../../apps/suite/src/apps/money/lib/data/categories.ts) (root)<br>[src/apps/money/lib/model/io.ts](../../../apps/suite/src/apps/money/lib/model/io.ts) (root)<br>[src/apps/music/demo/spotify.ts](../../../apps/suite/src/apps/music/demo/spotify.ts) (root)<br>[src/apps/music/lib/data/history.ts](../../../apps/suite/src/apps/music/lib/data/history.ts) (root)<br>[src/apps/music/lib/data/library.ts](../../../apps/suite/src/apps/music/lib/data/library.ts) (root)<br>[src/apps/music/lib/data/liked.ts](../../../apps/suite/src/apps/music/lib/data/liked.ts) (root)<br>[src/apps/music/lib/data/playlists.ts](../../../apps/suite/src/apps/music/lib/data/playlists.ts) (root)<br>[src/apps/music/lib/data/preferences.ts](../../../apps/suite/src/apps/music/lib/data/preferences.ts) (root)<br>[src/apps/music/lib/model/history.ts](../../../apps/suite/src/apps/music/lib/model/history.ts) (root)<br>[src/apps/music/lib/model/io.ts](../../../apps/suite/src/apps/music/lib/model/io.ts) (root)<br>[src/apps/notes/components/note-dialog.tsx](../../../apps/suite/src/apps/notes/components/note-dialog.tsx) (root)<br>[src/apps/notes/lib/images.ts](../../../apps/suite/src/apps/notes/lib/images.ts) (root)<br>[src/apps/notes/lib/model/store.ts](../../../apps/suite/src/apps/notes/lib/model/store.ts) (root)<br>[src/apps/photos/components/lightbox.tsx](../../../apps/suite/src/apps/photos/components/lightbox.tsx) (root)<br>[src/apps/photos/components/photo-image.tsx](../../../apps/suite/src/apps/photos/components/photo-image.tsx) (root)<br>[src/apps/photos/lib/data/favourites.ts](../../../apps/suite/src/apps/photos/lib/data/favourites.ts) (root)<br>[src/apps/photos/lib/data/google-photos.ts](../../../apps/suite/src/apps/photos/lib/data/google-photos.ts) (root)<br>[src/apps/photos/lib/data/storage.ts](../../../apps/suite/src/apps/photos/lib/data/storage.ts) (root)<br>[src/apps/photos/lib/data/usage.ts](../../../apps/suite/src/apps/photos/lib/data/usage.ts) (root)<br>[src/apps/photos/lib/model/io.ts](../../../apps/suite/src/apps/photos/lib/model/io.ts) (root)<br>[src/apps/sheets/components/cell-comments.tsx](../../../apps/suite/src/apps/sheets/components/cell-comments.tsx) (root)<br>[src/apps/sheets/lib/comments/store.ts](../../../apps/suite/src/apps/sheets/lib/comments/store.ts) (root)<br>[src/apps/sheets/lib/model/storage.ts](../../../apps/suite/src/apps/sheets/lib/model/storage.ts) (root)<br>[src/apps/sheets/lib/sharing.ts](../../../apps/suite/src/apps/sheets/lib/sharing.ts) (root)<br>[src/apps/sheets/lib/workbook/layout.ts](../../../apps/suite/src/apps/sheets/lib/workbook/layout.ts) (root)<br>[src/apps/sheets/lib/workbook/registration.ts](../../../apps/suite/src/apps/sheets/lib/workbook/registration.ts) (root)<br>[src/apps/sheets/lib/workbook/service.ts](../../../apps/suite/src/apps/sheets/lib/workbook/service.ts) (root)<br>[src/apps/tasks/lib/share/adapter.ts](../../../apps/suite/src/apps/tasks/lib/share/adapter.ts) (root)<br>[src/shell/share/wac-adapter.ts](../../../apps/suite/src/shell/share/wac-adapter.ts) (root) | [test/calendar-state-profile.test.ts](../../../apps/suite/test/calendar-state-profile.test.ts) (root)<br>[test/calendar/io.test.ts](../../../apps/suite/test/calendar/io.test.ts) (root)<br>[test/docs/rdf-io.test.ts](../../../apps/suite/test/docs/rdf-io.test.ts) (root)<br>[test/docs/store.test.ts](../../../apps/suite/test/docs/store.test.ts) (root)<br>[test/docs/type-index-access.test.ts](../../../apps/suite/test/docs/type-index-access.test.ts) (root)<br>[test/docs/type-index-profile.test.ts](../../../apps/suite/test/docs/type-index-profile.test.ts) (root)<br>[test/docs/type-index-scope.test.ts](../../../apps/suite/test/docs/type-index-scope.test.ts) (root)<br>[test/mail/importer.test.ts](../../../apps/suite/test/mail/importer.test.ts) (root)<br>[test/music/io.test.ts](../../../apps/suite/test/music/io.test.ts) (root)<br>[test/notes-model-store.test.ts](../../../apps/suite/test/notes-model-store.test.ts) (root)<br>[test/photos/io.test.ts](../../../apps/suite/test/photos/io.test.ts) (root) |
| `packages/agent-audit` | [demos/css.ts](../../../packages/agent-audit/demos/css.ts) (Node)<br>[demos/walkthrough.ts](../../../packages/agent-audit/demos/walkthrough.ts) (Node)<br>[src/cli.ts](../../../packages/agent-audit/src/cli.ts) (Node)<br>[src/reader.ts](../../../packages/agent-audit/src/reader.ts) (root)<br>[src/transport.ts](../../../packages/agent-audit/src/transport.ts) (root) | [test/css.test.ts](../../../packages/agent-audit/test/css.test.ts) (Node)<br>[test/demo.test.ts](../../../packages/agent-audit/test/demo.test.ts) (Node) |
| `packages/agent-channels` | [src/origins.ts](../../../packages/agent-channels/src/origins.ts) (Node, root) | [test/discord-send.test.ts](../../../packages/agent-channels/test/discord-send.test.ts) (root)<br>[test/fixtures/graph.ts](../../../packages/agent-channels/test/fixtures/graph.ts) (root)<br>[test/fixtures/matrix.ts](../../../packages/agent-channels/test/fixtures/matrix.ts) (root)<br>[test/gmail.test.ts](../../../packages/agent-channels/test/gmail.test.ts) (root)<br>[test/graph-mail.test.ts](../../../packages/agent-channels/test/graph-mail.test.ts) (root)<br>[test/mastodon.test.ts](../../../packages/agent-channels/test/mastodon.test.ts) (root)<br>[test/origins.test.ts](../../../packages/agent-channels/test/origins.test.ts) (Node, root)<br>[test/send-authority.test.ts](../../../packages/agent-channels/test/send-authority.test.ts) (root)<br>[test/x.test.ts](../../../packages/agent-channels/test/x.test.ts) (root) |
| `packages/agent-memory` | — | [test/css.test.ts](../../../packages/agent-memory/test/css.test.ts) (Node) |
| `packages/agent-model-gateway` | [src/testing.ts](../../../packages/agent-model-gateway/src/testing.ts) (root)<br>[src/transport.ts](../../../packages/agent-model-gateway/src/transport.ts) (root)<br>[src/types.ts](../../../packages/agent-model-gateway/src/types.ts) (root) | [test/gateway.test.ts](../../../packages/agent-model-gateway/test/gateway.test.ts) (root) |
| `packages/agent-session-capture` | [src/capture.ts](../../../packages/agent-session-capture/src/capture.ts) (Node)<br>[src/export-import.ts](../../../packages/agent-session-capture/src/export-import.ts) (Node) | [src/capture.test.ts](../../../packages/agent-session-capture/src/capture.test.ts) (Node)<br>[src/export-import.test.ts](../../../packages/agent-session-capture/src/export-import.test.ts) (Node) |
| `packages/agentic-legacy-bridge` | [src/interpret-llm-http.ts](../../../packages/agentic-legacy-bridge/src/interpret-llm-http.ts) (Node)<br>[src/safe-iri.ts](../../../packages/agentic-legacy-bridge/src/safe-iri.ts) (root)<br>[src/upgrade.ts](../../../packages/agentic-legacy-bridge/src/upgrade.ts) (Node) | — |
| `packages/auth-solid` | [src/dpopFetch.ts](../../../packages/auth-solid/src/dpopFetch.ts) (root) | [test/dpopFetch.test.ts](../../../packages/auth-solid/test/dpopFetch.test.ts) (root) |
| `packages/federation-client` | [src/node.ts](../../../packages/federation-client/src/node.ts) (Node)<br>[src/ssrf.ts](../../../packages/federation-client/src/ssrf.ts) (root) | [test/ssrf-dns-fallback.test.ts](../../../packages/federation-client/test/ssrf-dns-fallback.test.ts) (root)<br>[test/ssrf-no-regression.adversarial.test.ts](../../../packages/federation-client/test/ssrf-no-regression.adversarial.test.ts) (root)<br>[test/ssrf.test.ts](../../../packages/federation-client/test/ssrf.test.ts) (root) |
| `packages/ldp-container` | [src/index.ts](../../../packages/ldp-container/src/index.ts) (root) | — |
| `packages/matrix-chat-to-pod` | [src/import.ts](../../../packages/matrix-chat-to-pod/src/import.ts) (Node)<br>[src/safe-iri.ts](../../../packages/matrix-chat-to-pod/src/safe-iri.ts) (root) | [src/acl.test.ts](../../../packages/matrix-chat-to-pod/src/acl.test.ts) (Node) |
| `packages/mcp-oauth` | [src/clients.ts](../../../packages/mcp-oauth/src/clients.ts) (Node)<br>[src/lws-trust.ts](../../../packages/mcp-oauth/src/lws-trust.ts) (root)<br>[src/pod-sessions.ts](../../../packages/mcp-oauth/src/pod-sessions.ts) (Node, root)<br>[src/protocol.ts](../../../packages/mcp-oauth/src/protocol.ts) (root)<br>[src/vault-stores.ts](../../../packages/mcp-oauth/src/vault-stores.ts) (Node) | [src/clients.test.ts](../../../packages/mcp-oauth/src/clients.test.ts) (root) |
| `packages/n8n-nodes-solid` | [src/scope.ts](../../../packages/n8n-nodes-solid/src/scope.ts) (root) | — |
| `packages/personal-agent` | [src/reader/gmail.ts](../../../packages/personal-agent/src/reader/gmail.ts) (Node) | [src/guarded-fetch-undici.test.ts](../../../packages/personal-agent/src/guarded-fetch-undici.test.ts) (Node) |
| `packages/pod-access` | [src/requests-solid/http.ts](../../../packages/pod-access/src/requests-solid/http.ts) (root) | — |
| `packages/pod-auth` | [src/registration.ts](../../../packages/pod-auth/src/registration.ts) (root) | — |
| `packages/pod-connectors` | [src/core/abort.ts](../../../packages/pod-connectors/src/core/abort.ts) (root)<br>[src/core/fixture-recorder.ts](../../../packages/pod-connectors/src/core/fixture-recorder.ts) (root)<br>[src/core/import-runner.ts](../../../packages/pod-connectors/src/core/import-runner.ts) (root)<br>[src/core/pod-writer.ts](../../../packages/pod-connectors/src/core/pod-writer.ts) (root)<br>[src/node/loopback.ts](../../../packages/pod-connectors/src/node/loopback.ts) (root)<br>[src/node/pod-auth.ts](../../../packages/pod-connectors/src/node/pod-auth.ts) (root)<br>[src/node/state.ts](../../../packages/pod-connectors/src/node/state.ts) (root)<br>[src/pod/type-index-write.ts](../../../packages/pod-connectors/src/pod/type-index-write.ts) (root)<br>[src/spotify/source-auth.ts](../../../packages/pod-connectors/src/spotify/source-auth.ts) (root) | [src/core/pod-writer.test.ts](../../../packages/pod-connectors/src/core/pod-writer.test.ts) (root) |
| `packages/rxdb-solid` | [src/index.ts](../../../packages/rxdb-solid/src/index.ts) (root)<br>[src/scope.ts](../../../packages/rxdb-solid/src/scope.ts) (root)<br>[src/store.ts](../../../packages/rxdb-solid/src/store.ts) (root)<br>[src/transport.ts](../../../packages/rxdb-solid/src/transport.ts) (root) | [src/store.test.ts](../../../packages/rxdb-solid/src/store.test.ts) (root) |
| `packages/solid-agent-card` | [src/internal/default-fetch.ts](../../../packages/solid-agent-card/src/internal/default-fetch.ts) (Node) | — |
| `packages/solid-agent-notify` | [src/security/clientFetch.ts](../../../packages/solid-agent-notify/src/security/clientFetch.ts) (root)<br>[src/security/guardedFetch.ts](../../../packages/solid-agent-notify/src/security/guardedFetch.ts) (Node)<br>[src/security/ssrf.ts](../../../packages/solid-agent-notify/src/security/ssrf.ts) (root) | [src/security/guardedFetch.redirect.test.ts](../../../packages/solid-agent-notify/src/security/guardedFetch.redirect.test.ts) (root)<br>[src/security/ssrf-differential.test.ts](../../../packages/solid-agent-notify/src/security/ssrf-differential.test.ts) (root) |
| `packages/solid-api-auth` | [src/core.ts](../../../packages/solid-api-auth/src/core.ts) (Node) | — |
| `packages/solid-community-feeds` | [src/safeFetch.ts](../../../packages/solid-community-feeds/src/safeFetch.ts) (Node, root) | — |
| `packages/solid-components` | [src/data-writer.ts](../../../packages/solid-components/src/data-writer.ts) (root)<br>[src/shacl-view-fetch.ts](../../../packages/solid-components/src/shacl-view-fetch.ts) (root) | — |
| `packages/solid-dav-bridge` | [src/ingest.ts](../../../packages/solid-dav-bridge/src/ingest.ts) (root)<br>[src/remote.ts](../../../packages/solid-dav-bridge/src/remote.ts) (Node) | [test/remote.test.ts](../../../packages/solid-dav-bridge/test/remote.test.ts) (root) |
| `packages/solid-granary` | [src/remote.ts](../../../packages/solid-granary/src/remote.ts) (Node) | [test/remote.test.ts](../../../packages/solid-granary/test/remote.test.ts) (root) |
| `packages/solid-mcp` | [src/auth.ts](../../../packages/solid-mcp/src/auth.ts) (root)<br>[src/client-credentials.ts](../../../packages/solid-mcp/src/client-credentials.ts) (Node, root)<br>[src/output.ts](../../../packages/solid-mcp/src/output.ts) (root)<br>[src/pod-port.ts](../../../packages/solid-mcp/src/pod-port.ts) (root)<br>[src/pod.ts](../../../packages/solid-mcp/src/pod.ts) (root)<br>[src/server.ts](../../../packages/solid-mcp/src/server.ts) (root) | [test/client-credentials-discovery.test.ts](../../../packages/solid-mcp/test/client-credentials-discovery.test.ts) (Node) |
| `packages/solid-memory` | [src/scope.ts](../../../packages/solid-memory/src/scope.ts) (root) | [src/scope-differential.test.ts](../../../packages/solid-memory/src/scope-differential.test.ts) (root) |
| `packages/solid-pod-guard` | [src/owner.ts](../../../packages/solid-pod-guard/src/owner.ts) (Node) | — |
| `packages/solid-vc` | [src/webid.ts](../../../packages/solid-vc/src/webid.ts) (Node) | [test/webid.test.ts](../../../packages/solid-vc/test/webid.test.ts) (Node) |
| `packages/storage-client` | [src/http.ts](../../../packages/storage-client/src/http.ts) (root) | — |
| `packages/suite-sdk` | [src/search/client.ts](../../../packages/suite-sdk/src/search/client.ts) (root) | — |
| `packages/unstorage-solid` | [src/keys.ts](../../../packages/unstorage-solid/src/keys.ts) (root)<br>[src/scope.ts](../../../packages/unstorage-solid/src/scope.ts) (root) | [test/redirect-differential.test.ts](../../../packages/unstorage-solid/test/redirect-differential.test.ts) (root)<br>[test/redirect-error-built.test.ts](../../../packages/unstorage-solid/test/redirect-error-built.test.ts) (root)<br>[test/rr8-regressions.test.ts](../../../packages/unstorage-solid/test/rr8-regressions.test.ts) (root)<br>[test/scope-differential.test.ts](../../../packages/unstorage-solid/test/scope-differential.test.ts) (root) |
| `packages/y-solid` | [src/index.ts](../../../packages/y-solid/src/index.ts) (root)<br>[src/store.ts](../../../packages/y-solid/src/store.ts) (root) | [src/store.test.ts](../../../packages/y-solid/src/store.test.ts) (root) |
