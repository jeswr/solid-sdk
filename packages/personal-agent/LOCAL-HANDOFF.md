# Local handoff — Agentic Web pilot (synthetic, local only)

**What this is.** A local, synthetic pilot of the Agentic Web profile.

- Every agent runs this code on one host, loopback only.
- Nothing is deployed on the user's accounts.
- **No live message has been sent**, and Gmail has never been called by this pilot.
- There is **no assessed compliance claim**: no CDMC, SMART/OAuth, HIPAA, CDS/CDR, Catena-X/DSP,
  legal or regulatory assessment was carried out. This says what was not assessed; it is not a
  conclusion either way.
- Status and evidence: `../reports/PHASE10-RESULT.md` (latest), then PHASE9, PHASE8 and earlier.

## Source checkouts

| Path (from this directory) | What | State |
|---|---|---|
| `.` (`personal-agent/`) | Isolated checkout of `jeswr/personal-agent`, branch `agentic-web-personal-pilot`. The pilot is `src/pilot/`, built to `dist/pilot/`, CLI `dist/pilot/cli.js` (`awp-pilot`). | **Uncommitted**; nothing pushed or merged. |
| `../sparq-policy/` | SPARQ policy engine worktree. Pinned binary: `target/debug/sparq-policy-decide`; RDF engine: `target/debug/sparq-cli`. | Uncommitted Rust changes (`docs/PILOT-PROFILE.md` §15). No signed release. |
| `../context/`, `../reports/` | Specification inputs; phase results, supervisor reviews, reproductions, traces. | Evidence. |

Prerequisites (as tested): macOS, Node ≥ 22.19 (tested with 25.1.0), `npm install` and
`npm run build` done here. The policy binary is always passed by explicit path, never through
an ambient `sparq`.

## The prepared synthetic Alice/Bob demonstration

The pair is persistent and git-ignored. It was prepared and verified in phase 10.

| Item | Location (in `personal-agent/`) |
|---|---|
| Agent state: identity, actor key, trust, mandate, runtime state, ledger, synthetic calendar, A2A listener config with its access token, pinned A2A peer | `.awp-runtime/alice/`, `.awp-runtime/bob/` |
| Owner private keys, outside the agent directories (0700/0600) | `.awp-owners/alice/`, `.awp-owners/bob/` |
| Public introduction cards used for pinning | `.awp-runtime/_exchange/` |
| MCP configuration for BOTH agents (no tokens) | `docs/mcp/coding-agent.mcp.json` (`awp-alice`, `awp-bob`) |

The setup uses:

- **Identities** on reserved example domains only:
  - Alice: `https://alice.example/#me`, agent `https://agents.alice.example/personal#agent`;
  - Bob: `https://bob.example/#me`, agent `https://agents.hostco.example/bob#agent`.

  No personal identifier or account is bound.
- **Policy module:** SPARQ via `../sparq-policy/target/debug/sparq-policy-decide`, pinned by
  SHA-256 at init.
- **Carriage:** loopback A2A with auto-dispatch. Alice listens on `127.0.0.1:47101`, Bob on
  `127.0.0.1:47102`. The ports were checked free when configured. The access tokens exist only in
  the ignored `a2a.json` / `a2a-peers.json` files.
- **Clock:** `--now 2026-10-19T08:00:00Z`, a fixed synthetic **demonstration** clock, used
  consistently for init, MCP and inspection. Every run sees that instant.
  - It keeps the demonstration reproducible: the synthetic mandates are valid then, and the
    meeting window is the next day.
  - It is **not suitable for a live deployment**. There, agents run on the real clock (omit
    `--now`), messages expire in real time, and mandates must be re-issued before they lapse.

### Attach (a coding agent)

1. Add both entries of `docs/mcp/coding-agent.mcp.json` to your own MCP client configuration.
   The file is not installed anywhere. For Claude Code, the equivalent `claude mcp add` commands
   are in runbook §4.
