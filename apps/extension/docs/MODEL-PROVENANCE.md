# Model provenance

While Fable is unavailable, everything authored by **Claude Opus 4.8** is tagged so it can
be targeted for re-review / upgrade when Fable returns.

- **Commit trailers:** `Model: claude-opus-4-8` + the `Provenance:` line +
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **New source files:** an `AUTHORED-BY Claude Opus 4.8` top-of-file marker.

## Ledger

| Artifact | Branch | Notes |
|---|---|---|
| Suite build/gate scaffold (biome, vitest, pinned @jeswr deps, ignore-scripts) | `feat/rewrite-core` | re-review/upgrade candidate |
| `src/background/core/*` (dpop, origin-policy, www-authenticate, authenticated-fetch, webid) | `feat/rewrite-core` | security-critical — re-review/upgrade candidate |
| `src/background/{service-worker,auth-flow,session-store,action-icon}.ts` | `feat/rewrite-core` | re-review/upgrade candidate |
| `src/{inject,content,popup}/*`, `src/shared/messages.ts`, `src/manifest.json` | `feat/rewrite-core` | re-review/upgrade candidate |
| `test/*.test.ts` (51 unit cases) + updated `e2e/` suite | `feat/rewrite-core` | re-review/upgrade candidate |
| `docs/access-management-seam.md`, `README.md`, `CLAUDE.md` updates | `feat/rewrite-core` | re-review/upgrade candidate |
| MV3 side panel (`src/sidepanel/*`, `src/background/side-panel.ts`) + shared `src/popup/account-surface.ts` (popup/side-panel surface extraction) | `feat/sidepanel-and-clientid` | re-review/upgrade candidate |
| Static Client ID Document (`public/clientid.jsonld`, `src/background/client-id.ts`) + `auth-flow.ts` published-client-id wiring | `feat/sidepanel-and-clientid` | published-URL hosting = needs:user; re-review/upgrade candidate |
| `test/{client-id,side-panel}.test.ts` (+21 cases) | `feat/sidepanel-and-clientid` | re-review/upgrade candidate |
| Phase-0 per-requesting-origin gate (`src/background/core/requesting-origin.ts`) + SW wiring (`service-worker.ts` gate/PII-scoping, `session-store.ts` grant store, `content-script.ts` origin stamp, `shared/messages.ts`) | `phase-0-origin-gate` | SECURITY-CRITICAL — re-review/upgrade candidate |
| `test/{requesting-origin,service-worker-gate}.test.ts` (+53 adversarial cases) + `docs/manifest-permissions.md` | `phase-0-origin-gate` | re-review/upgrade candidate |
| Phase-1 shared replica (`src/background/core/{replica,replica-key,replica-db,single-flight}.ts`) + SW wiring + page→SW routing + egress DPoP | `feat/phase-1-shared-replica` | SECURITY-CRITICAL — re-review/upgrade candidate |
| Phase-1 round-2 roborev fixes: inject global-fetch over-divert → SW native-passthrough for `autoDivert` non-pod/un-granted traffic (High #1); single inject path + idempotency guard (Medium #2); best-effort cache persist on non-cacheable 2xx (Medium #3); null-WebID purge enumerates+drops CacheStorage bytes (Medium #4); HEAD returns no body (Low #5) — `src/inject/inject.ts`, `src/content/content-script.ts`, `src/shared/messages.ts`, `src/manifest.json`, `src/background/{service-worker,global-fetch-register}.ts`, `src/background/core/replica.ts` | `feat/phase-1-shared-replica` | SECURITY/COMPAT-CRITICAL — re-review/upgrade candidate |
| `test/inject.test.ts` (new) + `test/jsdom.d.ts` (ambient, no new dep) + round-2 cases in `test/{replica,service-worker-gate,service-worker-replica}.test.ts` (+23) | `feat/phase-1-shared-replica` | re-review/upgrade candidate |
| Phase-2 per-data-class grant gate — pure core (`src/background/core/{class-grant,class-request,class-resolve,consent}.ts`), SW wiring (`service-worker.ts` `gateAccess` + requestAccess/listGrants/revokeGrant/resolveClass/consent handlers), grant store (`session-store.ts`), message protocol (`shared/messages.ts`), page API (`inject.ts`) + content relay (`content-script.ts`), consent window (`src/consent/*`) | `feat/phase-2-class-grants` | SECURITY-CRITICAL — re-review/upgrade candidate |
| `test/{class-grant,class-request,class-resolve,consent,service-worker-class-gate}.test.ts` (+73 adversarial cases) + `docs/access-management-seam.md` rewrite | `feat/phase-2-class-grants` | re-review/upgrade candidate |
| **Model: `claude-sonnet-5` (NOT Opus 4.8, despite the surrounding table).** DPoP non-extractable-key hardening (design roborev round-1, the F3 keystore-advantage finding): `src/background/core/{dpop,dpop-key-db,dpop-key-store}.ts`, `session-store.ts` legacy-JWK migration on `loadSession()`, `auth-flow.ts` + `service-worker.ts` rewiring onto the persisted non-extractable `CryptoKeyPair` | `security/nonextractable-dpop-key` | SECURITY-CRITICAL — re-review/upgrade candidate |
| `test/{dpop,dpop-key-store,session-store,service-worker-gate,service-worker-class-gate,service-worker-replica}.test.ts` updates (+11 net new cases) + `README.md`, `docs/manifest-permissions.md`, `docs/design/shared-replica-architecture.md` updates | `security/nonextractable-dpop-key` | re-review/upgrade candidate |
| **Model: `claude-sonnet-5`.** Round-2 roborev fixes on the above: `dpopJkt` (RFC 7638 thumbprint) recorded on `StoredSession` so `loadSessionDpopKeyPair` can detect an unexpected persisted-key loss/mismatch for a current-shape session (throws `DpopKeyUnavailableError`, treated as a refresh failure) instead of silently minting/using a substitute key (Medium #1); `auth-flow.ts completeLogin` now generates the keypair early (needed for the token-exchange DPoP proof) but only calls the new `persistDpopKeyPair` after the exchange succeeds, so a failed/retried login can never clobber an existing session's still-valid persisted key (Medium #2) | `security/nonextractable-dpop-key` | SECURITY-CRITICAL — re-review/upgrade candidate |
| **Model: `claude-sonnet-5`.** Round-3 roborev fix: `ensureSession()`'s DPoP-key-load catch was blanket — ANY error (including a transient IndexedDB-open failure) tore the session down. Narrowed to teardown ONLY on `DpopKeyUnavailableError`; any other error fails that one request soft (`cachedKeyPair` stays null, session/tokens left intact, next attempt retries cleanly) — never a silent forced logout on a transient fault (Medium) | `security/nonextractable-dpop-key` | SECURITY-CRITICAL — re-review/upgrade candidate |
