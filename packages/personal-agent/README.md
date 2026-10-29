<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

> **Experimental — AI-agent-generated.** Canonical source: `solid-sdk/packages/personal-agent`; the standalone repository becomes a read-only mirror when publishing is enabled.

# @jeswr/personal-agent

**The maintainer's personal agent — the "works today" counterpart of
[The Accountable Web of Agents](https://github.com/jeswr/agentic-solid-vision).** It bridges real
channels (Gmail first) into an owner-private Solid pod as provenance-carrying RDF, reads the
machine-readable metadata senders already emit *deterministically* (no LLM on the hot path), and
acts on the maintainer's behalf under a **hard trust split** where no single context both reads
hostile input and holds act-credentials — and where *how much the agent may do autonomously* is an
**owner-signed ODRL mandate** the credential-holding executor enforces deny-by-default.

This is **M1**. The full design is
[`agentic-solid-vision/docs/NOW-PERSONAL-AGENT.md`](https://github.com/jeswr/agentic-solid-vision/blob/main/docs/NOW-PERSONAL-AGENT.md);
section references (§) below point into it. Roughly ninety percent of the machinery is the suite's
already-hardened packages; this package wires them and adds the thin Gmail adapter, the deterministic
Actor pass, the ODRL-enforcing outbox executor, and the autonomy-mandate model.

> **Status: under active development — experimental, AI-agent-generated, not a supported product.**
> M1 builds *to the credential seams* and stops there: every credential (a Gmail OAuth token, the
> pod's authed `fetch`, the per-channel send tokens, the signed mandate, the Anthropic API key) is an
> INJECTED seam. Nothing here reads a secret from disk/env, and there are **no secrets in this repo**.

## Architecture — Reader / pod / Actor / outbox (§2)

```
 Gmail ──(users.messages.get?format=raw)──▶ READER (capability-starved ingest, ZERO act-tools)
                                            parse → interpret (deterministic §5 first) → importInbound
                                                                    │  owner-private, ACL-first
                                                                    ▼
                                            ┌──────── POD (the only interface + the audit log) ───────┐
                                            │  inbox/ (raw + agentic graph + CanonicalMessage)         │
   maintainer (chat) ◀──▶ ACTOR ───────────┤  proposals/ (agentic:ActionProposal — the Actor writes)  │
   deterministic §5 pass + guarded LLM loop │  outbox/ (PROV send receipts — the executor writes)      │
   reads typed RDF, PROPOSES only,          │  mandate (signed ODRL AgentAuthorizationCredential)      │
   holds NO send tokens                     └──────────────────────────┬──────────────────────────────┘
                                                                        ▼
                                            OUTBOX EXECUTOR (deterministic, NO LLM)
                                            evaluates the SIGNED ODRL mandate deny-by-default;
                                            holds the send-scope tokens; sends only what is
                                            permitted (autonomous) or explicitly confirmed;
                                            audits every send with PROV → the mandate + the permit
```

**The load-bearing split (§2/§7):** the Reader reads attacker-controlled email but has *zero*
act-tools; the Actor can propose but reads only already-landed, shape-validated RDF and holds *no*
send tokens; the outbox executor holds the send tokens, runs *no* LLM, and is the single enforcement
point. Three independent fences, each sufficient alone for the catastrophic case.

## The autonomy mandate (the security boundary)

*How much the agent may do on its own* is an **ODRL policy** ([`@jeswr/solid-odrl`](https://github.com/jeswr/solid-odrl))
wrapped in a **signed `AgentAuthorizationCredential`** ([`@jeswr/solid-vc`](https://github.com/jeswr/solid-vc)):
the owner (assigner) authorizes the agent (assignee) to perform enumerated action classes under
constraints; everything else is prohibited or carries a duty of owner-confirmation.

- **The outbox executor is the enforcement point.** It loads + signature-verifies the mandate
  READ-ONLY and evaluates *every* outbound intent against it, **deny-by-default**:
  - `permit` (a matching permit, no outstanding duty) → the agent may send **autonomously**;
  - `confirm-required` (no matching permit, or a permit contingent on an unfulfilled confirmation
    duty) → send **only** on an explicit human confirm;
  - `prohibited` (an explicit ODRL prohibition) → **never** sent, even if confirmed.
- **Fail-closed:** if the mandate is absent, unsigned, tampered, bound to a substituted policy, or
  not issued by the owner, the executor **refuses ALL actions**.
- **The agent cannot rewrite its own mandate.** It holds no send tokens, and its only writable pod
  surface is the `proposals/` container — never the mandate (the OpenClaw failure mode the design
  rejects, §3.1).
- Every autonomous action's PROV receipt references the mandate + the specific permit that authorized
  it; a confirmed action records the owner's confirmation as the authorizing basis.

### The default mandate, and loosening it

The default is **read everything, act (almost) nothing** — the agent may `read`/classify everything,
but every outbound send is `confirm-required`. Loosening is one explicit, signed change:

```ts
import { defaultAutonomyPolicy, withAutonomousScheduling } from "@jeswr/personal-agent";

// Safe default: no autonomous send at all.
const policy = defaultAutonomyPolicy({ ownerWebId, agentWebId });

// Loosen ONE permission: let the agent send scheduling replies autonomously,
// constrained to purpose = SchedulingResponse AND spend <= 0.
const looser = withAutonomousScheduling(policy);
```

The owner issues this as a signed `AgentAuthorizationCredential` (via
`@jeswr/solid-vc`'s `issueAgentAuthorization`, binding the policy content) and stores it in the pod;
`createSolidVcMandateVerifier` loads + verifies it. Changing autonomy = the owner edits + re-signs
the mandate, not a config the agent can touch.

## Public API

```ts
import {
  // Reader (§4)
  GmailChannelAdapter, runReader,
  // Actor (§3, §5.1)
  runActorOnce, buildActorOptions, createGate, createClaudeActor, deriveProposals,
  // Mandate (§5/§7)
  defaultAutonomyPolicy, withAutonomousScheduling, evaluateAutonomy, createSolidVcMandateVerifier,
  // Outbox (§2/§5/§7)
  runOutboxOnce, RecordingSender, confirmProposal,
} from "@jeswr/personal-agent";
// or the namespaced entrypoints: `@jeswr/personal-agent/{reader,actor,outbox,pod}`
```

| Piece | Entry | Notes |
|---|---|---|
| **Reader** | `runReader({ adapter, writeFetch, inbox, ownerWebId, … })` | Pulls a `ChannelAdapter` into the owner-private inbox via the bridge's `importInbound` (ACL-first). `GmailChannelAdapter` is the M1 channel. |
| **Actor (deterministic)** | `runActorOnce({ readFetch, writeFetch, inbox, proposals, ownerWebId })` | Reads landed structured metadata, derives proposal INTENTS with zero LLM tokens. |
| **Actor (live loop)** | `createClaudeActor({ podRoot, proposalsContainer, readFetch, writeFetch })` | The §3.3 Claude Agent SDK `query()` loop; read-only pod MCP tools + a proposals-scoped write tool + the `createGate` fence. Needs the optional `@anthropic-ai/claude-agent-sdk` peer + a billed API key. |
| **Mandate** | `evaluateAutonomy(policy, proposal)` / `createSolidVcMandateVerifier(…)` | ODRL evaluation + the signed-mandate loader. |
| **Outbox executor** | `runOutboxOnce({ verifier, senders, proposals, outbox, ownerWebId, … })` | Deterministic, no-LLM; the enforcement point + the send. `senders` is the credential seam. |

`runOutboxOnce` counts transmission outcomes in `sent` and `failed`, and final receipt-write
failures separately in `receiptErrors`. Once a sender succeeds, the message stays counted as
sent even if its receipt cannot be finalized. The existing claim remains an at-most-once
marker, so a later pass skips the proposal rather than sending it again.

## What runs today vs. what needs credentials / deploy

The live Actor's injected authenticated fetch must use credentials that lack `acl:Control`
(and equivalent ACP control rights). The live Actor accepts only validated Turtle proposal
records at their proposal URLs. Its gate discovers ACL/ACP targets on the proposals
container and destination resource before each write and refuses access-control resources,
containers, non-RDF content, and failed discovery. Direct `createGate`/`buildActorOptions`
callers must inject `discoveryFetch` to enable writes.

**Runs today (all tested, hermetic — no credentials, no network):**
- The full Reader → Actor → outbox flow over doubled I/O (`src/e2e.test.ts`): an untrusted email with
  embedded schema.org metadata → owner-private pod → deterministic scheduling proposal → an
  ODRL-mandate-enforced send.
- The Gmail adapter (mock-API tested): `list` + `get?format=raw` → the bridge's hardened `parseEmail`,
  token as a header only, SSRF-guarded, redirect-refusing, hostile ids skipped, batch-capped.
- ODRL autonomy enforcement: permit / deny-by-default / prohibited / duty-confirm, the mandate-tamper
  fail-closed path, and an intent crafted to *look* permitted but that misses a constraint.
- The `canUseTool` gate, the graduated human-confirm gate, proposal serialize/parse round-trips, and
  the ACL-first + at-most-once invariants.

**Stubbed to a seam (M1 stops here — needs the maintainer's hands):**
- The Gmail OAuth token (`gmail.readonly`) — injected via the `token` seam; M1 does not do OAuth.
- The live Claude Agent SDK loop — the adapter is wired but running it needs the optional peer
  `@anthropic-ai/claude-agent-sdk` + a **billed Anthropic API key** (a Stage-0 requirement, §3.3).
- The per-channel senders (`gmail.send`, …) — injected via the `senders` seam; the M1 sender is the
  hermetic `RecordingSender`. A live SMTP/Gmail/Slack sender is a follow-up.
- The signed mandate — `createSolidVcMandateVerifier` needs the owner's public-key resolver
  (`resolveKey`); issuing the mandate needs the owner's signing key. Its live-key path needs an
  integration test.
- Outlook / Slack / Teams / Matrix channels — the `ChannelAdapter` seam is the plug-in point; M1
  ships Gmail only.
- The A2A endpoint on `jeswr.org/agent` and the §5.3 pattern shapes — Stage 3 (out of M1).

## Run it (locally, hermetic)

```sh
npm install            # ignore-scripts=true; @jeswr git deps ship committed dist
npm run gate           # lint + typecheck + test + build + check:dist
```

GitHub-installable with no build step (committed `dist/`):

```sh
npm install github:jeswr/personal-agent#<sha>
```

## What the maintainer must provide (`needs:user`)

1. **A Gmail OAuth app + a `gmail.readonly` access token** per account (the Reader's `token` seam).
2. **A billed Anthropic API key** for the live Actor loop (`@anthropic-ai/claude-agent-sdk`).
3. **Per-channel send-scope tokens** (`gmail.send`, a Slack app token, …) for the outbox `senders`.
4. **The signed autonomy mandate**: the owner's signing key to issue the
   `AgentAuthorizationCredential`, and the public-key resolver for the verifier's `resolveKey`.
5. **An always-on host** for the Actor + outbox (the deploy-box rules apply if it is `solid-test`).
6. **A `w3id.org/jeswr/agentic` redirect** for the one minted namespace (shared with the bridge).

## Agentic Web pilot profile 0.1 (`@jeswr/personal-agent/pilot`, experimental)

A second, self-contained runtime in `src/pilot/` instantiates one coherent configuration of
every layer of the Agentic Web specification family: a transport-neutral interaction model
and deterministic state machine; implementation descriptions that separate supported and
accepted configurations; JWS (Ed25519 / P-256) with pinned keys, party-signed representation
statements, an owner-signed ODRL-subset mandate evaluated through `@jeswr/solid-odrl`, and
owner approvals bound to exact actions; persistent replay/idempotency with reconciliation of
uncertain effects; direct and email (MIME / Gmail payload) bindings; and executable
scheduling, mortgage, public-energy, synthetic-FHIR and industrial workflows; a remembered
conventional scheduling link (UC-02) booked through a deterministic adapter against a local
**synthetic** reference service (not Calendly); bounded retention; an optional RDF
(PROV/ODRL/PROF/DPV) evidence export with competency queries; and resource-governance
metadata (no CDMC claim). Provider sends pass a transmission gate that re-authorises the
recorded action and keeps durable attempting/sent/uncertain records. An uncertain send is
resolved only by a verified provider copy (or a provider-declared final absence) — never
resent because a search came back empty; this is not an exactly-once guarantee. No LLM is
used. Synthetic test use only — nothing is sent, and no provider credential is handled.

Policy module: **SPARQ** (`sparq-policy` via its `sparq-policy-decide` binary) is the default.
`awp-pilot init` probes and pins the binary given by `--sparq-bin` or `AWP_SPARQ_POLICY_BIN`
(path + SHA-256) and fails without one. `--policy-engine=solid-odrl` selects the alternative
explicitly. A missing or changed binary makes every decision `indeterminate` — never a fallback.

```sh
npm run gate                     # includes the pilot tests
npm run pilot:demo               # → reports/pilot-demo-report.json (harness default module)
npm run pilot:demo:sparq         # same scenarios decided by SPARQ (AWP_SPARQ_POLICY_BIN)
npm run pilot:integration        # separate OS processes, SPARQ by default (AWP_SPARQ_POLICY_BIN)
npm run pilot:rdf -- --sparq-cli=PATH  # RDF export + competency SPARQL on SPARQ's CLI
npm run pilot:sparq-cases        # policy vectors vs the SPARQ binary
npm run pilot:mcp-integration    # MCP servers in separate processes, real SPARQ (AWP_SPARQ_POLICY_BIN)
npm run pilot:a2a-integration    # MCP operator + loopback A2A, durable mortgage roles, restarts (AWP_SPARQ_POLICY_BIN)
npm run pilot:regional-integration  # durable energy (AU, anonymous public carriage), health (US) and industrial (EU) roles (AWP_SPARQ_POLICY_BIN)
npm run pilot:smoke              # operator smoke script (POSIX sh; also runs under zsh)
node dist/pilot/cli.js           # awp-pilot: init / pin / propose-meeting / process / serve / mcp / …
```

**Local MCP interface.** `awp-pilot mcp --name N --dir D` runs one agent as an MCP server on
stdio (official `@modelcontextprotocol/sdk`; no network listener). A coding agent can inspect
the profile, status and evidence, propose a synthetic meeting to a pinned peer, and read or
acknowledge reviewed signed envelopes. The same server carries peer messages (`mcp-tool/0.1`,
tool `deliver_inbound`), which the runtime verifies exactly as on any other binding. See
[`docs/mcp/coding-agent.mcp.json`](docs/mcp/coding-agent.mcp.json).

**Agent roles and the optional A2A binding.** An agent directory hosts a role (`init --role`):
`personal` (default), or the SYNTHETIC `mortgage-consumer`, `mortgage-lender` and
`mortgage-underwriter` — independently initialised, durable actors composed from the existing
mortgage handlers, with narrow declared MCP operations and owner approvals signed out of process
(`awp-pilot sign-approval`). `awp-pilot mcp --a2a` additionally runs a loopback-only A2A 1.0
listener (official `@a2a-js/sdk` 1.2.1) that carries signed envelopes to explicitly pinned
peers; an A2A response is a transport acknowledgement, never an agreement or permission.
Every A2A send passes the same send-time transmission boundary as provider sends (current
mandate, revocations, approvals, policy module; durable intent/outcome; identical re-authorised
resends only). `init --owner-dir DIR` keeps the owner key out of the service directory (the
service never loads it; a same-user directory, not hardware custody). The lender's
purpose-bound store repairs interrupted commits on open and has an explicit, bounded
`purge_expired` retention operation that erases that store's copy only. Profile §5, §7,
§19–§20; runbook §1a, §7a–§7c.

**Durable regional roles (phase 8, SYNTHETIC).** These roles compose the existing domain
handlers with fixtures shared with the in-process scenarios:

- `energy-retailer` and `energy-comparator` — anonymous public requests over the loopback
  `public-http/0.1` carriage; usage and location stay with the comparator;
- `health-patient`, `health-authorization` and `health-resource` — a SMART-like pattern; the
  patient signs authorisations and revocations out of process with `owner-sign`; token issuance
  uses a separate issuing key;
- `industrial-planner`, `-authority`, `-provider`, `-contracting` and `-diagnostic` — internal
  delegation, exact agreement, transfer, recommendation and a simulated work order, kept as
  distinct events.

`awp-pilot roles` lists them. `init --owner-name ORG` shares one organisation owner key across
that organisation's agents; each keeps its own actor key. No CDS/CDR, SMART/OAuth, HIPAA,
Catena-X/DSP or legal-eligibility claim is made. See profile §21–§23 and runbook §7d.

**Phase 9 (profile 0.1.2).**

- Health grants are issued only when three things agree: a clinic enrollment register binding
  the authenticated patient to their compartment, a consent addressed to that service for that
  purpose, and a currently valid consent window.
- Revocations must carry the revoking patient's own issuer-signed grant.
- Protected deliveries (health searchsets, NordWerk dataset releases) keep their authorisation
  basis as a disclosure condition, re-checked at every transmission. A queued reply is not sent
  after its grant was revoked or expired.
- Received public replies are retained durably and recovered after a crash.
- Start with [LOCAL-HANDOFF.md](LOCAL-HANDOFF.md) and profile §24.

Pin peer keys with the `--flag=value` form (a thumbprint may start with `-`):
`awp-pilot pin --name alice --card bob.card.json --party-kid=<kid> --actor-kid=<kid>`.
Profile 0.1.1 mints URN identifiers; directories created by 0.1.0 must be re-initialised.
Operating steps (incl. the setup-required Gmail hand-off): [`docs/OPERATOR-RUNBOOK.md`](docs/OPERATOR-RUNBOOK.md).

The owner dashboard (`npm run dashboard`) is a loopback-only settings UI. It covers:

- account inventory and status provenance;
- calendar authority, which the agent applies at its next start;
- per-account restrictions and the three-layer permissions view;
- optional, off-by-default TypeSafe message triage.

See [`docs/DASHBOARD.md`](docs/DASHBOARD.md).

Deterministic actions (no model) cover:

- availability across Google, Microsoft and synthetic calendars;
- meeting proposals and slot checks;
- contact lookup, reply preparation and an action queue.

They are available from the CLI (`awp-dashboard actions`), MCP and the dashboard: see
[`docs/ACTIONS.md`](docs/ACTIONS.md) and the provider token contract in
[`docs/PROVIDER-ACTIONS.md`](docs/PROVIDER-ACTIONS.md). The separate credential helper
`awp-credentials` handles Google and Microsoft sign-in (loopback, PKCE, verified account),
private token storage and refresh; see [`docs/PROVIDER-SETUP.md`](docs/PROVIDER-SETUP.md). It has
been tested against a local fake provider only.

The pilot still extracts email content only through the bridge's `parseEmail`; in addition,
its strict human-parity check uses a small bounded reader (`src/pilot/bindings/mime.ts`) that
accepts only the pilot's own MIME layout and rejects everything else.

Profile, wire semantics, security assumptions, supervisor interface and boundaries:
[`docs/PILOT-PROFILE.md`](docs/PILOT-PROFILE.md); evidence matrix:
[`docs/PILOT-MATRIX.md`](docs/PILOT-MATRIX.md); RDF vocabulary:
[`docs/rdf/awp-pilot.ttl`](docs/rdf/awp-pilot.ttl).

## Security posture (§7)

- **No single context both reads hostile input and holds act-credentials** (the Reader/Actor/outbox
  split, structurally enforced).
- **Untrusted email** goes only through the bridge's exhaustively-hardened `parseEmail`; this package
  never hand-rolls RFC/MIME parsing or RDF (it uses `@jeswr/fetch-rdf`, `@solid/object`, `n3.Writer`).
- **Owner-private + ACL-first**: every container is owner-only ACL'd before any content (regression
  tested).
- **Deny-by-default autonomy** via the signed ODRL mandate, enforced in the no-LLM executor.
- **At-most-once send** (compare-and-swap claim before send).
- **SSRF-guarded, redirect-refusing** remote reads; the pod (the owner's own origin) uses the injected
  authed fetch.

## Follow-ups (incl. `@jeswr/solid-odrl` API-gap dogfood)

- **ODRL `recipient` is a value operand, not a class.** Constraining an autonomous send by a
  *recipient class* (e.g. "anyone in my org") is not expressible with `@jeswr/solid-odrl`'s `recipient`
  left-operand today (it does exact / `isAnyOf` value comparison). This is the primary API gap this
  build surfaced — worth a `recipient`-class / group-membership constraint mechanism upstream.
- **Residual-only LLM routing.** The bridge's `composeInterpreters` runs every interpreter and
  concatenates; true "LLM sees only the residual prose" gating (§5.1) is a bridge refinement. M1 uses
  the deterministic-only interpreter so the hot path is genuinely zero-LLM.
- **Live-key mandate verification** (`createSolidVcMandateVerifier`) needs an integration test with
  real signing/verification keys.
- **Live senders + OAuth + the remaining channels + the A2A endpoint** (Stages 1–3).

## License

MIT © Jesse Wright
