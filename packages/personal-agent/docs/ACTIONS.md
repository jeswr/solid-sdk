# Deterministic actions (operator guide)

Common personal-agent operations as typed, validated, machine-described **actions** that run
without any language model, hosted classifier or other inference. The same catalogue is available
from:

- the operator CLI (`awp-dashboard actions …`);
- an MCP server (`awp-dashboard actions mcp`);
- the dashboard's **Actions** page (previews only).

Code: `src/actions/`. Provider configuration contract: [`PROVIDER-ACTIONS.md`](PROVIDER-ACTIONS.md).
Credential helper and provider setup: [`PROVIDER-SETUP.md`](PROVIDER-SETUP.md).

## Principles

- **Authority comes from the owner's settings, never from the input.** An action's input may
  come from:
  - an operator;
  - a structured agent message;
  - a reviewed natural-language extraction.

  Whatever the origin, each action checks the owner's dashboard settings:
  - account inclusion;
  - per-account read, triage and draft switches (for messages and replies);
  - per-calendar "may read availability" (for calendars — never an account's "Read messages");
  - the imported communication policy.

  A denial refuses the action before it runs. The origin is fixed by the calling surface
  (`operator-cli`, `mcp`, `dashboard`); no input field can claim one, and a marker in a message
  proves nothing. Time zone and working-hours overrides are accepted only from the owner's and
  operator's surfaces, never from `structured-message` or `reviewed-extraction` origins.
- **Effects are classified and separated.**
  - `read`: nothing changes.
  - `prepare`: content or a plan for review; nothing changes.
  - `local-write`: changes local agent state; never a provider.

  Only `local-write` actions have an **execute** step. Preparation returns a single-use token
  bound to the validated input and the action's version, valid for 10 minutes. Execution takes
  only that token, re-checks the preparation's digest, version and expiry and the permissions,
  and is available only to operator origins (CLI, MCP). The dashboard never executes.
- **Unknown or unsupported means not done.** The statuses are `ok`, `blocked` (data incomplete),
  `needs-setup`, `needs-review` and `refused`, each with reasons. Nothing is turned into an
  invented success, and a result outside the action's declared schema is withheld.
- **No new policy engine.** The one effectful action hands off to the agent's own runtime. There,
  the pinned-peer trust store, the owner mandate and the recorded policy module (SPARQ) apply as
  for any other runtime operation.

## Catalogue

| Action | Effect | Needs | What it does |
|---|---|---|---|
| `calendar.availability` | read | calendar.read-availability | Ranked free times over **every** calendar the owner marked as counting for availability: the agent's synthetic calendar, dashboard synthetic calendars, Google (freeBusy) and Microsoft (Graph calendarView). Returns slots, merged busy time and per-source coverage. |
| `meeting.prepare-proposal` | prepare | calendar.read-availability | Fresh availability plus plain-text email and chat templates and a structured option list (`awp-meeting-options/0.1`). |
| `meeting.check-slot` | prepare | calendar.read-availability | The confirmation step: re-reads every calendar for one chosen time and says whether it is still free. Books nothing. |
| `agent.propose-meeting` | local-write | a managed agent and a pinned peer | Prepare checks the agent, the peer and the applied availability. Execute (operator only) starts a scheduling negotiation in the agent runtime and writes its first signed message (discovery) as a reviewed outbound file. Nothing is sent. |
| `contact.lookup` | read | a managed agent | Operator-pinned keys (recorded, not a verification), pinned A2A endpoints (transport only), addresses in the owner mandate (signature verified now; validity checked), and remembered scheduling endpoints with their confirmation state; reports certainty (`recorded`, `uncertain`, `conflict`, `unknown`, `unavailable`). |
| `message.prepare` | prepare | the account's draft permission and the `draft` policy | An availability reply, acknowledgement or follow-up from structured fields and fixed templates, rendered as mail or chat. Local content only; an availability reply states that it checked no calendar. |
| `inbox.normalise` | read | per account: included, read, triage and the `classify` policy | A deterministic action queue from **supplied** items, using explicit rules. |
| `capabilities.matrix` | read | — | What the code can do per provider family, joined with the owner's accounts. |

Descriptors (JSON Schema for input and result, effect, capabilities, limitations and examples)
come from `actions describe --id …`, the MCP `list_actions` / `describe_action` tools, or
`GET /api/actions`.

## Running actions

```sh
npm run build
node dist/dashboard/cli.js actions list
node dist/dashboard/cli.js actions describe --id calendar.availability
node dist/dashboard/cli.js actions prepare --id calendar.availability --input request.json   # or --input -
node dist/dashboard/cli.js actions execute --token <token from a prepare of a local-write action>
node dist/dashboard/cli.js actions mcp            # stdio MCP server: list/describe/prepare/execute
```

Common options:

- `--state DIR` (default `.awp-dashboard`): the owner settings;
- `--agents-dir DIR`;
- `--now ISO`: the synthetic scheduling clock;
- provider access: `--provider-config FILE`, `--provider-fixtures`, or neither.

The CLI exits `0` for `ok` and `2` otherwise, and prints the full report as JSON. CLI
preparations are kept so that `execute` can run in a later process: one `0600` file per
preparation in the `0700` directory `<state>/action-preparations/`, named by a hash of the token.
Execution claims a file by an atomic rename, so exactly one of several concurrent executions runs
(tested with six processes). A file that was changed, is corrupt, or was prepared for another
action version is refused.

Example `request.json` for availability:

```json
{ "window": { "start": "2026-10-20T00:00:00Z", "end": "2026-10-23T00:00:00Z" },
  "durationMinutes": 30, "bufferMinutes": 10, "maxProposals": 5, "ranking": "spread" }
```

### Dashboard

The **Actions** page shows:

- the provider mode (none, fixture or live) and the scheduling clock;
- which calendars the actions may read;
- per account: whether it is included, whether reply preparation and queueing are allowed, and
  its provider credential state (configured, simulated by fixtures, or none).

Each action has a description, its needs and limitations, and a JSON input prefilled with an
example. **Run preview** calls `POST /api/actions/:id/prepare`, which uses the existing session,
CSRF and body limits. The result is rendered as:

- proposed times with per-calendar coverage;
- prepared text;
- queue, channels or matrix tables;
- the full JSON.

For `local-write` actions, preparation checks are shown and execution is refused
("operator step").

### Fixture demo (synthetic Google and Microsoft calendars)

A separate, ignored state `.awp-dashboard-actions-demo/` was prepared with `demo-setup` (SPARQ)
and `demo-provider-fixtures`. Start it with:

```sh
npm run dashboard:actions-demo   # serve --state .awp-dashboard-actions-demo --port 4319 --now 2026-10-19T08:00:00Z --provider-fixtures
```

The fixtures (`src/actions/providers/fixtures.ts`) answer the real request shapes with invented
events, 19–28 October 2026:

- Google: a primary calendar and a shared calendar;
- Microsoft: a primary calendar with a daily recurring stand-up, which moves across the UK DST
  change; tentative, free, cancelled and all-day out-of-office events; paged 3 per page;
- Microsoft: a secondary calendar.

The runtime availability of that state shows *blocked*, correctly: the agent runtime cannot read
provider calendars, so booking stays fail-closed while they count. The `.awp-dashboard/` state
behind the running dashboard was not changed.

## Availability in detail

- **Sources:** all authoritative calendars in the owner's settings. The input cannot choose a
  subset, since dropping a calendar would produce false free time.
  - Per calendar, it must be enabled and "may read availability".
  - Provider calendars also need their account included and a `providerCalendarId`.
  - Live mode also needs a configured credential.
  - No booking permission is needed, and no account's "Read messages" switch: reading busy time
    is a separate, narrower permission than reading mail.
- **Computation:**
  - busy = the union of every source's intervals, each widened by `bufferMinutes`;
  - free = working-hours slots avoiding all of it, which is the intersection of each source's
    free time. It uses the agent's own `SyntheticCalendar`: IANA time zone and DST, working days,
    a 30-minute grid.
  - Ranking is `earliest`, or `spread` (the first free time of each day, then the earliest).
  - The time zone and working hours default to the owner's settings. The owner or operator may
    override them for one computation (dashboard, CLI, MCP); a request from a message or an
    extraction may not, since that could widen the owner's availability.
- **Fail closed:** any source that cannot be read completely blocks the whole answer, with
  per-source reasons. Such sources include:
  - missing setup;
  - revoked or insufficient scope;
  - HTTP errors;
  - Google per-calendar `errors`;
  - a Google answer for another window;
  - a non-IANA time zone, an impossible or DST-skipped time, or a range that does not move
    forward (including all-day events);
  - a Google calendar entry without a busy list;
  - a Graph paging link that does not continue exactly the same calendarView request (other
    calendar, other window, credentials, fragment, repeat), or more than 20 pages;
  - the shared 30-second budget for all provider reads being used up;
  - an unreadable agent calendar.

  An empty (`ok`) answer means "no free time", with a reason.
- **Freshness:** every result has `computedAt`, each source's `fetchedAt`, `observation`
  (`remote` for a provider read, `local` for the owner's own synthetic data) and covered window,
  and the scheduling clock used. A remote observation more than 60 s old when the answer is
  finalised blocks it (reads are sequential, so an early read can age while later ones run).
  `validUntil` is 5 minutes after the OLDEST remote read, not after finalisation. Nothing is
  cached: each action run fetches again. `meeting.check-slot` re-reads before confirming and
  reports when an earlier result had expired.
- **Privacy:** only intervals are kept. No titles, attendees, locations or bodies are requested
  or returned.
- **Booking** is not done by any action. A managed agent books only on its own synthetic
  calendar, through its runtime, and refuses while calendars it cannot read count for
  availability. Provider event creation is not implemented.

## Contacts, messages, queue

- **`contact.lookup`** reads, and never writes, a managed agent's records. Each file is
  validated before use; an unreadable or wrongly shaped one gives `blocked` with certainty
  `unavailable`, never an exception or a guess. It reads:
  - the trust store, loaded with its thumbprint checks. Pinned keys are **recorded** trust
    anchors: a message claiming the identity is accepted only if its signature verifies
    against them, and this lookup verifies no message;
  - A2A peers, presence only (endpoint details and tokens withheld). An endpoint without a
    pinned actor key is not an identity;
  - the mandate. Its signature is verified now against the pinned owner key, and its validity
    window is checked. An unverified, expired or not-yet-valid mandate lists nothing usable;
  - remembered associations, as a read-only snapshot with status, conflict and expiry
    evaluated but not written back;
  - `services.json`.

  An email address is never an identity. Only an owner-confirmed, current association produces
  a plan, and the plan names the operator's synthetic-only `awp-pilot book` step. No URL is
  fetched. The result says what was checked now and what was not (`verification`).
- **`message.prepare`** uses fixed templates with structured fields only; line breaks and
  control characters are refused.
  - The mail renderer produces a subject, text, and `In-Reply-To`/`References` and
    `X-AWP-Conversation` from validated values.
  - The chat renderer produces compact text and a thread reference.
  - The result states that nothing was sent and no provider draft was saved (no draft adapter
    exists).
  - Availability replies: the time zone must be IANA; each option must end after it starts
    (within 24 hours); options whose `validUntil` has passed are refused. The result's `basis`
    states that this action checked no calendar. It marks times given without `validUntil` as
    unverified supplied suggestions.
  - Chat text over 1000 characters (480 for phone messages) is refused, never truncated.
- **`inbox.normalise`** applies these rules in order:
  1. accounts not allowed, which are excluded — first, so an excluded item takes no part in
     de-duplication;
  2. identifiers are untrusted: the same account and id, or the same Message-ID, with identical
     content is a duplicate; with different content it is a **collision** — both items are
     kept and go to manual review;
  3. agent-protocol markers, which go to the runtime; its verification decides and the marker
     proves nothing;
  4. a typed `structured` meeting request, which suggests a `calendar.availability` input
     (supplied data, not authenticated; the suggestion carries no authority);
  5. an explicit deadline field;
  6. a known subscription (List-Id);
  7. otherwise, manual review or triage.

  Free text is not interpreted, and no keyword "understanding" is claimed.

## Capability matrix (what exists in this code)

| Family | Implemented | Configuration-dependent | Future | Not provided |
|---|---|---|---|---|
| Google | reply preparation (mail), queue from supplied items | calendar availability (freeBusy) | mail read, provider draft save | send |
| Microsoft 365 / Outlook | reply preparation (mail), queue from supplied items | calendar availability (calendarView) | mail read, provider draft save | send |
| Teams, Slack, Matrix, Signal, SMS | reply preparation (chat), queue from supplied items | — | reading | send |
| GitHub | queue from supplied items | — | notifications read, reply renderer | send |

Per account, the matrix and the Actions page give the provider credential state:

- `configured`: a real credential is configured (live mode);
- `fixture-simulation`: synthetic answers stand in, and no credential exists;
- `none`.

Only Google and Microsoft have a provider adapter at all, so Teams, Slack and the others are
always `none`.

## The supported request → reply path (no model)

This is the path that exists now, from a structured request to a reply:

1. A **structured request** arrives as a supplied item: a typed `structured` meeting request on
   an allowed account. `inbox.normalise` suggests `calendar.availability` with its window and
   duration. The suggestion is data, not authority.
2. **`meeting.prepare-proposal`** (or `calendar.availability`) reads every authoritative
   calendar afresh, under the owner's permissions and the freshness rules above. It returns
   options, templates and a structured option list.
3. **`message.prepare`** renders the reply for the account the request came in on. It keeps
   `In-Reply-To`/`References`, and states that it checked no calendar itself.
4. **Transmission is separate.** It needs the owner's review of the exact text and a separate,
   explicit, authorised instruction outside this catalogue. No action sends. `message.prepare`
   has no execute step. A chosen time is re-checked with `meeting.check-slot`, which books
   nothing.

`scripts/actions-integration.mjs` (check A.12) runs this path, identically, over the dashboard
API, the operator CLI (separate processes) and MCP, with the fixture calendars. The owner's
setup goes through the owner's surfaces: a synthetic policy import, and the account switches set
through the dashboard API.

**Runtime dispatch is not connected.** A managed agent's peer runtime does not dispatch
incoming agent-protocol requests to this catalogue. Its scheduling decisions stay with its own
policy module (SPARQ) over its own synthetic calendar. `agent.propose-meeting` still uses that
runtime calendar, which blocks while provider calendars count for availability. Provider
availability computed here is **not** applied to the runtime's booking flow: that would feed an
externally computed snapshot into a flow whose authority checks never saw it.

No dispatcher hook was added. A hook that preserved all of the runtime's checks would need the
runtime itself to perform fresh provider reads inside its policy decision. That is future work,
not a wrapper.

Concretely, these are not connected today:

1. The peer runtime's inbound handler for agent-protocol scheduling messages never calls the
   registry. It answers from its own synthetic calendar and SPARQ decision.
2. Nothing runs an `inbox.normalise` suggestion automatically. The owner or operator runs the
   suggested action (dashboard, CLI or MCP) with the suggested input.
3. The runtime calendar cannot read Google or Microsoft calendars. While they count for
   availability, runtime availability and runtime booking stay *blocked*.
4. No prepared reply is transmitted by any component. Transmission needs a separate,
   explicitly authorised path that does not exist in this catalogue.

## Limitations

- **Provider mode:** no live provider call was made in development. The live adapters are
  exercised only against fake `fetch` and the fixtures.
- **Setup:** live use needs the credential helper (`awp-credentials`, see `PROVIDER-SETUP.md`)
  and the configuration described in `PROVIDER-ACTIONS.md`. The helper has been tested only
  against a local fake provider; no real consent or provider call has been made.
- **Grid:** free times sit on a 30-minute grid; there is one buffer for both sides; working
  hours are a single daily range.
- **Microsoft:** calendars whose events use Windows time-zone names (not IANA) block.
  `workingElsewhere` counts as busy (conservative).
- **Limits:** Google at most 50 calendars per account; windows at most 31 days.
- **Runtime proposal:** `agent.propose-meeting` needs the agent to be stopped (its runtime owns
  the state; use its MCP tool when it runs). Later steps of the exchange go through the agent's
  usual operator path.
- **Messages:** no mail, chat or notification reading, no provider drafts, and no sending exist
  in this version.
- **Runtime:** the peer runtime does not dispatch to this catalogue (see above).
- **Contacts:** pinned keys and owner-confirmed endpoints are records. The lookup verifies the
  owner mandate's signature, but no message or endpoint of the contact.

## Conformance statement

These statements are backed by tests (`src/actions/*.test.ts`), the real-process workflow
(`npm run actions:integration`) and the credential helper checks (`src/credentials/`,
`npm run credentials:integration`):

- **Authority:**
  - authority comes only from the owner's settings;
  - calendar reads need "may read availability", not "Read messages";
  - message and extraction origins cannot override hours or time zone;
  - execution is operator-only, single use and atomic across processes, bound to the action
    version and digest.
- **Availability** is never computed from partial, stale or malformed provider data. The three
  independently reproduced provider counterexamples are each blocked:
  - a Google entry without `busy`;
  - a Graph `nextLink` to another calendar;
  - a backwards all-day range.
- **Errors** from providers and helpers are bounded, typed outcomes. No token, response body or
  secret appears in an error, a result, the dashboard API or the UI.
- **Records** are reported as recorded or verified, as they are. Corrupt records give an
  `unavailable` state, not an exception.
- **Not claimed:**
  - any live provider call;
  - runtime dispatch to this catalogue;
  - sending, booking or provider drafts.
