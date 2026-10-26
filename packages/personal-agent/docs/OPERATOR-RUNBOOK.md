# Operator runbook — pilot personal agents (synthetic use only)

This runbook covers running independent pilot agents locally, driving them from a shell or a
coding agent over **MCP**, exchanging their signed messages, and inspecting the evidence.
Nothing here sends mail, books anything or touches a credential. Clocks are fixed synthetic
instants and the meetings are synthetic calendar holds.

The **live Gmail account integration is not done**: the exact account pair is still unanswered
(§8). Native local bindings are implemented: loopback A2A (§7b) and a loopback anonymous public
carriage (profile §22). Real-network A2A, TLS, discovery and any hosted service are not. MCP here
is a **local stdio** interface only. The product is not complete; see §9.

A **prepared, persistent synthetic Alice/Bob pair** already exists in `.awp-runtime/`. Its MCP
configuration is [`docs/mcp/coding-agent.mcp.json`](mcp/coding-agent.mcp.json); see §4a and
`LOCAL-HANDOFF.md`.

Every command in §1–§6 is exactly what `scripts/operator-smoke.sh` runs in a fresh temporary
directory. Run it under both shells:

```sh
AWP_SPARQ_POLICY_BIN=/abs/path/to/sparq-policy-decide sh  scripts/operator-smoke.sh
AWP_SPARQ_POLICY_BIN=/abs/path/to/sparq-policy-decide zsh scripts/operator-smoke.sh
```

## 0. Rules that keep state consistent

1. **One runtime owner per agent directory.** `mcp` and `serve` hold the agent's state lock for
   as long as they run. While one runs, every other command that opens or reconfigures that
   agent refuses with `state is locked`. This includes `status`, `propose-meeting`, `pin`,
   `configure-service` and `policy-engine` re-pinning. It never waits, and it never changes the
   running process underneath it.
2. **Operate through the running service.** While an MCP server runs, use its tools for
   everything (propose, inspect, deliver). Configure trust and services only while nothing runs;
   the changes apply from the next start.
3. **Stop gracefully.**
   - For MCP: close the client, which closes the server's stdin.
   - For `serve`: send SIGINT/SIGTERM.
   - In-flight work finishes, state is saved and the lock is released. A crash (SIGKILL)
     leaves a lock that the next start recovers only if its process is provably dead.
4. **Keep three things separate:**
   - **operator commands**: CLI/MCP tools (local authority);
   - **peer messages**: signed envelopes, verified by the receiving runtime; connecting to a
     server authenticates nobody;
   - **provider sends**: none in this pilot.

## 1. Prerequisites

- Node ≥ 22.19.0, then `npm install --ignore-scripts && npm run build`.
- The SPARQ policy binary, built in the sparq-policy worktree with
  `cargo build -p sparq-policy --features json-cli --bin sparq-policy-decide`.
  - Export its **absolute** path as `AWP_SPARQ_POLICY_BIN`.
  - Use explicit paths only; never rely on an ambient `sparq` command.
- Portable helpers. These are shell *functions*, so they work in sh, dash, bash and zsh (a
  variable holding a command line does not):

```sh
HERE=/abs/path/to/personal-agent
AWP_DIR="$HERE/.awp-runtime"          # agent directories (git-ignored)
AWP_NOW="2026-10-19T08:00:00Z"        # fixed synthetic clock
awp() { node "$HERE/dist/pilot/cli.js" "$@" --dir "$AWP_DIR" --now "$AWP_NOW"; }
mcp() { node "$HERE/scripts/mcp-client.mjs" --dir "$AWP_DIR" --now "$AWP_NOW" "$@"; }
OWNERS=/abs/path/to/owner-keys          # SEPARATE owner directory (outside $AWP_DIR/<name>)
```

## 1a. Owner custody (what separate storage does and does not give you)

- `init --owner-dir "$OWNERS"` writes the owner's private key ONLY to
  `$OWNERS/<name>/owner.private.jwk.json` (dir 0700, file 0600); the agent's service directory
  (`$AWP_DIR/<name>/`) holds the actor key, public and signed material, and no owner key. An
  existing owner key is never overwritten; an owner directory inside the service directory is
  refused.
