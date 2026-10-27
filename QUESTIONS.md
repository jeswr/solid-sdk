<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Lane sst-8xm.13 interpretations

1. Brief, Task (messages contain URL and event only; keep `UpdatedEvent` consumers working):
   options are to retain ETags on existing broadcasts or retain only their optional type field.
   Use the latter: keep `UpdatedEvent` and its optional `etag` source-compatible, but emit
   only `{ url, event }` from revalidation and invalidation. Outcome objects still carry ETags.
2. Brief, Task (`status.ts` transitions): options are to track every broadcast URL or retain
   the existing tracked-resource boundary. Retain that boundary; consumers track URLs with
   `markFresh`, `markStale`, or `markPending`. A failed revalidation retains settled
   freshness, including manual marks made during the attempt; a manual pending state remains pending.
3. Brief, Acceptance criteria (offline): options are to invent a revalidation for an offline
   cache read or pair only attempts that actually start. Retain offline cache reads without
   a revalidation or lifecycle messages; an attempt rejected because connectivity drops emits
   `revalidating` followed by `revalidate-failed`. Non-authoritative HTTP responses also fail
   confirmation and emit `revalidate-failed`.
