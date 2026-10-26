# Owner dashboard

A local web dashboard for the personal agent's owner: which accounts exist and what is known
about them, which calendars count for availability, what the agent may do, and optional message
triage. It is a real settings application: changes are saved, versioned and consumed by the agent.

Everything here is local and synthetic. The dashboard cannot send a message, book a real
appointment, sign in to a provider, change a provider's permissions or grant the agent a new
signed permission.

## Start it (one command)

```sh
npm run build            # once, or after pulling changes
npm run dashboard:demo   # serves http://127.0.0.1:4318 (loopback only)
```

`dashboard:demo` is `serve --now 2026-10-19T08:00:00Z`. It sets the **scheduling** clock to the
fixed synthetic date the prepared demo was created with, so previews start on the demo week and
the demo agents' mandates are valid. Use `npm run dashboard` for an instance without the demo.

### Two clocks

- **The real clock** is always used for:
  - account-status freshness ("stale" means the record's own last observation is more than
    7 days old);
  - the change history;
  - record "last changed" times;
  - apply times.
- **The scheduling clock** (`--now`, synthetic) is used only for:
  - calendar previews (shown on the page as "Scheduling clock: … synthetic demo clock");
  - the demo agents' provisioning and mandates;
  - the demo busy periods.

Before the clocks were separated, `demo-setup --now` dated its history entry and demo records
with the demo date. `awp-dashboard label-demo-clock` is a one-off, recorded migration: it labels
every time that is later than the real time as "demo clock, not the real time", keeps the time
itself, and adds its own history entry. It was run on the prepared instance.

The terminal prints a **one-time sign-in link** (`http://127.0.0.1:4318/#code=…`). Open it in a
browser on this machine. The link:

- works once and expires after 10 minutes (press Enter in the terminal for a new one);
- carries the code in the URL fragment, which browsers never send to a server or in a Referer;
  the page removes it from the address bar and history before using it;
- should still be treated like a password until it is used: do not paste it into chats, tickets
  or reports. `npm run dashboard:demo -- --open` hands it straight to the default browser instead of
  printing it.

Options: `--port N`, `--state DIR` (default `.awp-dashboard`), `--agents-dir DIR` (default
`<state>/demo-agents`), `--now ISO` (synthetic scheduling clock only). Stop it with Ctrl-C.

## Private state

All dashboard state lives in `.awp-dashboard/` (ignored by git): the directory is 0700 and
`settings.json` is 0600. It holds account records, calendar choices, restrictions and the change
history. It never holds provider credentials, and the web server never reads agent signing keys.

## Import the account inventory (explicit, read-only)

```sh
node dist/dashboard/cli.js import-inventory --file ../context/dashboard-inventory.local.json
```

- Reads a **sanitised** snapshot (no credential references) and validates it; the file and the
  project it came from are not modified. Only counts are printed.
- Each account becomes an "inventory" record with every agent permission **off**.
- Registry status is kept as "what the inventory said", with its date. It never becomes a
  connection.
- **Historic evidence comes only from explicit, structured records** in the snapshot's optional
  `evidence` list. Each record gives channel, provider, exact identifier, method, source and
  observation date.
  - A record is attached only to accounts of the **same channel** that list **that exact
    identifier**. A shared address does not establish connector scope: a mailbox checked
    through Codex says nothing about a Teams account using the same address.
  - Attached evidence shows as "Previously checked through Codex". It is historic only, never
    current authentication, and this agent cannot use it.
  - If the account's recorded provider differs from the evidence's provider, an unresolved
    conflict is added.
  - A record matching no account is kept under "Historic observations matching no account".
- Free-text notes are shown as written and **never** become evidence. Notes about contradictory
  identities are shown as unresolved conflicts.
- Importing again updates the records and their evidence, dated by the real clock, and keeps your
  restrictions, notes and planned connector.
- The communication rules in the snapshot become the read-only workflow policy on the
  Permissions page.

## Synthetic demo (separate from the prepared Alice/Bob pair)

```sh
node dist/dashboard/cli.js demo-setup \
  --sparq-bin ../sparq-policy/target/debug/sparq-policy-decide --now 2026-10-19T08:00:00Z
```

