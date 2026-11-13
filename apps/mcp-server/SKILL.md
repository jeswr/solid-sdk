---
name: mcp-server
description: Use when implementing the Node composition app for the W9 MCP server.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# MCP server composition

Read the W9 `specs/mcp/DESIGN.md` and MCP-11 task in the planning repository before
composing transports, OAuth or consent. This is a private Node >=24 ESM app, with a
plain node:http entry and an exported Web Request → Promise<Response> handler.
The app composes the existing MCP HTTP transport, OAuth core, encrypted atomic vault,
and broker sessions. Browser completion requires the flow cookie, callback state,
same-origin form POST and single-use CSRF-protected consent. Never expose the core's
trusted authorize seam as an unauthenticated route. Consent must show the exact request redirect
and emphasize its host, mark DCR names "unverified (self-declared)", and identify metadata-document
clients by the client_id URL host. Use mcp-oauth's consentDisplay(context) for escaped, bidi-isolated untrusted values
and punycode hosts. Registration rejects Unicode control/format characters in client names.
Check record-envelope expiry in get/consume even if the vault ignores TTLs. Keep original ten-minute TTLs on
browser/pending state and consumption markers; DCR expires at thirty days with max ten redirects.
Unused codes expire at five minutes; used code evidence stays through grant expiry. Permanent
session revocation tombstones never receive ephemeral TTLs. OAuth records and the signing key
share the vault; Vercel requires shared KV. Single-user mode requires a separate MCP
bearer and keeps CSS DPoP credentials server-side. Preserve read-only defaults.
Fragment WebID login resolves the profile issuer and binds the callback to that exact
verified WebID. Native continuation links preserve form-action 'self' without scripts.
Keep the app's CSS adapter fail-closed: verify actual LDP types before translating
create-only container conflicts, and byte-verify strong binary validators with unique
memory-mutex ownership markers. Never adopt a replaced lock or a weak validator.

Internal dependencies must use workspace:*. Use fixtures and injected services in tests.
Run lint, build, typecheck and test through pnpm. Do not deploy or publish from this task.

Connector acceptance lives in `test/connectors.e2e.test.ts`; `test:e2e` runs it and the
original CSS suite sequentially, while `test:e2e:connectors` selects it alone. Reuse
`test/css.ts` for native browser forms, CSS controls, account seeding and TLS lifecycle.
Discover endpoints from the protected-resource challenge/AS metadata, retain Claude's
and ChatGPT's exact HTTPS callback URIs, and intercept callbacks before network access.
Both CIMD and DCR are advertised and must pass. Keep metadata serving on local TLS,
CSS behind the loopback-only Unix-socket proxy, and non-local client fetches refused.
Search tests use generic notes outside private/pkg; do not expose protected PKG memory
to satisfy generic search. Pin current agent/context listing behavior until sst-5ax.38,
with its named acceptance todo. Use a shared issuer/key/store for wrong-audience tests.