- The running service (`mcp`, A2A, `serve`, `status`, `card`, receipt of messages) never reads
  owner private material. Owner signing is explicit and separate: `sign-approval`, `approve`
  and `confirm-association` read the owner key from `--owner-dir` (and check it is the agent's
  published party key). The owner location is never discovered or recorded — pass it each time.
- Compatibility: directories created before phase 7, or `init` without `--owner-dir`, keep the
  owner key at `keys/owner.private.jwk.json` (colocated); owner-signing commands without
  `--owner-dir` use it. There is no automatic migration; to separate an existing synthetic agent,
  re-initialise it with `--owner-dir` (re-pin its card at peers).
- Limits: the owner directory belongs to the same OS user on the same host. This is a filesystem
  boundary for the pilot, not hardware custody, OS-level isolation or the owner's own device.

## 2. Initialise two independent agents (nothing running yet)

```sh
awp init --name alice --party 'https://alice.example/#me' \
  --actor 'https://agents.alice.example/personal#agent' --timezone Europe/London \
  --known-party 'https://bob.example/#me' --sparq-bin="$AWP_SPARQ_POLICY_BIN" \
  --owner-dir "$OWNERS" > alice.json
awp init --name bob --party 'https://bob.example/#me' \
  --actor 'https://agents.hostco.example/bob#agent' --operator 'https://hostco.example/#org' \
  --timezone America/New_York --known-party 'https://alice.example/#me' \
  --sparq-bin="$AWP_SPARQ_POLICY_BIN" --owner-dir "$OWNERS" > bob.json
```

- `init` probes the binary and records `policy-engine.json` (path, SHA-256, evaluator).
- Without a binary, `init` fails and writes nothing; `--policy-engine=solid-odrl` is the
  explicit alternative.

## 3. Exchange cards and pin (nothing running yet)

```sh
awp card --name alice > alice.card.json
awp card --name bob   > bob.card.json
awp pin --name alice --card bob.card.json   --party-kid=<bob partyKid>   --actor-kid=<bob actorKid>
awp pin --name bob   --card alice.card.json --party-kid=<alice partyKid> --actor-kid=<alice actorKid>
```

- **Compare the thumbprints out of band** before pinning. The smoke script copies them from
  `alice.json`/`bob.json`; that is acceptable only because both agents are synthetic and local.
- Use the `--flag=value` form: a thumbprint can start with `-`.

## 4. Attach a coding agent over MCP

The server is `node $HERE/dist/pilot/cli.js mcp --name alice --dir $AWP_DIR` on stdio.

- stdout carries only MCP messages; diagnostics go to stderr.
- There is no network listener. The trust boundary is the local OS user who can start it.

A configuration for the PREPARED pair (§4a), for a project `.mcp.json` or equivalent, is
[`docs/mcp/coding-agent.mcp.json`](mcp/coding-agent.mcp.json):

- It has two entries, `awp-alice` and `awp-bob`, each running
  `mcp --name <n> --a2a --auto-dispatch --dir <abs>/.awp-runtime --now 2026-10-19T08:00:00Z`.
- It uses absolute paths: replace the placeholder `/path/to/personal-agent` with this checkout's
  absolute path. It contains no tokens and no environment.
- It is not installed anywhere. To use it with Claude Code, add it to your own project
  configuration, or run the equivalent commands:

```sh
claude mcp add awp-alice -- node "$HERE/dist/pilot/cli.js" mcp --name alice --a2a --auto-dispatch --dir "$AWP_DIR" --now "$AWP_NOW"
claude mcp add awp-bob   -- node "$HERE/dist/pilot/cli.js" mcp --name bob   --a2a --auto-dispatch --dir "$AWP_DIR" --now "$AWP_NOW"
```

`node scripts/check-mcp-config.mjs docs/mcp/coding-agent.mcp.json awp-alice` (and `awp-bob`)
launches exactly the configured command with the official SDK client, lists the tools and stops
it again. The smoke script does the same for its own temporary directory.