2. **Services run only while attached.** Each MCP server holds that agent's state lock and runs
   its loopback A2A listener only while the client is connected. Nothing runs in the background.
   To exchange messages, attach BOTH. A message to a peer that is not running is kept and sent at
   the next dispatch.
3. Tools per agent: `get_profile`, `get_status`, `get_evidence`, `propose_meeting`,
   `submit_approval`, `list_outbound`, `ack_outbound`, `dispatch_outbound`, `deliver_inbound`.

   Example: call `propose_meeting` on `awp-alice` with
   `{"peerActor":"https://agents.hostco.example/bob#agent","windowStart":"2026-10-21T13:00:00Z","windowEnd":"2026-10-21T17:00:00Z"}`.
   Auto-dispatch carries the rest over A2A.
4. Detach by closing the client. The server stops gracefully and releases the lock.

### Run and inspect from a shell (nothing else may be attached to that agent)

```sh
node scripts/check-mcp-config.mjs docs/mcp/coding-agent.mcp.json awp-alice     # also awp-bob
node ../reports/phase10-demo-drive.mjs docs/mcp/coding-agent.mcp.json           # one more Alice→Bob meeting over A2A, then clean stop
node scripts/mcp-client.mjs --dir .awp-runtime --now 2026-10-19T08:00:00Z call alice get_status
node dist/pilot/cli.js verify-ledger --name bob --dir .awp-runtime --now 2026-10-19T08:00:00Z
```

**The driver** (`../reports/phase10-demo-drive.mjs`):

- It prints one JSON document with a `checks` list and `ok`.
- It exits **0 only if every check passes** for the ONE conversation it starts:
  - both sides completed within a bounded 30-second wait;
  - the same agreement on both sides;
  - one hold each, inside the requested window;
  - every hop received over A2A;
  - every outbound message of that conversation `sent` over A2A;
  - SPARQ `permit` decisions;
  - both ledgers verify;
  - a clean shutdown.
- Otherwise it exits **1**. In every case it closes every server it started, including one that
  started only partly, so no agent stays running or locked.
- Each run proposes a NEW meeting and books another synthetic hold on the same fixed day. A
  later run gets a later slot, or fails the hold check once the 13:00–17:00Z window is full.

### Current prepared state and what was verified

The prepared pair now holds **two completed conversations and two synthetic holds per agent**:

| # | Run | Holds | Evidence |
|---|---|---|---|
| 1 | Original phase-10 run | 13:00–13:30Z | `../reports/phase10-demo-trace.json` (historical, kept unchanged) |
| 2 | The corrected driver, once, exit 0, 10/10 checks | 13:30–14:00Z | `../reports/phase10-demo-run2-result.json` and `.stderr.log` |

Both conversations are `completed`, each with one agreement shared by both sides. Every hop went
over `a2a-data-part/0.2`:

- Bob received describe, propose and receipt.
- Alice received description, accept and receipt.

Every owner-mandate decision was `permit` by `sparq-policy@0.1.0`.

- **Both configuration entries launch** from the prepared state and list the tools above, with
  SPARQ `ready` and the `a2a-data-part/0.2` binding advertised.
- **After restart**, independent inspection shows the same state:
  - both conversations, both agreements and both holds on each agent;
  - 0 undelivered messages, and 6 `sent` transmissions each;
  - ledgers verify (alice 78 entries, bob 74).
- **Graceful shutdown**: no agent process, no listener on 47101/47102, no lock file.
- **Failure case** (temporary config, second server unavailable): the driver exited nonzero,
  and the first server closed and released its lock (`../reports/phase10-failtest-*`).

## Owner dashboard (local settings UI)

`npm run dashboard:demo` serves http://127.0.0.1:4318 (loopback only) and prints a one-time
sign-in link. Its scheduling previews use the synthetic demo clock `2026-10-19T08:00:00Z` (the
clock the prepared demo agents were created with). Account-status freshness and history always
use the real clock. State lives in the ignored `.awp-dashboard/`. It contains:

