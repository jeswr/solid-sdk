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

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
## Groups and family (sst-581h)

Settings → Groups & family manages shareable `vcard:Group` documents in the owner's
`groups/` container, separately from Contacts' private labels. Names and member WebIDs
are publicly readable so the Solid server can resolve `acl:agentGroup`; only the owner
can change membership. The UI explains this before creation. Group sharing is disabled
on ACP, LWS and unknown access models.

Drive/Docs and the shared Tasks/Sheets dialogs offer groups with member counts, preserve
symbolic group grants when people are edited, and send each member one inbox Announce
attempt per group/resource. Removing a group from a multi-resource item (a Tasks project)
removes the data folder first, and the dialog keeps listing a group while any backing resource
still holds it. Permissions displays groups and expandable membership.
Removing a member ends group-derived access when the server next checks membership;
other grants, server caches and downloaded copies are unaffected. Deletion first displays
the owner's pod resources using the group, rescans, and removes those grants. An incomplete
or unsupported scan blocks deletion. Foreign-pod grants cannot be enumerated here.

Family setup marks one group, creates optional Calendar, Photos and Tasks spaces through
the existing application models, grants Viewer or Editor access, and sends one invitation
attempt per member. The Family calendar is always a new, uniquely named calendar
(`calendar/family-<uuid>.ttl`); an existing calendar folder is never adopted and shared.
The Family Photos space is the album. Album membership only references photos, so adding a photo
to an album shared with groups grants those groups Viewer access to the photo's item document,
original and thumbnail (`apps/photos/lib/data/album-groups.ts`); a failure is reported and the
album edit is kept. Removing a photo from the album does not revoke that access.
Progress/notification receipts are kept privately in `settings/group-sharing/`. Failed delivery does not undo permissions; claims are recorded
before delivery to prevent duplicate notifications. Multi-resource setup/deletion is not
atomic: partial failures are shown for review and explicit recovery.

The demo seeds a fictional Family and Garden team. Library behavior and its limitations are
in [suite-groups](../../packages/suite-groups/README.md); `e2e/groups.spec.ts` covers creation,
Drive sharing and Permissions in all configured widths and themes.
