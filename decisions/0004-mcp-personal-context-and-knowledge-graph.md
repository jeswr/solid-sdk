<!-- AUTHORED-BY Claude Opus 5.5 -->
# 0004. MCP shared context and personal knowledge graph

- Status: proposed (2 Nov 2026)
- Bead: sst-b8c.20 (children sst-b8c.20.1 to .7)
- Scope: use cases 3 and 4 of the Solid MCP personal-data brief. Use cases 1 and 2
  (conversation archive and sync) belong to the MCP stack workstream and have their own note.

## Problem

Jesse wants every AI conversation, in any client and on any account, to start from the same
picture of him. That means two things:

1. **Shared context**: how he works, which accounts he uses, his standing preferences.
2. **A personal knowledge graph**: a longitudinal health record, and basic details (contacts,
   addresses, payment cards) that an agent can use to answer email or fill in forms.

Both live in his pod and are reached over MCP. Nothing is held in an assistant's own memory.

## Decision

### Use case 3: the shared-context document

- **One owner-authored Markdown document**, by default at `<pod>/agent/context/shared-context.md`.
  It is registered in the owner's private Type Index for `https://jeswr.org/ns/agent#SharedContext`
  (planned for slice 2; slice 1 uses the conventional path). Markdown is used because it is what
  the owner edits and what a model reads best. The meaning lives in prose, not in triples. Facts
  that agents act on belong in the knowledge graph instead.
- **Owner-only ACL**, as for everything below `agent/`. The MCP server already authenticates as
  the owner, so reading it needs no mandate. A hosted server that serves an agent that is not
  the owner must go through the mandate path described below.
- **No category data in shared context.** Addresses, health details, contacts and card data
  belong in the knowledge graph, where reads need a mandate and are audited. `context_read`
  refuses a document that contains a Luhn-valid 12–19 digit number (spaces and dashes
  allowed), and returns a `refused` result that does not echo the digits.
- The text is owner-authored data. Slice 2's setup helper and discovery must also check that
  nobody except the owner can write or append to it (`WAC-Allow`, or the ACL itself), so the
  document cannot carry someone else's injected instructions.
- Slice 1 reads below the MCP server's configured root. A server scoped to a sub-container
  therefore looks under that sub-container until Type Index discovery (slice 2) lands.
- A redirect or alias from the fixed path is refused, so the returned text and ETag always
  describe that one document (slice 3's `If-Match` depends on it).
- **Tools** in `@jeswr/solid-mcp` (registered from a separate `context-tools.ts`, so the
  conversation-archive work in the same package stays free of conflicts):
  - `context_read` (read-only, slice 1): returns the document text, its ETag and its URL. A
    missing document is a clear "not set up" result, not an error.
  - `context_propose_edit` (slice 3): returns a proposed replacement and a diff. Nothing is
    written until the owner approves, using the `agent-executor` approval flow and an
    `If-Match` on the ETag. Models never write the context directly.
- The `agent-memory` communication-rules import (`communication-rules.yaml@<commit>`) is
  linked from the document, not copied into it.

### Use case 4: the personal knowledge graph

Build on what already exists. Do not start a new store. `pkg-memory`, `agent-mandate`,
`agent-authz-verifier`, `solid-health-diary` and the Contacts model are on `main`. The
`agent-memory`, `agent-audit` and `agent-executor` implementations arrive with the group B
integration (PR #209); on `main` they are still scaffolds. Slices 3 and 6 depend on #209.

| Need | Existing package | Gap |
| --- | --- | --- |
| Facts as nanopublications with provenance and DPV categories | `pkg-memory` (templates: email, phone, address, preference, condition, allergy, medication, relationship) | Payment-card template; health observations (measurements, labs, vaccinations, encounters) |
| Approval-gated write, purpose-scoped recall | `agent-memory` (#209: `MemoryMandate.memoryScope`, a projection of a verified `agent-mandate`; `RecallQuery.purpose`) | MCP tools on top |
| Contacts | `solid-task-model` `ContactBook`/`Contact` (vCard), used by the Contacts app | A read-only projection into recall results; no second contact model |
| Diet and intolerance health data | `solid-health-diary`, `apps/pod-health` | Link diary conclusions into the KG as facts with `prov:wasDerivedFrom`, without copying them |
| Authorisation and audit | `agent-mandate`, `agent-authz-verifier`, `agent-audit` (#209) | Wire MCP recall through them; the host projects `memoryScope` from the verified mandate |
| Imports of data an assistant has already collected | none | One-time import into pending (unapproved) nanopublications |

**Storage layout** (all owner-only by default, with no inherited public or authenticated access):

- `agent/memory/` holds the `agent-memory` container: approved nanopublications, and `pending/`
  for proposals.
- `agent/memory/health/` holds health facts, separated so that their ACL and mandate scope can
  be narrower than everything else.
- Contacts stay where the Contacts app keeps them. The KG refers to them and does not copy them.

**Reads over MCP** go through `agent-memory` recall:

1. The MCP host builds a `RecallQuery` with an explicit purpose (`ServiceProvision` for form
   filling and email replies, `Personalisation` for tailoring).
2. The host verifies a signed, unrevoked `agent-mandate` with `agent-authz-verifier` and
   projects it to `agent-memory`'s `MemoryMandate`, whose `memoryScope` lists the DPV
   categories the query may read. Special-category data (health,
   under DPV-PD) needs its own explicit category in scope. The default excludes it.
3. Every recall, allowed or refused, writes a PROV record to `agent-audit`. The record holds
   the category list and the resources returned, never their values.

The MCP tool arguments come from the model, so they can only narrow a query. The purpose and
the mandate come from the host's configuration, never from the model.

**Writes** are always proposals, using `agent-memory` `remember` and owner approval. An
assistant that has "already collected" data imports it as pending nanopublications for the
owner to approve in one batch.

### Payment cards (non-negotiable)

- A card fact stores only the **brand, the last four digits, the expiry month and year, and a
  billing-address reference**. The schema has no field for a full card number (PAN) or a CVV.
- The template validator requires the last-four field to match `^\d{4}$`. A Luhn-valid
  12–19 digit sequence anywhere in the claim, with or without spaces or dashes, is refused
  before anything is written, and the refusal never echoes the digits.
- Form filling that needs a full card asks the owner every time. A vault design is a separate
  decision for Jesse (bead sst-b8c.20.7, `needs:jesse`).

## Consequences

- Shared context is human-first and easy to edit. Facts that need structure go to the KG,
  which keeps context reads cheap and makes the KG's permissions meaningful.
- Health data gets the strictest path: its own container, its own DPV scope, and audit on
  every read.
- The laptop-only `knowledge-graph/` work from Codex sessions is not touched. Because it
  already produces nanopublications with provenance, it can be imported later through the
  same pending-approval path.

## Slices

1. `context_read` MCP tool (this PR).
2. Type Index registration and discovery for `SharedContext`, plus a setup helper that creates
   the document with an owner-only ACL.
3. `context_propose_edit` with owner approval and an `If-Match` write.
4. `pkg-memory` payment-card template with the PAN/CVV refusal rules above.
5. `pkg-memory` health observation templates (measurement, lab result, vaccination, encounter),
   with links to `solid-health-diary`.
6. MCP `memory_recall` tool through mandate, verifier and audit; contacts projection.
7. `needs:jesse`: decide whether to have a card vault at all, and if so its design.
