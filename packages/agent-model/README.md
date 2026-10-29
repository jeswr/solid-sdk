<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# @jeswr/agent-model

> Experimental — AI-agent-generated. Private until conformance review.

Channel-neutral interaction types, bounded message validation, conversation transitions,
canonical digests and RDF mappings for the ten pod record families in agent DESIGN §2.4.

```ts
import { toRdf, fromRdf, recordToTurtle, recordFromTurtle } from '@jeswr/agent-model';
import { exampleRecords } from '@jeswr/agent-model/testing';

const account = exampleRecords.account;
const dataset = toRdf(account);
const restored = fromRdf(dataset, account.id);
const turtle = await recordToTurtle(account);
const parsed = await recordFromTurtle(turtle, account.id);
```

Every record has a `type` discriminator and an absolute `id`. Records are strict:
unknown fields, ambiguous scalar values, wrong RDF datatypes and malformed nested
content are refused. Optional fields are omitted when absent. Dates preserve their
original lexical form. Ordered arrays use RDF sequences; extracted structured content,
audit payloads and opaque proofs use `rdf:JSON` literals. Typed fields remain queryable. Nested structures may use blank nodes on input;
record IDs and authority references remain absolute IRIs.

Accounts expose `channelHandleHash`; intents expose `recipientHash`. Callers compute
salted hashes before constructing records. No handle-resolution or send operation exists.
Accounts may also carry a strict `inventory` object with all salted `channelHandles`,
unresolved `credentialRefs`, setup status, observation/test dates (reported text), historic
connector evidence and identity conflicts. Inventory lists use RDF sequences; evidence and
conflict items use `rdf:JSON`. The primary handle remains scalar and may be omitted only
when an explicit inventory has no handles. Inventory observations establish no live access.
Owner restrictions, label and binding state remain separate from inventory.
Approval and mandate proofs are preserved without verification. A parsed approval is
not authority to act; cryptographic verification and current expiry/revocation checks
belong to agent-mandate and agent-executor. Mandate records reference credentials rather
than issuing or interpreting their policy graphs.

Subpaths: `./core/{types,canonical,schema,limits,conversation}`, `./vocab`,
`./profile/vocabulary`, `./rdf`, `./rdf/serialise`, `./rdf/evidence`, `./testing`.
The pilot query/JSON-LD helpers remain available; `parseTurtle` is asynchronous and uses
fetch-rdf. Vocabulary definitions are shipped in `docs/vocab.ttl`; regenerate them after a build
with `node scripts/generate-vocab.mjs` from this package directory.

The copied core test uses the unchanged pilot integration fixtures through the
test-only personal-agent workspace dependency. Production modules never import it.

Run `pnpm run lint`, `pnpm run build`, `pnpm run typecheck`, and `pnpm run test` here.
The package remains private per ADR-001 D5.
