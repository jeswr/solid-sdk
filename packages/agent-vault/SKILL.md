---
name: agent-vault
description: Use when implementing or consuming @jeswr/agent-vault, host-only browser account resolution, encrypted secrets and sessions, 1Password CLI accounts, permission decisions, session capture or keep-alive.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# @jeswr/agent-vault

Read README.md and the agent-credentials, site-executor and agent-browser package skills.
Private, security-critical Node 24 package. Keep the shared site-model/executor contracts
unchanged. Use the existing dependency set; runtime network, process, clock/timer, password
login and interactive login are injected seams.

- Reuse CredentialStore.privateRecord/putPrivateRecord for all disk access. Preserve 0700/
  0600, ownership checks, no-follow reads, atomic writes, and exclusive key initialization.
  AES-256-GCM always uses authTagLength: 16; require exactly 16 decoded tag bytes and
  12 decoded IV bytes. Envelope metadata must never weaken authentication.
- Keys and plaintext live in Secret wrappers. Error messages are fixed, with no external
  cause or stdout/stderr. Preserve opaque JSON/string/inspection for nested session objects.
  Trusted host callbacks can access plaintext; do not expose them or results to planners.
- Facts use n3.Parser/Writer. No credential values in labels, route metadata or refs. Keep
  SSO provider accounts in the same profile. Persona hints filter; explicit lastUsed breaks
  remaining ties. Otherwise ask; never silently cross accounts, profiles or purposes.
- Backend adapters are host provisioning seams. AgentVault applies PermissionPolicy before
  every operational secret read/save/TOTP. Persistent never decisions and revocation are
  as important as grants. Saving requires the backend's declared eligible profile.
  Persist decision revisions, compare prompt responses under the record lock, and deny
  stale approvals (including once). Never and revocation invalidate pending grants;
  a late never must also defeat an intervening grant.
- 1Password: configure each CLI account and profile separately with a vault. Desktop mode
  delegates unlock/Touch ID to op. Service mode injects a Secret token into only the child's
  OP_SERVICE_ACCOUNT_TOKEN; provision that service account for one vault only. Never inherit
  OP_SESSION/service credentials, put secrets in argv, run a shell, or log CLI diagnostics.
  Creates use JSON stdin; reads use stdout. Existing-item saves refuse before calling op:
  JSON-template edits can destroy passkeys, URLs, notes and unknown fields. Require an
  explicit '<account>/new' ref for a separate item until a preserving edit seam exists.
  Exact origin is default; any domainGroups
  must be operator-vetted registrable domains, never guessed public suffixes.
- Captures need an authenticated browser sender/transaction outside this library. Validate
  site/account/time, cookie domains/prefixes and same-origin token endpoint before storing.
  Use account id as executor persona. Do not broaden parent cookie domains automatically.
  Call `beginLogin(site, account)` before opening the login UI and retain its returned
  `{ site, account, generation }` binding. Require it in `acceptCapture`; never mint a
  transaction on message receipt or accept its generation from the message. AgentVault
  supplies the pre-callback binding as `LoginRequest.transaction` for both login methods.
  Supply only `sessions.forLogin(transaction)` as `LoginRequest.sessions` to password and
  interactive callbacks. Use this provider throughout password login, including executor
  construction, probes and retries; never close over the unrestricted host store. The
  provider exposes only get/update and binds site, account and generation. Check reads
  under the record lock after key acquisition; check generation AND revision there for
  writes. Superseded/revoked reads return undefined and writes return accepted:false,
  even if a callback obtains a newer login's revision. Keep the binding immutable.
  Check the generation and stale/revoked state under the record lock after key acquisition.
  Preserve the generation through executor/refresh writes so a valid capture still works.
  Failed login cleanup must pass that transaction to `stale`, preserving newer logins.
- Refresh only the exact site origin, use manual redirects, validated pointer extraction and
  finite expiry. Frequent probes are opt-in. Keep the floor/backoff and stale-on-401 behavior;
  stop must prevent late in-flight persistence. No default global fetch or timer.
  Recheck cancellation after state loading and immediately before transport. Use
  SessionStore.commit(snapshot, cancelled) for all scheduler writes, including 401s and
  probe cookies. Compare persisted revisions and cancellation at the synchronous record
  commit after key acquisition. Every host session write changes the revision; read/modify/
  write updates and revocation use the same record lock, never a pre-lock snapshot.
  Provider `get` returns the record revision. `update(site, persona, bundle)` returns
  `{ accepted: boolean; revision?: string }`: missing/mismatched revisions, missing records
  and stale records return accepted:false without writing. On acceptance, rotate the
  revision and acknowledge that exact new revision atomically under the record lock.
  The executor carries the acknowledged revision into its next update in the execution;
  rejection must never pair an old cookie jar with a newly fetched revision. Keep these
  additive bundle/provider/result types structural here while the executor lane updates.
  An empty login-reset bundle must carry a revision for the executor's first cookie write;
  do not treat that empty bundle as authentication. Immediate host `store` and login resets
  compare invocation snapshots after key acquisition; supplied stale snapshot revisions
  refuse. Revoking a missing record persists a tombstone. Async work uses login transactions
  or scheduler commits instead of an unbound host store.
- Tests use fictional data, temporary stores and fakes for external boundaries, including
  spawn. Never invoke a real password manager or access a real default store. Cover negative
  authorization, option injection, cross-origin/cookie attacks, ciphertext substitution,
  expiry and JSON/inspect/error redaction. Run package gates and root lint; do not commit.

## Agent persona

None specific; the library is a host credential boundary, not application UI.