This creates two **new** synthetic agents, `demo-owner` and `demo-peer`, in
`.awp-dashboard/demo-agents/`. Their owner keys go to `.awp-dashboard/demo-owner-keys/`, a
separate 0700 directory the web server never reads. It also adds three generic demo account
records and three calendars:

- the agent's own synthetic calendar, which receives holds;
- a "Demo team rota" with two busy periods, kept in the dashboard;
- a disabled provider calendar record ("setup required").

Each demo agent's synthetic calendar is initialised explicitly (empty; no holds) before it is
offered as available. The busy periods are placed relative to `--now`: with the demo clock they
fall on Tuesday 20 and Wednesday 21 October 2026. It then applies the availability to
`demo-owner`. It runs once, and never touches
`.awp-runtime/` or `.awp-owners/`. Use `--policy-engine solid-odrl` instead of `--sparq-bin` only
if SPARQ is unavailable.

To drive the demo agents over MCP, use the same commands as the pilot with
`--dir .awp-dashboard/demo-agents` (see `docs/OPERATOR-RUNBOOK.md`).

## Pages

- **Overview**: counts by status, calendar readiness, managed agents and the change history
  (who, when, what).
- **Connections**: filter by kind (email, chat, calendar, other), status and agent use, or search.
  Choose an account to see:
  - its identifiers, the source of its status, when it was last observed, and what this agent
    has for that kind of account;
  - historic evidence and conflicts;
  - setup steps.

  You can include or exclude the account and set read, triage and hosted-triage permission.
  "Draft" is recorded for later, because this version cannot draft. You can add, edit or remove
  records you created; imported records follow the inventory. Excluding an account is local and
  is not provider revocation: the page explains the difference.
- **Calendars**:
  - choose which calendars count for availability and which calendar receives synthetic holds;
    reading availability and receiving bookings are separate permissions;
  - set the time zone, working hours and working days;
  - add synthetic calendars with busy periods, or provider-calendar records (always
    "setup required");
  - *Preview* runs the agent's own scheduling code (`SyntheticCalendar` and `SchedulingHandler`)
    on the unsaved settings, showing the free times and what the agent would do with a peer's
    offer;
  - *Save* stores the settings, and *Apply* hands them to a managed agent.
- **Permissions**: fixed boundaries (every outgoing message needs your review; synthetic only;
  no provider changes; ask when uncertain).
  - A per-account table shows what the agent may do. For one account, a breakdown shows the
    three separate layers: provider evidence, your restrictions and the workflow policy.
  - Also shown: per-calendar permissions, the imported policy (read-only), and each managed
    agent's stored mandate. The mandate is displayed as recorded and is verified by the agent
    at run time, not by this page. Each agent's policy module, applied availability, holds and
    decision evidence are shown too.
- **Message triage**: how triage works, the hosted-triage switch with its data flow, the key
  setup steps, a synthetic sample form and the categories.
- **Actions**: the deterministic action catalogue, with per-calendar and per-account
  permissions and previews. It covers availability across the selected calendars (including
  Google and Microsoft when provider access is configured), meeting proposals, slot checks,
  contact lookup, reply preparation, an action queue and the capability matrix. Previews never
  execute anything. See [`ACTIONS.md`](ACTIONS.md) and
  [`PROVIDER-ACTIONS.md`](PROVIDER-ACTIONS.md).

## How the agent uses calendar settings (apply and reload)

1. *Save* stores the settings in `.awp-dashboard/settings.json` (a new revision).
2. *Apply* writes `availability.json` (0600, atomically) into the managed agent's directory. It
   runs under the settings lock, after the revision check, so a stale page can never install
   settings. It is recorded in the history.
3. The agent reads `availability.json` **once at start**, just after taking its single-writer
   lock. Its busy periods count in addition to the agent's own calendar, and its time zone and
   working hours replace the defaults.
4. The page shows whether the applied file matches the saved settings, and whether the running
   agent uses it. It infers the second from times: if the agent started after the file was
   written, the file is in use. If the agent started before, it still uses its old settings
   until it restarts.

