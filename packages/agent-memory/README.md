<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/agent-memory

> Experimental — AI-agent-generated. Private workspace package; Node >=24.

`createAgentMemory(options)` implements PKG recall, pending remember proposals,
owner-approved promotion and a one-time communication-rules import. It reuses
`@jeswr/pkg-memory`, the existing TypeScript port of `np_builder.py`, for UUIDv5
identifiers, assertion canonicalization, graphs and TriG serialization.

```ts
const memory = createAgentMemory({
  storage, // authenticated Solid StorageClient, provided by the host
  container: `${agentRoot}memory/`,
  ownerWebId, agentId,
  loadMandate, // verifies the current mandate, revocation and its signed memoryScope
  queueApproval, // durable idempotent upsert of kind: "remember", keyed by id
  webIdKeyResolver, // authoritative owner assertionMethod resolver
  shapes, // canonical knowledge-graph/shapes.ttl; supplied locally, never fetched
});

const proposal = await memory.proposeRemember({
  fact: { template: "preference", value: {
    propertyID: "scheduling", value: "Afternoon meetings",
  } },
  categories: ["pd:Preference"],
  origin: {
    kind: "owner-conversation", source: conversationTurnUrl,
    quote: "I prefer afternoon meetings.",
  },
});
// The UI renders proposal.trig and signs proposal.id + proposal.termsDigest
// with agent-mandate.issueApproval. The daemon then calls:
await memory.approveRemember(proposal.id, { id: approvalId, document: signedApproval });

const memories = await memory.recall({
  about: ownerWebId, purpose: "https://w3id.org/dpv#Personalisation", limit: 20,
});
```

The host must provision owner-private `memory/` and `memory/pending/` containers
before use. This package never creates or changes ACLs, loads credentials, calls
providers, or provisions pods. The initial adapter requires Solid's named,
conditional create semantics. Origins and imported rules are trusted host inputs;
a model must not be allowed to select `owner-conversation` or invoke the importer.
Only owner-typed conversation facts get `SelfReportedExplicit`; inference requires
a rule IRI and emits `Inferred` with `prov:hadPlan`. Clinical templates also require
`pd:Health`. All facts require explicit personal-data categories.

Recall reloads a verified `MemoryMandate` projection for every call and checks its
owner, agent and validity interval. The existing agent-mandate API does not yet
carry `memoryScope`; the host must extract and verify that signed field, never
synthesize it from model input. `undefined` means no authority. An absent scope
uses exactly `pd:Preference` for contact/scheduling preferences and communication
rules; an explicit empty scope disables recall. Every category of a nanopub must
appear in the scope. Health and finance therefore need explicit entries; there
is no wildcard, subclass expansion or category inference. Compact `pd:` names and
full `https://w3id.org/dpv/pd#` IRIs are accepted in scope/query inputs. Uncategorised
claims and non-Current or already invalidated claims are excluded. Purpose is
required and forwarded to the verified mandate loader for host policy checks.

Each recall result contains only its nanopub's four component graphs. Filtered
sibling graphs and shared batch/source metadata are never returned. Recall reads
only directly contained `.trig` files, skipping pending/nested containers and
foreign listing members. Malformed resources, storage failures and exceeded
bounds reject the call instead of producing misleading partial results. Defaults
are 1,000 listing entries and 1 MiB per resource; both are configurable.

Approvals use the real `agent-mandate.verifyApproval`, including the owner's
assertionMethod, signature, expiry and approve decision. The digest binds exact
pending bytes, owner, agent, proposal URL and destination. SHACL runs against the
approved snapshot through the real Node `rdf-engine` by default; a host may inject
an equivalent validator (including a CI pyshacl adapter). Missing shapes or failed
validation never permits promotion. No substitute KG shapes are bundled here.
Expiry is checked again after validation. Promotion copies the validated bytes
with conditional creation, then deletes pending with its strong ETag; it never
rereads mutable pending content through a generic move operation. A failed delete
can leave an approved copy and a pending resource; retries accept only identical
content, and a conflicting target is never overwritten. This is not an atomic
cross-resource move. Completed retries still verify and validate the signed data.

`importCommunicationRules({ yaml, commit, source })` accepts the conservative
schema below, with unique string IDs and rule text. Unknown rule fields, tags,
aliases, malformed YAML and duplicate IDs fail before writes. `commit` is a full
40-character Git revision; source provenance includes
`communication-rules.yaml@<commit>`. The source file is supplied by the caller;
this package performs no filesystem or registry reads.

```yaml
rules:
  - id: afternoon-meetings
    rule: Prefer afternoon meetings.
```

The import creates one pending batch of owner-attributed SelfReportedExplicit
preference nanopubs. It still requires signed approval and SHACL before recall.
A deterministic owner-specific filename makes the import one-time across process
restarts and concurrent instances, even if a later source revision is supplied.
Pending retries requeue the original bytes; approved imports are never rewritten.
The host's approval queue must be durable/idempotent. Ordinary proposals remain
pending if queue publication fails; the host can discover and requeue their TriG.

`./testing` exports `createMemoryApprovalQueue`, an explicit in-memory queue.
Tests use synthetic identities and generated keys, the real WASM SHACL engine,
and a disposable loopback CSS 7.2 server. The CSS file-root fixture exercises
protocol behavior anonymously and makes no authenticated/private-pod claim.
Three prefix batches derived from pkg-memory's independent Python fixture compare
UUIDv5 IDs and complete canonical dataset bytes. Raw TriG formatting and blank
node labels differ between serializers; raw Python/TriG byte parity is not claimed.
The original Python builder, canonical KG shapes and real registry YAML are not
present in this checkout.

Run the package's `lint`, `build`, `typecheck`, and `test` scripts from the workspace.