**The fixed clock.** `--now 2026-10-19T08:00:00Z` is a DEMONSTRATION clock: every run of the
prepared pair sees that instant. It keeps the demonstration reproducible: the synthetic
mandates are valid then, and the meeting window is the next day. It is **not suitable for a live
deployment**, where agents must use the real clock (omit `--now`), signed messages expire in
real time, and mandates must be re-issued before they lapse.

## 4a. The prepared synthetic Alice/Bob pair (phase 10)

The pair lives in `personal-agent/`. Every item is git-ignored:

| Item | Location |
|---|---|
| Agent directories: identity, actor key (0600), trust, mandate, state, ledger, A2A listener config and access token, pinned A2A peer | `.awp-runtime/alice/`, `.awp-runtime/bob/` |
| Owner private keys, OUTSIDE the agent directories (dirs 0700, files 0600) | `.awp-owners/alice/`, `.awp-owners/bob/` |
| Public introduction cards used for pinning (connection cards with tokens were deleted after `a2a-pin`) | `.awp-runtime/_exchange/` |

Identities use reserved example domains only:

- `https://alice.example/#me` / `https://agents.alice.example/personal#agent` (Europe/London);
- `https://bob.example/#me` / `https://agents.hostco.example/bob#agent`, operator
  `https://hostco.example/#org` (America/New_York).

The pair was provisioned with the pinned SPARQ binary
(`../sparq-policy/target/debug/sparq-policy-decide`, SHA-256 recorded in
`policy-engine.json`), the fixed clock and the commands of §2, §3 and §7b. The listeners use
loopback ports 47101 (alice) and 47102 (bob), which were checked free when configured.

**Services run only while attached.** Each listener exists only while that agent's MCP server
runs; nothing runs in the background. To exchange messages over A2A, attach BOTH entries; a
message to a peer that is not running is kept and sent at the next dispatch.

What was run and verified in phase 10 (`../reports/PHASE10-RESULT.md`):

- Two conversations, Alice → Bob, window 2026-10-20 13:00–17:00Z. The second was run by the
  corrected driver (`../reports/PHASE10-FINAL-CHECK-RESULT.md`). In each:
  - every hop went over `a2a-data-part/0.2`;
  - the agreement is the same on both sides.
  
  Each side now holds two synthetic holds: 13:00–13:30Z and 13:30–14:00Z.
- Restart and inspection show the same state.
- Graceful shutdown left no processes, listeners or locks.

To inspect without attaching a client (nothing may be running):

```sh
node scripts/mcp-client.mjs --dir .awp-runtime --now 2026-10-19T08:00:00Z call alice get_status
node dist/pilot/cli.js verify-ledger --name bob --dir .awp-runtime --now 2026-10-19T08:00:00Z
```

**Tools.**

| Tool | Kind | What it does |
|---|---|---|
| `get_profile` | operator, read-only | identity, role, implementation description (configurations, bindings incl. `mcp-tool/0.1`, selected policy module), pinned peers, role operations, local interfaces |
| `get_status` | operator, read-only | current policy-module availability, mandate, conversations, pending approvals, effects, synthetic holds (personal), transmissions, role status |
| `get_evidence` | operator, read-only | ledger hash-chain verification and recent records (e.g. `authorisation-decision`) |
| `propose_meeting` | operator (personal role) | start a synthetic scheduling negotiation with a **pinned** peer, within the owner mandate |
| role operations | operator (mortgage roles) | see §7a |
| `submit_approval` | operator | hand the runtime an approval **signed with the owner key** outside the server (`awp sign-approval`); verified against the exact pending action |
| `list_outbound` / `ack_outbound` | operator | reviewed signed envelopes awaiting hand-off (byte-bounded pages: `cursor`/`limit` → `nextCursor`); acknowledge after carrying them |
| `dispatch_outbound` | operator (`--a2a` only) | send undelivered envelopes to pinned A2A peers (§7b) |
| `deliver_inbound` | **MCP binding** | hand the agent ONE peer message (envelope, or the email MIME binding as Gmail JSON / RFC 5322); fully verified by the runtime |

**Resources:** `awp://agent/profile` and `awp://agent/status`.

**Not exposed:** shell or file access, private keys, pinning or trust edits, approval without an
owner signature, mandate changes, provider sending.