The settings **fail closed**. The agent offers and accepts no time at all when:

- no calendar counts;
- a counting calendar is disabled, unreadable, unavailable, or a provider calendar (none can be
  read yet);
- an agent calendar that counts has no `calendar.json` (not initialised, or lost) or an
  unreadable one. A missing file is never read as an empty calendar;
- the chosen calendars have more than 2000 separate busy periods after merging overlapping or
  touching ones. Scheduling is blocked rather than dropping any period;
- no calendar may receive bookings;
- the file is malformed.

At run time, an agent with `availability.json` whose `calendar.json` is missing at start
refuses all time and does **not** recreate an empty calendar, so it stays blocked on later
starts. To recover, restore the file from a backup, or initialise a fresh one on purpose, then
apply again. Agents without `availability.json` keep the original behaviour: a default calendar
is created on first start.

Synthetic holds are written only to the agent's own synthetic calendar. They are never real
bookings. If the process stops between writing `availability.json` and the settings, the file
stays applied without its history entry; applying again is safe.

## Security model

Localhost is not authentication. The dashboard applies these protections:

- **Binding:** 127.0.0.1 only. Every request's `Host` must be `127.0.0.1:PORT` or
  `localhost:PORT`, which refuses DNS rebinding.
- **Cross-origin:** requests from another `Origin`, or with `Sec-Fetch-Site: cross-site`, are
  refused. Writes need an `Origin`. No CORS headers are ever sent.
- **Session:** the one-time code gives an in-memory session with an `HttpOnly; SameSite=Strict`
  cookie. After ten wrong codes, no code is accepted until a new one is printed.
- **Writes:** every write needs the session's CSRF token in `x-csrf-token`, a JSON body of at
  most 256 KiB, and the revision it was based on. A stale revision gets 409, never a merge.
- **Browser hardening:** the CSP allows only `self`, with no inline script or style and no eval;
  framing is denied; responses are `nosniff`, `no-referrer`, and `no-store` for the API.
- **Rendering:** every value is rendered as text (DOM nodes), never as HTML.
- **Requests:** request shapes are allowlisted and bounded; unknown fields are refused. The
  browser never chooses a file path, command or inference URL.
- **Files:** only four static files are served. Errors are short and contain no paths, stacks
  or secrets.

## Optional hosted triage (TypeSafe Jev)

Triage suggests a kind of message (needs_reply, action, waiting, read_later, fyi, noise) and,
separately, urgency (urgent / not_urgent). Every axis can be "uncertain", which means the agent
asks you. A suggestion never permits an action.

- Text carrying an agent-protocol marker is never classified. The marker proves nothing; the
  agent's protocol validation decides what such a message is.
- Local keyword rules always run. They are deliberately low-confidence, so they always ask.
- The hosted classifier runs only when **all** of these hold:
  - `TYPESAFE_API_KEY` is set in the environment of `npm run dashboard`;
  - hosted triage is turned on in the dashboard;
  - you confirm sending **this** sample;
  - for a sample linked to an account, that account allows read, triage and hosted triage,
    and the policy allows `classify`.
- A sample linked to no account is a synthetic sandbox. In this version, samples must be
  declared synthetic; no inbox is read.

### Enabling it

