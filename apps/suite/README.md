<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
# Solid Suite

The Next.js application is `@jeswr/app-suite`. Use Node 24 and the root pnpm workspace.

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
one automatic retry (except during a storage cooldown) and a visible saving state. The server
validates the MIME and magic bytes,
creates a Git blob in the private feedback repo, and returns `{ submissionId, sha, size, ext, sig }`.
The client creates a random submission UUID when the interview starts and sends it as the
`submissionId` query parameter on every audio upload.
The signature contains the expiry as `expiry.hmac`; HMAC-SHA256 authenticates
`submissionId|sha|size|ext|expiry` with a repository-scoped derived key. Receipts expire
after two hours.
`POST /api/feedback/submit` accepts JSON only (at most 1 MB):
`{ submissionId, record, receipts }`, with up to ten authenticated, unexpired receipts.
Receipts from another submission, unknown/forged receipts and duplicate blob SHAs are refused.

Submissions create one atomic Git Data API commit containing all receipt audio blobs,
`submission.json` and `summary.md` under `feedback/<yyyy-mm-dd>/<uuid>/`, then open an issue.
The UUID is the client's submission ID. The same commit reserves it in
`feedback/submissions/<uuid>.json` with a digest of the record and audio and the record directory.
Concurrent writers check this index against each branch head before committing; an ID cannot
save different feedback (409). Identical retries make one GitHub search scoped to the feedback repository
and the issue body's submission marker, including closed issues and excluding pull requests.
Recovery never paginates through the repository's issue history. If the search finds no issue,
the store resumes issue creation using the original record directory, without another record commit.
Overlapping issue creation within one instance returns 503 until the current request finishes.
The first submit attempt freezes the serialized record and keeps it with its submission ID and
recording receipts in `suite.feedback.draft.v1` local storage. Retries, including after a reload,
resend that record verbatim. Answers and contact details stay read-only until completion;
**Start a new submission** clears the frozen draft and starts a fresh interview with a new ID.
Completion clears the local draft. Audio files remain in the open page for download and receipt renewal.
The store reads the private repo's default branch once and uses the current head tree as the
base, preserving path segments in branch names such as `team/main`. A non-fast-forward 422
re-reads the head and retries the tree/commit/ref update up to
five times with jittered backoff, without forcing the ref or re-uploading blobs. No issue is
opened until the ref update succeeds. Audio links use immutable commit URLs and require
repository membership. Issue labels are `feedback`, `pathway:guided` or `pathway:quick`, and
`app:<slug>`. Pre-create these labels; a 422 retries without labels. Only the issue number is
returned to the participant. Participant Markdown and HTML are escaped and mentions neutralised;
titles use plain text sanitisation. Full verbatim records remain in the private JSON file.
The issue body stays under 60k characters with a closed transcript disclosure and an external
full-record link. An issue failure may leave a committed record without an issue; participants
can retry to recover its reference or resume creation. Recovery uses at most six GitHub calls
(metadata, head, index, one search and up to two issue POSTs for the label fallback). Reads
have 30-second timeouts; search and issue creation share one 30-second deadline. GitHub search
indexing and in-memory coordination cannot guarantee exactly-once issue creation across
instances or after an uncertain POST response. Abandoned uploads can leave unreferenced Git
blobs; uploading a recording does not create an issue.

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
GitHub core responses with fewer than 50 remaining requests or a 403/429 rate limit start a cooldown.
Uploads and new submissions check it before their first write. An admitted submission finishes
its commit and issue creation even if a successful response starts the cooldown; an actual
403/429 still fails without retrying. Uploads and submissions share an instance cooldown
until the primary reset or `Retry-After` deadline (60 seconds when neither is available).
The `x-ratelimit-resource: search` budget has its own cooldown at five or fewer requests
remaining (out of GitHub's 30-request search limit). It skips recovery searches until reset,
asking only the affected submissions to retry later; uploads and new submissions remain available.
The API returns a friendly 503 with `Retry-After`; the page asks participants to try later
and keeps their answers and audio available through **Download my feedback**.

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
