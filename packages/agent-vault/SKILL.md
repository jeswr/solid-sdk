---
name: agent-vault
description: Use when implementing or consuming @jeswr/agent-vault, host-only browser account resolution, encrypted secrets and sessions, 1Password CLI accounts, permission decisions, session capture or keep-alive.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/agent-vault

Read README.md and the agent-credentials, site-executor and agent-browser package skills.
Private, security-critical Node 24 package. Keep the shared site-model/executor contracts
unchanged. Use the existing dependency set; runtime network, process, clock/timer, password
login and interactive login are injected seams.

- Reuse CredentialStore.privateRecord/putPrivateRecord for all disk access. Preserve 0700/
  0600, ownership checks, no-follow reads, atomic writes, and exclusive key initialization.
- Keys and plaintext live in Secret wrappers. Error messages are fixed, with no external
  cause or stdout/stderr. Preserve opaque JSON/string/inspection for nested session objects.
  Trusted host callbacks can access plaintext; do not expose them or results to planners.
- Facts use n3.Parser/Writer. No credential values in labels, route metadata or refs. Keep
  SSO provider accounts in the same profile. Persona hints filter; explicit lastUsed breaks
  remaining ties. Otherwise ask; never silently cross accounts, profiles or purposes.
- Backend adapters are host provisioning seams. AgentVault applies PermissionPolicy before
  every operational secret read/save/TOTP. Persistent never decisions and revocation are
  as important as grants. Saving requires the backend's declared eligible profile.
- 1Password: configure each CLI account and profile separately with a vault. Desktop mode
  delegates unlock/Touch ID to op. Service mode injects a Secret token into only the child's
  OP_SERVICE_ACCOUNT_TOKEN; provision that service account for one vault only. Never inherit
  OP_SESSION/service credentials, put secrets in argv, run a shell, or log CLI diagnostics.
  Creates/updates use JSON stdin; reads use stdout. Exact origin is default; any domainGroups
  must be operator-vetted registrable domains, never guessed public suffixes.
- Captures need an authenticated browser sender/transaction outside this library. Validate
  site/account/time, cookie domains/prefixes and same-origin token endpoint before storing.
  Use account id as executor persona. Do not broaden parent cookie domains automatically.
- Refresh only the exact site origin, use manual redirects, validated pointer extraction and
  finite expiry. Frequent probes are opt-in. Keep the floor/backoff and stale-on-401 behavior;
  stop must prevent late in-flight persistence. No default global fetch or timer.
- Tests use fictional data, temporary stores and fakes for external boundaries, including
  spawn. Never invoke a real password manager or access a real default store. Cover negative
  authorization, option injection, cross-origin/cookie attacks, ciphertext substitution,
  expiry and JSON/inspect/error redaction. Run package gates and root lint; do not commit.

## Agent persona

None specific; the library is a host credential boundary, not application UI.
