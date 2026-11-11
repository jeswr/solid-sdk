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
| `FEEDBACK_GITHUB_REPO` | Existing **private** repository as `owner/name`. The store checks privacy before writing. |
| `FEEDBACK_ALLOWED_ORIGINS` | Comma-separated exact origins permitted to call feedback routes. Defaults to the request deployment origin, `NEXT_PUBLIC_PUBLIC_SUITE_URL` (or `https://solid-suite.vercel.app`), `VERCEL_PROJECT_PRODUCTION_URL` if set, and HTTP/HTTPS localhost origins. An explicit list replaces these defaults. Include the web deployment and `https://localhost,capacitor://localhost` for native clients. |

The optional `NEXT_PUBLIC_SUITE_VERSION` and `NEXT_PUBLIC_SUITE_COMMIT` identify the client
build in each record. Native clients use the existing `NEXT_PUBLIC_PUBLIC_SUITE_URL` for
these API requests. API route handlers are excluded from native staging and its manifest;
the native artifact checker rejects an exported `api/` directory.

Submissions commit each recording and `submission.json` under
`feedback/<yyyy-mm-dd>/<uuid>/`, then open an issue. Audio links use immutable commit URLs
and require repository membership. Issue labels are `feedback`, `pathway:guided` or
`pathway:quick`, and `app:<slug>`. Pre-create these labels; a 422 retries without labels.
Only the issue number is returned to the participant. Participant Markdown and HTML are
escaped and mentions neutralised. Full verbatim records remain in the private JSON file.
The issue body is bounded to GitHub's limit; long records retain the full transcript in JSON.
Contents updates are sequential. A failure can leave already committed files without an
issue; retrying creates a new submission, so maintainers may need to deduplicate these.

Both POST routes require an allowed Origin, validate and rebuild inputs, and stream-read
within body caps before parsing. The interviewer accepts at most 40 messages of 4000
characters, text only, and produces at most 4000 tokens. Requests carry the most recent 40 messages plus all structured answers. After 40 user
answers the client continues with the plain guide while preserving its full transcript. Per visitor limits
are 30 interviewer requests per ten minutes, 120 per rolling day, and five submits per hour.
IPv6 addresses share a /64 allowance. Each server instance caps 2000 turns and 200 submissions
per UTC day. Counters live in memory and reset on restart; use an Anthropic workspace
spend limit as the account-level cap. Deploy behind a proxy that overwrites `x-real-ip`
and `x-forwarded-for`. No participant text or audio is logged by these handlers.

Audio capture always uses MediaRecorder, including when Web Speech dictation is available.
The live transcript fills the answer box for review. Without dictation the interviewer
receives `(voice answer recorded; no transcript)` and the recording is still attached.
Each clip stops at two minutes, up to ten clips, with a 4 MB server limit per clip and
magic-byte checks for WebM, Ogg and MP4. Speech recognition may use the browser vendor's
service. Audio stays in memory until submission or download; leaving the page loses an
unsent record. Browser and native OS microphone permissions are required.

If storage is missing, submission returns 503. The page always offers **Download my feedback**:
a ZIP containing `submission.json`, `feedback.md`, and all audio files. It also offers this
when a request fails. Native WebViews use the existing platform save sheet for the ZIP.
The server body cap is 42 MB, with 1 MB for JSON. The deployment's
request size/time limits must accommodate the desired recordings; deployments with lower
limits will reject larger uploads and participants can retain them using the download.