**While the server runs**, the coding agent *is* the operator interface: do not start `awp`
commands for that agent (they are refused). After the session ends (the client closes), the
lock is free again.

## 5. Schedule a synthetic meeting over MCP (from a shell)

```sh
mcp schedule alice bob --window-start 2026-10-20T13:00:00Z --window-end 2026-10-20T17:00:00Z > schedule.json
```

This spawns both MCP servers (two OS processes, each the owner of its agent) and has Alice
propose. It then shuttles the agents' own signed messages between them over MCP until both
are quiet (describe, description, propose, accept, two receipts), prints the trace and phases,
and closes both servers gracefully. The same session could be driven from a coding agent,
tool by tool.

To look inside a single agent: `mcp call alice get_status`, or
`mcp call bob get_evidence '{"type":"authorisation-decision","limit":5}'`.

## 6. Inspect after shutdown, restart, prove single-writer

```sh
awp status --name alice            # works: no server owns alice now
awp verify-ledger --name bob
mcp call bob get_status            # a restarted server sees the same completed conversation
```

Single-writer check (smoke step 3). The server runs with its stdin held open on a FIFO:

- `awp status --name alice` fails with `state is locked`;
- closing the FIFO (EOF on stdin) stops the server, which logs
  `stopped; state saved and lock released` and exits 0.

## 7. File-spool service (`serve`) — valid order

`serve` owns the agent while it runs, just like `mcp`. So:

1. do all setup first (§2–§3);
2. prepare any `propose-meeting` output **before** starting `serve`;
3. start `serve --spool DIR` per agent and move files between their `in/` and `out/`;
4. stop each service with SIGTERM and wait for it to exit;
5. only then run `awp status`.

`scripts/pilot-integration.mjs` runs exactly this order, including a crash after commit and a
restart.

## 7a. Durable SYNTHETIC mortgage actors (consumer, lender intake, underwriter)

Setup (nothing running yet). Issuer keys are generated, sign Sam's synthetic wallet, and only
their PUBLIC keys are written; the lender pins them locally at provisioning.

```sh
awp synthetic-issuers --out issuance            # issuance/issuers.public.json, issuance/wallet-sam.json
awp init --name sam       --role mortgage-consumer   --wallet  issuance/wallet-sam.json      --sparq-bin="$AWP_SPARQ_POLICY_BIN" --owner-dir "$OWNERS" > sam.json
awp init --name northbank --role mortgage-lender     --issuers issuance/issuers.public.json  --sparq-bin="$AWP_SPARQ_POLICY_BIN" --owner-dir "$OWNERS" > northbank.json
awp init --name uw        --role mortgage-underwriter                                        --sparq-bin="$AWP_SPARQ_POLICY_BIN" --owner-dir "$OWNERS" > uw.json
for n in sam northbank uw; do awp card --name "$n" > "$n.card.json"; done
awp pin --name sam       --card northbank.card.json --party-kid=<northbank partyKid> --actor-kid=<northbank actorKid>
awp pin --name northbank --card sam.card.json       --party-kid=<sam partyKid>       --actor-kid=<sam actorKid>
awp pin --name northbank --card uw.card.json        --party-kid=<uw partyKid>        --actor-kid=<uw actorKid>
awp pin --name uw        --card northbank.card.json --party-kid=<northbank partyKid> --actor-kid=<northbank actorKid>
```

Enterprise roles have fixed synthetic identities (omit `--party/--actor`). Then run each agent as
`awp mcp --name N --a2a [--a2a-auto-dispatch]` after §7b's A2A setup (or carry envelopes with
`list_outbound`/`deliver_inbound`/`ack_outbound`). The operator steps, in order:

| Agent | Tool | Arguments |
|---|---|---|
| sam | `start_prequalification` | `{"lenderActor":"https://northbank.example/agents/intake#agent","propertyPrice":450000,"loanAmount":380000}` |
| sam | `get_status` | read `pendingApprovals[0].actionDigest` and `.conversation` (the application) |
| (shell, owner side) | `awp sign-approval --name sam --owner-dir "$OWNERS" --action <digest> --conversation <application>` | owner key from the owner directory; no lock; prints `approval` (valid 1 h) |
| sam | `submit_approval` | `{"approval":"<JWS>"}` — then `dispatch_outbound` before the approval lapses (it is re-checked at send time) |
| northbank | `internal_access` | `{"agent":"…/assessment#agent","action":"read","purpose":"…CreditChecking","application":"<application>"}` — you, the local operator, select a SIMULATED internal role; not an authenticated enterprise identity |
| northbank | `start_underwriting` | `{"application":"<application>"}` (once) |
| northbank | `send_decision_receipt` | `{"application":"<application>"}` (once, after the underwriting result) |
| northbank | `purge_expired` | `{"limit":100}` — retention, after grants expire (§7c) |

The actor IRIs are in `src/pilot/fixtures/mortgage.ts` and in each `get_profile`. Everything is
synthetic: no real lender, credit process, record or payment.

**If a lender step was interrupted** (crash, restart, an error returned mid-step): call the same
operation again. It reconciles from the runtime: if the underwriting conversation / decision
receipt exists, it answers `recovered: true` and does not repeat it; if it provably does not, the
step runs. A workflow file from phase 6 with `underwritingRequestedAt`/`decisionRequestedAt` but
no intent is refused: inspect `get_status` (conversations with the underwriter, undelivered
outbound) and `get_evidence` (`message-out` records for the application) and decide manually.

## 7c. Retention of the lender's purpose store

`purge_expired` erases, at most 100 per call, the stored payloads whose data-use grant has
expired (90 days in the synthetic terms); run it again while `remainingExpired > 0`. It keeps
payload-free tombstones (so the same item is never stored again under the same grant) and logs
payload-free `data-erased` records (`get_evidence` is the runtime ledger; the store's own ledger
is `data-store-ledger.jsonl`). It erases **that store's copy only**: the runtime state and ledger
(message digests, application terms, item ids, outbox entries until compaction), the
consumer's wallet, the underwriter's copy of the attenuated fields, reports, filesystem remnants
and backups are not reached. It is not scheduled and is not secure erase.

## 7b. Optional local A2A binding (loopback only)

```sh
awp a2a-config --name alice --port 47101 --out alice.a2a.json    # connection card: URL + access token
awp a2a-config --name bob   --port 47102 --out bob.a2a.json
awp a2a-pin --name alice --connection bob.a2a.json               # only after bob's keys are pinned (§3)
awp a2a-pin --name bob   --connection alice.a2a.json
```

- Exchange connection cards out of band, like introduction cards. They hold a local API access
  token (not authority); keep them 0600 and delete them after pinning. `--rotate` issues a new
  token (peers must re-pin).
- Start `awp mcp --name alice --a2a` (operator dispatches with `dispatch_outbound`) or with
  `--a2a-auto-dispatch` (sent as soon as produced). Configuration changes (`a2a-config`,
  `a2a-pin`) are refused while the agent's server runs; they apply at the next start.
- The listener binds 127.0.0.1 (or `--host ::1`) only; the Agent Card is at
  `http://127.0.0.1:PORT/.well-known/agent-card.json`. Peers are never discovered.
- Every dispatch is re-decided at send time (mandate, revocations, approvals, policy module,
  message expiry): a refused message is not sent and stays listed. `dispatch_outbound` reports
  per message `sent`, `refused` (with the reason), `not-sent` (definitively not delivered, e.g.
  the peer was not listening — retried at the next dispatch) or `uncertain` (the peer may have
  processed it: lost reply, timeout, malformed acknowledgement). An uncertain message is retried
  ONLY as the identical signed message, re-authorised; the peer answers `duplicate` if it had
  processed it. It stays uncertain while the resend is refused (e.g. after revocation) — treat it
  as possibly delivered. `get_status` → `transmissions` shows each record with the envelope id,
  the A2A message id and the peer's acknowledgement id.

End-to-end: `npm run pilot:a2a-integration -- --sparq-bin="$AWP_SPARQ_POLICY_BIN"`
(personal pair over A2A with a mixed MCP hop and negative checks; the durable mortgage workflow
with process restarts).

## 7d. Durable SYNTHETIC regional actors (energy AU, health US, industrial EU)

The whole sequence below is scripted and checked:

```sh
node scripts/pilot-regional-integration.mjs --sparq-bin="$AWP_SPARQ_POLICY_BIN" [--only=E,H,I]
```

The script provisions separate actor and owner directories and starts only its own processes.
It drives the exchanges and restarts, writes `reports/pilot-regional-report.json`, then stops its
processes and deletes its temporary directory.

To do it by hand, follow the steps below. Nothing needs code edits.

**General rules:**

- `awp roles` lists every role, its fixed identity (if any), its `--role-input` keys, its issuing
  key and the owner statements it declares.
- A role input is `--role-input KEY=VALUE` (repeatable); unknown keys are refused.
- Agents of ONE organisation share its owner key: `--owner-dir "$OWNERS" --owner-name ORG`
  creates it once and reuses it. Every agent still has its own actor key, mandate and
  representation.
- Tools per role are exact: `get_profile` → `operations`, or the MCP `tools/list`.

**Energy (anonymous public carriage, §22 of the profile):**

```sh
awp synthetic-energy --out energy          # plans-<retailer>.json per retailer + household.json
for r in southern-current harbour-light gated-power oldschema-energy; do   # party/actor: src/pilot/fixtures/energy.ts
  awp init --name "$r" --role energy-retailer --party <party> --actor <actor> \
      --role-input plans=energy/plans-$r.json --sparq-bin="$AWP_SPARQ_POLICY_BIN" --owner-dir "$OWNERS" > "$r.json"
  awp public-config --name "$r" --port <free port> --out "$r.endpoint.json"
  awp card --name "$r" > "$r.card.json"
done
awp init --name wattlecompare --role energy-comparator --role-input profile=energy/household.json \
    --sparq-bin="$AWP_SPARQ_POLICY_BIN" --owner-dir "$OWNERS"
# the comparator pins each retailer's KEYS, then its public endpoint (one direction only):
awp pin --name wattlecompare --card "$r.card.json" --party-kid=<partyKid> --actor-kid=<actorKid>
awp public-pin --name wattlecompare --connection "$r.endpoint.json"
```

Then run the processes and use these tools:

- Run each retailer as `awp mcp --name <r> --public`.
- Run the comparator as `awp mcp --name wattlecompare --public --auto-dispatch`.
- Comparator tools:
  - `request_plans {}` (anonymous; nothing about the household is sent);
  - `compare_plans {}` (deterministic; persisted with provenance).

The household file stays in the comparator's directory only.

Received replies are retained in the comparator's `public-replies.json` until processed. If the
comparator process stops after a reply arrived, restarting `awp mcp --public` processes the
reply at start; the retailer is not asked again. A lost or malformed reply is retried only as
the identical public request (at most 5 attempts). A request recorded `sent` without a retained
reply (older directories) is not re-sent: call `request_plans` again for a new round.

**Health (A2A, §7b):**

```sh
awp synthetic-health --out health   # health/fhir-resources.json (Maya + Noah), health/patient-enrollments.json
# one patient agent per patient; the compartment id is a CLAIM (the clinic's register decides)
awp init --name carebrief      --role health-patient --party https://maya.example/#me \
    --actor https://carebrief.example/agents/brief#agent --role-input patient-id=synthetic-maya --owner-dir "$OWNERS" --sparq-bin=…
awp init --name carebrief-noah --role health-patient --party https://noah.example/#me \
    --actor https://carebrief.example/agents/brief-noah#agent --role-input patient-id=synthetic-noah --owner-dir "$OWNERS" --sparq-bin=…
# the CLINIC operator provisions its enrollment register (principal → compartment) here
awp init --name cv-auth   --role health-authorization --role-input enrollments=health/patient-enrollments.json \
    --owner-dir "$OWNERS" --owner-name cedarvalley --sparq-bin=…
awp issuer-card --name cv-auth > token-issuer.json                  # PUBLIC card of the token-issuer key
awp init --name cv-fhir --role health-resource --party https://cedarvalley.example/#org \
    --actor https://cedarvalley.example/agents/fhir#service \
    --role-input resources=health/fhir-resources.json --role-input issuers=token-issuer.json \
    --owner-dir "$OWNERS" --owner-name cedarvalley --sparq-bin=…
# cards + pins both ways, a2a-config/a2a-pin both ways (carebrief ↔ each service)
```