1. Create an account at the official console, <https://console.typesafe.ai>. Do not use
   look-alike gateways. Read the [data processing terms](https://typesafe.ai/legal/data-processing)
   first: TypeSafe says input is not used for training, but default retention for API input is
   not stated, and zero retention is an enterprise option.
2. Create an API key there and keep it in your own secret store. Never paste it into the page
   or a chat.
3. Start the dashboard with the key in its environment, without typing the key into the
   command (to keep it out of shell history):

   ```sh
   read -rs TYPESAFE_API_KEY && export TYPESAFE_API_KEY && npm run dashboard
   ```

   Optionally pin another version with `TYPESAFE_MODEL=jev-X.Y.Z`. Aliases such as `jev-latest`
   are refused; the default is `jev-1.13.0`.
4. Turn hosted triage on in *Message triage*, and try a synthetic sample with "Send this sample
   to TypeSafe" ticked.

### What is sent

Only the sample's sender, subject and body are sent, with the category descriptions, to the
fixed endpoint `https://api.typesafe.ai/v1/systemone`. Each request is bounded to 10 seconds and
a 64 KiB answer.

Every answer is validated. The dashboard requires:

- JSON content;
- the pinned model version;
- the exact answer set;
- complete distributions that sum to one;
- a chosen label with maximal probability.

Failures, rate limits, invalid answers, low confidence or a low chosen-label probability all
mean "ask the owner". The key is never shown, stored, logged or returned.

### Evaluation

```sh
npm run triage:eval
```

This evaluates the local baseline on 24 labelled synthetic messages and writes
`reports/triage-eval-report.json` (counts, confusion matrix, errors). The thresholds (0.8) are
**uncalibrated**. No quality or cost claim follows from the tests or this corpus.

A hosted run needs the key in the environment and the explicit flag
`--send-synthetic-corpus-to-typesafe`. A real evaluation needs a larger, owner-labelled,
held-out corpus (see `../reports/JEV-ASSESSMENT.md`).

## Verification

```sh
npm run dashboard:integration -- --sparq-bin=../sparq-policy/target/debug/sparq-policy-decide
```

This runs a bounded workflow in a temporary directory, removed afterwards; it stops itself after
three minutes. It performs:

1. demo setup;
2. `serve` on a free loopback port;
3. security checks over raw HTTP (Host, Origin, bootstrap, CSRF, CSP, body limit, static
   allowlist, key absence);
4. account-gated triage;
5. calendar preview, save, conflict and apply;
6. a real MCP negotiation between the demo agents: a busy day is refused, a free day is booked
   outside the chosen busy periods, and a blocked configuration refuses after restart.

It writes `reports/dashboard-integration-report.json`. The unit tests live in
`src/dashboard/*.test.ts` and `src/triage/*.test.ts`.

`src/dashboard/public-assets.test.ts` statically requires every DOM append to go through the
helper that drops `null`, `undefined` and `false`. The rendered pages were also checked in
headless Chrome: `../reports/dashboard-dom-check.mjs`, an author-side script outside this
repository that uses a local Playwright. It covers all five screens at 1440px and 390px:

- no placeholder text;
- no document-level horizontal overflow;
- no page errors;
- evidence scoping and clock semantics.

## Limitations and remaining live setup

- **No provider connection exists for this agent.** Being listed in the inventory, or having
  been reachable through Codex's own connector, gives this agent nothing: Codex's OAuth cannot
  be borrowed. No account can reach "Active connection" or "Local connector configured" in this
  version.
- **Mail and chat:**
  - Gmail can only be used in a supervised session, with credentials provided for that run.
  - Unattended use needs its own provisioned credentials.
  - Microsoft 365 needs an organisation-approved app registration and an adapter.
  - Chat and other channels need adapters for the providers' documented APIs.
- **Calendars:** there is no live calendar inventory and no provider calendar adapter. Provider
  calendars are records only, and choosing one for availability blocks scheduling.
- **Drafting is not implemented** ("Draft" is a recorded preference). Sending is never enabled
  from the dashboard.
- **Hosted triage is untested against the live service.** No account or key exists yet. Before
  any real message is sent, retention, subprocessor and residency terms need written answers.
  Compared with `../reports/JEV-ASSESSMENT.md`, these are not implemented:
  - retries and backoff for 429/529: each sample gets one attempt, and on failure the owner is
    asked;
  - learned per-class thresholds and a top-two margin rule;
  - the alternative "atomic yes/no questions plus deterministic mapping" formulation;
  - a versioned rubric identifier in results.

  Urgency is a separate question rather than an "urgent" lane, as the owner asked.
- **Browser coverage:** separate supervisor browser automation passed 13 checks on the final
  build, including saved controls, scheduling effects, uncertainty handling and all five
  screens at a 390px viewport. Desktop and mobile screenshots were inspected, and the prepared
  instance was opened in the in-app browser. These scripts live in the adjacent reports folder,
  not the package test suite. A full keyboard/screen-reader audit remains outstanding.
