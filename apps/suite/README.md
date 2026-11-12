<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
# Solid Suite

The Next.js application is `@jeswr/app-suite`. Use Node 24 and the root pnpm workspace.

## Assistants

Settings > Assistants offers Claude/ChatGPT OAuth setup and connected-assistant management and a read-only personal-data audit view.
Set `NEXT_PUBLIC_SUITE_MCP_URL` to the canonical HTTPS assistant endpoint with path exactly `/mcp`
and no userinfo, query or fragment; unset/invalid runtime values show setup fallback text.
The page reads the owner's monthly `private/pkg/audit/YYYY-MM.ttl` files through
`@jeswr/mcp-connections`, showing at most 100 newest metadata rows from the newest three files.
Personal values and resource URLs are never displayed. Unreadable/malformed or oversized data
shows an error with Retry; a missing audit container is empty. Offline views ask to reconnect,
and account changes discard the previous account's rows. Demo pods include metadata examples.
The page lists at most 100 direct 32-hex connection records with six concurrent bounded reads,
reports unreadable records, and separates active assistants from previously connected ones.
Disconnect requires confirmation, reads a fresh strong ETag, preserves the earliest revocation
and retries once on 412; it is unavailable offline. Failures show a generic retry message.
Connection names also label matching audit rows. Demo pods include list/disconnect fixtures. For a single-user server, revoke access by
rotating `MCP_ACCESS_TOKEN`; such servers write no connection records.
See `src/shell/settings/assistants/SKILL.md` for maintenance and test rules.

Assistant audit categories use the shared MCP labels, including all memory special categories
and Financial. Decision tokens display as plain user text and timestamps use the viewer's
local timezone. The registered-assistant label requires a /clients/ path on the configured
MCP server host; other clients show their host and a path shortened to 32 characters,
without query or fragment. Session-opening failures offer Retry, which reopens the provider.
The audit, Contacts and agent readers share guarded-fetch's bounded strict UTF-8 reader;
malformed UTF-8 fails closed. Their existing byte budgets and size-error messages remain.
Audit/listing and connection reads share one uncached, scoped, redirect-refusing HTTP 200 path,
with 256 KiB and 64 KiB byte caps respectively and the validator for those exact bytes.
Assistant visual snapshots run only for 375-light and 1280-dark; axe runs in all six projects.

## Pilot feedback

`/feedback` is available without signing in. It offers a guided interview and a quick note,
with typed answers and optional audio. The interview source of truth is
[the pilot interview](docs/pilot-feedback-interview.md), encoded in `src/feedback/guide.ts`.
The committed eight-stage guide takes precedence over earlier questionnaire drafts.
The root agent layer guard permits the Anthropic SDK only in this app's manifest and
`src/feedback/server.ts`; other app and browser SDK imports remain forbidden.
The server-safe app-name projection in `src/feedback/apps.ts` is checked against every
UI registry app by the guide integrity test because the UI registry is a client module.
SEQ and both UMUX-Lite items use 1 to 7. The optional context of the walkthrough is read
from `suite.walkthrough.v1` (`{ "done": ["drive"] }`); only registry app slugs are accepted.
Participants confirm or correct the read-back before the interview is marked complete.
They can also submit an incomplete record at any point.

Configure these variables on the deployed server. Never prefix secrets with `NEXT_PUBLIC_`.

| Variable | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` | Enables the interviewer. Without it the same guide works as a plain form. |
| `FEEDBACK_MODEL` | Interview model, defaults to `claude-opus-5-5`. Uses low effort and structured JSON output. |
| `FEEDBACK_GITHUB_TOKEN` | Fine-grained token restricted to the destination repository, with Contents and Issues write permission and repository metadata read access. |
| `FEEDBACK_RECEIPT_SECRET` | Optional dedicated secret for audio receipts; otherwise a signing key is derived from `FEEDBACK_GITHUB_TOKEN`. Rotating the signing secret invalidates outstanding receipts. |
| `FEEDBACK_GITHUB_REPO` | Existing **private** repository as `owner/name`. The store checks privacy before writing. |
| `FEEDBACK_ALLOWED_ORIGINS` | Comma-separated exact origins permitted to call feedback routes. Defaults to the request deployment origin, `NEXT_PUBLIC_PUBLIC_SUITE_URL` (or `https://solid-suite.vercel.app`), `VERCEL_PROJECT_PRODUCTION_URL` if set, and HTTP/HTTPS localhost origins. An explicit list replaces these defaults. Include the web deployment and `https://localhost,capacitor://localhost` for native clients. |