| Who | Step |
|---|---|
| patient (shell, owner side) | `awp owner-sign --name carebrief --owner-dir "$OWNERS" --kind patient-authorisation --args '{"audience":"https://cedarvalley.example/agents/authorization#service","approvedScopes":["launch/patient","patient/Patient.r","patient/MedicationRequest.rs"],"patientId":"synthetic-maya"}'` → `statement` |
| carebrief | `request_access {"authServerActor":"…/authorization#service","authorisation":"<statement>"}` — the negotiation ends at `agreed` (the agreement carries the grant) |
| carebrief | `read_resources {"resourceServerActor":"…/fhir#service","resourceType":"MedicationRequest"}` (one type per call; read-only) |
| carebrief | `summarise {}` — cited statements; contradictions stay `unresolved` |
| carebrief | `current_grant {}` → `grant` (the issuer-signed grant; read-only) |
| patient (shell) | `awp owner-sign --name carebrief --owner-dir "$OWNERS" --kind grant-revocation --args '{"grant":"<grant from current_grant>"}'` |
| cv-auth, cv-fhir | `accept_revocation {"revocation":"<statement>"}` on EACH enforcing server. It is persisted; there is no propagation protocol. Refused unless the carried grant is the pinned issuer's AND belongs to the signing patient. |

Refusals you should expect:

- A consent naming another compartment than the clinic enrolled for that patient is refused:
  `not-authorised`, recorded as `consent-decision` at cv-auth.
- So are a consent for another audience or purpose, and an expired or future consent.
- A grant never outlives the consent it came from.
- After a revocation, a searchset that cv-fhir had already queued is not sent.
  `dispatch_outbound` shows `refused` / `condition-failed`. `list_outbound` shows it as
  `blocked` with `withheld` and no envelope. Do not carry such an item by hand.

**Industrial (A2A):**

```sh
awp synthetic-industrial --out ind       # ind/programme-issuer.json (public), ind/nordwerk-membership.json
awp init --name alpine-planner   --role industrial-planner   --owner-dir "$OWNERS" --owner-name alpine   --sparq-bin=…
awp init --name alpine-authority --role industrial-authority --owner-dir "$OWNERS" --owner-name alpine   --sparq-bin=…
awp issuer-card --name alpine-authority > alpine-issuer.json
awp init --name orbis-telemetry --role industrial-provider --party https://orbis-robotics.example/#org \
    --actor https://orbis-robotics.example/agents/telemetry-provider#agent \
    --role-input issuers=ind/programme-issuer.json,alpine-issuer.json --role-input model=current \
    --owner-dir "$OWNERS" --owner-name orbis --sparq-bin=…
awp init --name nordwerk-contracting --role industrial-contracting --role-input membership=ind/nordwerk-membership.json \
    --owner-dir "$OWNERS" --owner-name nordwerk --sparq-bin=…
awp init --name nordwerk-diagnostic  --role industrial-diagnostic  --owner-dir "$OWNERS" --owner-name nordwerk --sparq-bin=…
# cards + A2A pins both ways: planner↔authority, planner↔diagnostic, contracting↔orbis, diagnostic↔orbis, diagnostic↔contracting
```

