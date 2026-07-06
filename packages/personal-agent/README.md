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

## What runs today vs. what needs credentials / deploy

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
