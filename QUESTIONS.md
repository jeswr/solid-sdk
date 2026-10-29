<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Lane sst-8xm.13 interpretations

1. Brief, Task (messages contain URL and event only; keep `UpdatedEvent` consumers working):
   options are to retain ETags on existing broadcasts or retain only their optional type field.
   Use the latter: keep `UpdatedEvent` and its optional `etag` source-compatible, but emit
   only `{ url, event }` from revalidation and invalidation. Outcome objects still carry ETags.
   Fix round 3 supersedes the exact message shape as recorded in interpretation 4.
2. Brief, Task (`status.ts` transitions): options are to track every broadcast URL or retain
   the existing tracked-resource boundary. Retain that boundary; consumers track URLs with
   `markFresh`, `markStale`, or `markPending`. A failed revalidation retains settled
   freshness, including manual marks made during the attempt; a manual pending state remains pending.
3. Brief, Acceptance criteria (offline): options are to invent a revalidation for an offline
   cache read or pair only attempts that actually start. Retain offline cache reads without
   a revalidation or lifecycle messages; an attempt rejected because connectivity drops emits
   `revalidating` followed by `revalidate-failed`. Non-authoritative HTTP responses also fail
   confirmation and emit `revalidate-failed`.
4. Fix-round-3 review, finding 1 (synchronize active attempts on subscription or correlate
   terminal messages with starts): choose correlation with an opaque random `attemptId`
   shared by the two lifecycle messages. This is the smaller change; URL-only events cannot
   distinguish a missed start from a newer observed attempt without a subscription protocol.
   Add the identifier as an optional field to preserve existing event consumers and legacy
   senders. Legacy messages keep separate URL-based counts and cannot settle identified work;
   legacy senders themselves cannot provide the missed-start guarantee. No response metadata
   is added. Starts missed before subscription are not included in pending counts.