| Agent | Tool | Arguments / note |
|---|---|---|
| alpine-planner | `request_authorisation` | `{"authorityActor":"…/data-authority#agent","recipient":"https://nordwerk.example/#org"}` (another recipient is refused by the authority's mandate) |
| alpine-planner | `export_authorisation` | returns the signed authorisation; hand it to NordWerk's operator OUT OF BAND |
| nordwerk-contracting | `negotiate_offer` | `{"providerActor":"…/telemetry-provider#agent","authorisation":"<JWS>","purpose":"maintenance"}` |
| nordwerk-contracting | `request_transfer` | `{"conversation":"<the agreed conversation>"}` — only for an `agreed` conversation |
| nordwerk-diagnostic | `read_dataset` | `{"contractingActor":"…/contracting#agent","dataset":"<id from contracting get_status domain.dataStore>","purpose":"maintenance"}` — the store decides for the VERIFIED requester, and RE-decides a queued release before it is sent (`condition-failed` if it no longer holds) |
| nordwerk-diagnostic | `recommend` | `{"plannerActor":"…/planner#agent"}` — the planner accepts or refuses under its rule; acceptance creates ONE synthetic work order |
| alpine-planner | `record_performance` | `{"workOrder":"WO-1"}` — SIMULATED performance; idempotent |

Everything is synthetic. Not claimed:

- CDS/CDR conformance;
- SMART-on-FHIR/OAuth interoperability;
- HIPAA or clinical compliance or advice;
- Catena-X/DSP certification;
- Data Act eligibility.

## 8. Gmail, hosted deployment, key custody (setup-required, not done)

- **Gmail: not done.** **No live message has been sent, and no request has ever been made to
  gmail.googleapis.com from this pilot.** No account, credential or secret was searched for or
  used. There are two different next steps; do not confuse them.
  - **(a) Supervised connector exchange** (the next step). The user has authorised synthetic
    test messages between their EXISTING accounts. The accounts need not be empty: their
    existing mail is simply not read or touched by the test. The supervisor has already
    checked the connected Gmail account profiles, so no new OAuth client is needed for this
    step. What is still missing is **the user's answer naming the exact pair**. Then:
    1. The supervisor's connector supplies the authenticated transport to
       `GmailProviderAdapter`, with `allowedRecipients` and `sourceAccount` set to exactly that
       pair. Credentials never enter agent directories or this repository.
    2. Dry-run first and review the outbound files. Then send with `dryRun: false`, for
       synthetic test messages only.
    3. Uncertain sends are resolved only by a verified provider copy; otherwise an operator
       decides manually (risk of a duplicate).
    4. The user decides what to do with the test threads afterwards.
  - **(b) Unattended daemon use** (`serve` running without a supervising session) needs its own
    portable credentials, provisioned for that host and scoped to the pair. These are **not
    provisioned**; this belongs to standalone hosting (next bullet), not to the supervised test.
- **Hosted deployment:** not done. It would need one host per agent state, a persistent volume,
  operator-assigned identifiers, a reviewed retention schedule, registered backups, a
  jurisdiction decision, and the SPARQ binary installed at a fixed path and pinned. **MCP is not
  exposed over a network** in this pilot; a remote transport would need authentication and
  origin checks first.
- **Owner-key custody beyond a same-user directory:** not done. `--owner-dir` (§1a) keeps the
  owner key out of the service directory on the same host and user. Real custody would keep it
  off the agent host entirely (the owner's own device or a hardware key), sign mandates and
  approvals there, and deliver only the JWS to `submit_approval`.

## 9. Known gaps

- **Bindings:** direct local, email MIME/Gmail payloads, file spools, local MCP stdio,
  loopback-only A2A and the loopback-only anonymous public carriage (`public-http/0.1`). No A2A over real networks/TLS, no Matrix, Signal or other chat binding; no
  remote MCP transport; no network discovery.
- **Domains:** durable actors run for the mortgage slice and the regional energy, health and
  industrial workflows (§7d) — all synthetic, on one host. The mortgage valuation/fee branch is
  an in-process fixture only. There are no real retailers, clinics, FHIR or authorisation
  servers, or data-space connectors.
- **Providers:** no live provider round trip (Gmail setup-required; UC-02 uses a local synthetic
  reference service).
- **SPARQ:** a local debug build from an uncommitted worktree, one process per decision, pinned
  by path and hash. The pin detects replacement between decisions; it is not a defence against
  a compromised host.
- **Deployment and trust:** no hosted deployment, no multi-host coordination, no key rotation;
  owner keys separated only by directory (same OS user), and colocated in pre-phase-7 layouts.
- **Channel status:** direct, MCP, loopback A2A and the loopback public carriage are exercised
  locally. Gmail is not live: the account pair is unanswered and Gmail has never been contacted.
  No other channel exists.
- **Evidence scope:** no independent interoperation (every agent runs this code). There is no
  assessed compliance claim: no CDMC assessment, and no legal or regional conformance
  assessment. This states what was not assessed; it is not a conclusion that anything is
  non-compliant.
