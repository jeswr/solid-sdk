---
name: agent-channels
description: Use when working on the channel bindings and carriage profiles surface in @jeswr/agent-channels.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# @jeswr/agent-channels

Read agent DESIGN §2–3 and the package README before changing behavior. A-005
implements the contracts, shared legacy message/adapter shapes, frozen carriage
profiles, capability RDF, guarded origins and the in-memory direct test binding.
Provider modules remain reserved for their individual tasks.

A-025 implements `./graph-teams` (`createGraphTeamsReader`, `ORIGINS`) and the
executor-only `./graph-teams/send` (`createGraphTeamsSend`). Ingest uses Graph-only
bounded collection paging with resumable, account-scoped pending messages; channel
403s degrade the RDF descriptor without disabling chats. Use a reader per tenant/account.
Share HTML projection and envelope codecs. `teams-card/0.1` carries the envelope
in Adaptive Card `data.envelope`, with matching visible text, an escaped HTML body
referencing the same stable attachment ID, and the required footer. Ingest projects
HTML only; text bodies and display names retain literal markup while stripping controls.
Acknowledgements use Teams' 64 KiB string / 1 MiB response JSON bounds, reading only
the message ID. Bind sender account, pinned chat and exact request in the approved
wire. Reads retry 429/503 with injected sleep/clock under attempt and wait bounds;
POST never retries because Graph chat sends have no idempotency key. No lookup or
final absence is advertised. See the README for poll, byte and consent limits.

Follow ADR-001 D4: Node >=24, ESM exports, workspace dependencies, strict TypeScript,
Biome, and Vitest. Maintain 100% branches/functions/lines/statements coverage.

Every send half must provide `preview(wire): Promise<string>`: a pure, bounded,
hostile-input parser of the wire itself, throwing ChannelParseError on refusal.
Never re-render or consult a verifier, resolver, credentials or transport to preview.
Preserve visible text and whitespace; refuse invisible characters via `previewText`.
Parsers are closed-world (`exactKeys`): any field the renderer doesn't write refuses.
MIME previews are `To: <header>\nSubject: <header>\n\n<decoded text/plain including
footer>`; normalize only the decoded body's CRLF to LF, require the HTML alternative to
equal `renderHtml(plain, carrier)` and refuse extra headers. Matrix uses content.body;
Teams uses its single card TextBlock and requires the matching HTML body; Mastodon uses
request.status; Discord joins content and its embed footer with LF. Whenever the wire
delivers the signed envelope (email, Teams, native Matrix), append it with
`withSignedMessage`, which puts the one-line signed JSON first, refuses human text that
contains a preview heading, and refuses previews over the 16384-character record limit. Direct carries only a native signed envelope and previews as the
signed message's canonical JSON. Slack and
other reserved send scaffolds must implement wire-derived visible previews when
they acquire send capability. Executor refusal is preview-mismatch (including parse
failures), audited like wire-mismatch before authority or credential work.

Never use live providers or credentials in tests. Fakes belong in `./testing`;
production imports of that surface fail layer lint. Send implementations belong
exclusively in channel send subpaths, importable only by agent-executor and channel
tests. The guard permits only testing.ts's direct/send factory re-export for
test composition. Read credentials come only from TokenProvider.read; send
credentials come only from TokenProvider.send. Sending defaults to dry-run.
Every send must thread the executor's required synchronous io.assertAuthority()
through the scoped fetch call's request-local beforeDispatch hook. Transport factories
must run it after all awaits, including both outer and inner DNS/destination checks
and body buffering, immediately before underlying dispatch with no intervening await.
Recheck signed-message freshness there too. Direct delivery fences its local effect.
Wrap every local failure before effectful send dispatch in SendNotDispatchedError,
retaining the original cause and error type. Preserve ProviderRejectedError identity.
A read-only Matrix room-state preflight is not a send dispatch; errors after an actual
send dispatch retain their provider/uncertain meaning. Read-only ingest needs no fence.
Credential release alone is not continuing send authority.
Matrix transmit's room-state preflight also uses only the executor's io.tokens.send;
the construction-time read provider is exclusively for lookup. Refuse encrypted or
unreadable rooms. Export typed provider refusals through ./provider/send so the executor
can preserve definitive non-delivery without importing any reader.
Exception: the read-only GitHub binding (A-033) delegates authentication entirely
to `gh auth` and never consumes a TokenProvider. Keep its executable, host, GET
method and endpoint families fixed; invoke with an argument array and no shell.
Never follow notification URLs or expose child-process stdout/stderr in errors.
The daemon binds each reader's opaque account to a fixed active gh auth context.
There is no GitHub send half; the descriptor must keep sendSupported false.
The direct verifier is injected, local and pure; parsing never verifies signatures.
Reuse agent-model's capability record mapping rather than minting duplicate terms.
Only agent-model-gateway may
import OpenAI or Anthropic SDKs; the gateway must never import agent-audit.