The optional `NEXT_PUBLIC_SUITE_VERSION` and `NEXT_PUBLIC_SUITE_COMMIT` identify the client
build in each record. Native clients use the existing `NEXT_PUBLIC_PUBLIC_SUITE_URL` for
these API requests. API route handlers are excluded from native staging and its manifest;
the native artifact checker rejects an exported `api/` directory.

Recordings upload individually to `POST /api/feedback/audio` as soon as they stop, with
one automatic retry and a visible saving state. The server validates the MIME and magic bytes,
creates a Git blob in the private feedback repo, and returns `{ sha, size, ext, sig }`.
The signature contains the expiry as `expiry.hmac`; HMAC-SHA256 authenticates
`sha|size|ext|expiry` with a repository-scoped derived key. Receipts expire after two hours.
`POST /api/feedback/submit` accepts JSON only (at most 1 MB): `{ record, receipts }`, with up
to ten authenticated, unexpired receipts. Unknown/forged and duplicate blob SHAs are refused.

Submissions create one atomic Git Data API commit containing all receipt audio blobs,
`submission.json` and `summary.md` under `feedback/<yyyy-mm-dd>/<uuid>/`, then open an issue.
The store reads the private repo's default branch once and uses the current head tree as the
base. A non-fast-forward 422 re-reads the head and retries the tree/commit/ref update up to
five times with jittered backoff, without forcing the ref or re-uploading blobs. No issue is
opened until the ref update succeeds. Audio links use immutable commit URLs and require
repository membership. Issue labels are `feedback`, `pathway:guided` or `pathway:quick`, and
`app:<slug>`. Pre-create these labels; a 422 retries without labels. Only the issue number is
returned to the participant. Participant Markdown and HTML are escaped and mentions neutralised;
titles use plain text sanitisation. Full verbatim records remain in the private JSON file.
The issue body stays under 60k characters with a closed transcript disclosure and an external
full-record link. An issue failure may leave a committed record without an issue; retrying
creates a new submission, so maintainers may need to deduplicate these. Abandoned uploads can
leave unreferenced Git blobs; uploading a recording does not create an issue.

All three POST routes require an allowed Origin, validate and rebuild inputs, and stream-read
within body caps before parsing. The interviewer accepts at most 40 messages of 4000 characters,
text only, which must strictly alternate and end with a user answer. Each model request is
bounded to 24k input characters including collected answers; older exchanges are dropped while
preserving the first message and recent context. Oversized structured answers are rejected.
The model receives a small constraint-free schema of string updates and produces at most
1500 tokens. Server-side coercion and Zod validate ratings, choices and multi-select answers
(delimited by `|`) before merging with collected answers. After 40 user answers the client
continues with the plain guide while preserving its full transcript. Per visitor limits are
30 interviewer requests per ten minutes, 120 per rolling day, 20 audio uploads per hour, and
five submits per hour. IPv6 addresses share a /64 allowance. Each server instance caps 2000
turns, 2000 audio uploads and 200 submissions per UTC day. **All these limits are per instance**;
in-memory counters reset on restart and do not coordinate across instances.

**Required deployment step: configure an Anthropic workspace spend limit before enabling the
interviewer.** This is the account-level cap across instances. Deploy behind a proxy that
overwrites `x-real-ip` and `x-forwarded-for`. No participant text or audio is logged by these
handlers. Run the optional real-API smoke test with `FEEDBACK_LIVE_TEST=1` and
`ANTHROPIC_API_KEY` set: `npx vitest run --coverage.enabled=false test/feedback-live.test.ts`.
It makes one billable interview turn and is skipped otherwise.

Audio capture always uses MediaRecorder, including when Web Speech dictation is available,
requesting 32000 bits/second where supported. The live transcript fills the answer box for
review. Without dictation the interviewer receives `(voice answer recorded; no transcript)`
and the recording is still attached. Each clip stops at two minutes, up to ten clips of
3 MB each, with magic-byte checks for WebM, Ogg and MP4. Speech recognition may use the browser
vendor's service. Raw audio also stays in memory for the download fallback; leaving the page
loses the local unsent record. Browser and native OS microphone permissions are required.

If storage is missing, submission returns 503. The page always offers **Download my feedback**:
a ZIP containing `submission.json`, `feedback.md`, and all audio files. It also offers this
when a request fails. Native WebViews use the existing platform save sheet for the ZIP.
Vercel Functions have a **4.5 MB request body limit** and can reject oversized requests
before the handler runs, with a non-JSON 413. Each audio request carries just one raw clip
of at most 3 MB; the final JSON submit is capped at 1 MB. Ten clips never share one request.
All turn, audio and submit failures, including non-JSON platform errors, show friendly local
messages and keep the in-memory download available.