- the imported account inventory (read-only import);
- a separate synthetic demo pair, `demo-owner`/`demo-peer`, created by `demo-setup`;
- calendar authority, restrictions and history.

It never touches `.awp-runtime/` or `.awp-owners/`. Setup, the security model, apply/reload
semantics, optional TypeSafe triage and limitations are in `docs/DASHBOARD.md`. Results are in
`../reports/DASHBOARD-RESULT.md`.

## Deterministic actions

An action catalogue with no model is described in `docs/ACTIONS.md`. It covers:

- availability over Google, Microsoft and synthetic calendars;
- meeting proposal and slot check;
- a runtime proposal (prepare, then operator execute);
- contact lookup, reply preparation, action queue and capability matrix.

Provider token and config contract: `docs/PROVIDER-ACTIONS.md`. A separate fixture demo state
is in `.awp-dashboard-actions-demo/`; run it with `npm run dashboard:actions-demo` on port 4319.
Results are in `../reports/ACTIONS-RESULT.md`.

The provider credential helper is `awp-credentials` (`src/credentials/`, `npm run credentials --`).
Its setup commands, the private store layout and the scopes are in `docs/PROVIDER-SETUP.md`. It
has been tested against a local fake provider only; no provider configuration is live.

## Other runnable examples (all run earlier; results in the phase reports)

These are run from this directory with
`SPARQ=../sparq-policy/target/debug/sparq-policy-decide`:

- `npm run gate`
- `sh scripts/operator-smoke.sh` / `zsh …`
- `node scripts/pilot-regional-integration.mjs --sparq-bin=$SPARQ` (31/31)
- `node scripts/pilot-a2a-integration.mjs --sparq-bin=$SPARQ` (19/19)
- `node scripts/pilot-mcp-integration.mjs --sparq-bin=$SPARQ` (13/13)
- `node scripts/pilot-integration.mjs --sparq-bin=$SPARQ` (20/20)
- `node dist/pilot/cli.js demo --policy-engine=sparq --sparq-bin=$SPARQ` (65/65)

These use temporary directories, not the prepared pair. Procedures are in
`docs/OPERATOR-RUNBOOK.md`, the profile and its limits in `docs/PILOT-PROFILE.md`, and coverage
in `docs/PILOT-MATRIX.md`.

## What is still needed for live account use (not done)

1. **Supervised Gmail connector exchange — the next step.**
   - It needs **the user's answer naming the exact account pair**. This is still unanswered.
   - The user has authorised synthetic test messages between their existing accounts. The
     accounts need not be empty: existing mail is not read or touched by the test.
   - The supervisor has already checked the connected account profiles, so no new OAuth client
     is required for this supervised step.
   - The connector supplies the authenticated transport to `GmailProviderAdapter`, restricted
     to that pair. Dry-run first, then send synthetic test messages. See runbook §8(a).
2. **Unattended / standalone daemon use** (`serve` without a supervising session) needs
   portable credentials provisioned for that host and scoped to the pair. These are **not
   provisioned**. Standalone hosting is also not done:
   - a host per agent state and a persistent volume;
   - the real clock instead of `--now`;
   - a retention schedule and registered backups;
   - a jurisdiction decision;
   - SPARQ at a fixed pinned path;
   - owner-key custody off the agent host;
   - A2A over real networks with TLS and discovery.

   See runbook §8(b) and the hosting bullets.

No secret, service account or provider setup is implied by anything in this workspace.

## Known limits

These are listed in `docs/PILOT-PROFILE.md` §17, §23 ("Known limits") and §24:

- no revocation propagation protocol;
- the clinic enrollment register is provisioned configuration;
- handler processing is recovered step by step, not atomically;
- the owner directory is the same OS user;
- there is no independent-implementation interoperability;
- all organisations, people and data are synthetic.
