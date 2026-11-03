---
name: agent-credentials
description: Use when working on the private credential store, PKCE login, provisioning, or purpose-separated token supply in @jeswr/agent-credentials.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/agent-credentials

Read README.md and agent DESIGN §9.2. Node >=24, ESM, private security-critical package;
maintain 100% branches/functions/lines/statements coverage. Source imports use bare Node
builtin names because the agent layer guard forbids colon-containing specifiers.

Ported from pilot credentials and action providers. Preserve owner-only 0700 directories,
0600 records, O_EXCL temporary writes + fsync + rename, O_NOFOLLOW reads, account/tenant/client
pinning, signed OIDC ID-token checks, and per-profile refresh locks. Never fall back across
provider, account, purpose or resource. A read grant cannot supply a send token even when
its OAuth scopes include send. Missing or ambiguous profiles fail closed.

Tests always supply a temporary store directory, fake transport and reserved example accounts.
Never open the real default store, run a real op executable or contact a live provider. Network
is injected explicitly; absent transport refuses. Keep ./testing synthetic and deterministic.
The provisioning shell test prepends a fake op to PATH. Its POSIX-compatible zsh script can
also be tested with bash when zsh is unavailable. No runtime use of 1Password.
