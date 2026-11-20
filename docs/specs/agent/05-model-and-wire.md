<!-- AUTHORED-BY Claude Fable 5.2 -->
# The model and the wire

Draft 0.1, 13 November 2026. Normative.

**Question: what, exactly, is a message made of, and does every part of the agent read it
the same way?**

## What this document fixes

Every other document here talks about messages, statements, mandates, terms and records.
This one says what those are as data. There is one model. It is published three ways, and
the three say the same thing:

- an **ontology**, which names each kind of thing and each property and says what it means;
- **shapes**, which say what a well-formed instance must contain;
- a **context**, which lets the same data be written as ordinary JSON.

A message on the wire is a JSON-LD document under that context. Inside an agent, what the
gates check is the graph that document denotes, never the parsed JSON. So the meaning of
what is checked is explicit at every point: at the wire, at each check of the inbound gate,
in what the core is handed, in what the core proposes, at each check of the outbound gate,
and in the record.

A developer needs none of the vocabulary of linked data to use it. A message looks like
JSON with short names. The context that gives those names their meaning is fixed, and a
tool may fold it out of sight.

## The model

- **MW-1. One namespace.** Terms this design defines are in `https://w3id.org/jeswr/awp#`
  (written `awp:`). The ontology, the shapes and the context are versioned together. A
  change to the meaning of a term is a new term or a new context version, never an edit.
- **MW-2. Reuse before minting.** Where a published term means what is meant, it MUST be
  used, and a new term MUST NOT be defined beside it.

  | For | Published terms |
  |---|---|
  | A statement by a third party, and a mandate | W3C Verifiable Credentials 2.0 |
  | What a mandate permits, prohibits and requires; terms that travel with data; an offer and an agreement | ODRL 2.2 |
  | Who produced something and how; the record | PROV-O |
  | Purposes and legal bases | Data Privacy Vocabulary |
  | Prices, invoices and payment | schema.org |

  Defined here, because nothing published covers them: the message and its kinds, the
  reference to an operation, the basis of a request, the kinds of assurance and what a
  proof binds (DER-13a), the checks, the outcomes and the reason codes.
- **MW-3. Every term can be shown to a person.** Each class, property and named individual
  has a label in plain words and a definition. Text put in front of a person (a question
  to the principal, an explanation of a refusal, a caption) MUST be built from labels and
  party names, and MUST NOT contain an identifier. The identifier stays available beside
  the text for a tool that wants it.
- **MW-4. Mappings claim no more than is true.** Where a term here is narrower than a
  published term, the ontology says narrower. It MUST NOT state equivalence that does not
  hold.
- **MW-5. Reason codes are terms.** Each reason code is a named individual with a label.
  A profile or a suite that adds a reason code adds it the same way.

## The context

- **MW-6. Short names, one meaning.** The context maps each short name used in a message
  to one term. It is protected: a document MUST NOT redefine a name.
- **MW-7. No default vocabulary.** The context sets no default vocabulary and no base. A
  name the context does not define has no meaning, and MW-11 makes it an error. This is
  deliberate. A processor that met an undefined name would otherwise drop it without a
  word, and the sender would have signed something the receiver never read.
- **MW-8. Typed values.** A value that is an identifier is typed as one. Times are
  `xsd:dateTime`. Amounts of money are decimals carried as strings, with a currency code,
  and are never binary floating point. A value from a closed list maps to a named
  individual.
- **MW-9. The context is carried, never implied.** A document on the wire MUST carry its
  `@context`, by identifier, inside what is signed. A tool that shows a message to a
  developer SHOULD fold the context away and show it on request. Nothing on the wire may
  rely on a context supplied by a header, a media type or an earlier message.

## Reading a document

A gate reads a document from another party, or from its own core, in this order. Each step
that fails gives the verdict `fail` with the reason `malformed` and the detail shown.

- **MW-10. Pinned contexts only.** The reader accepts a fixed list of contexts: this
  design's, Verifiable Credentials 2.0, Data Integrity, and the ODRL terms it uses. Each
  is a file the reader ships, checked against a digest written into the reader. Any other
  context identifier, any context written inline, and any other context inside a nested
  part is refused (`context-not-accepted`). A reader MUST NOT fetch a context.
- **MW-11. Strict names.** Before anything else is done with the document, every name in
  it MUST be either defined by the context in force at that point or a keyword of the
  format. Otherwise the document is refused (`undefined-term`).
- **MW-12. Shapes.** The document is converted to a graph, and the root is checked against
  the shape for its kind. A violation is refused, naming the shape and the property.
- **MW-13. Limits first.** Limits on size, depth and the number of unnamed nodes apply
  before parsing. A document with more than 64 unnamed nodes is refused
  (`too-many-blank-nodes`). What an agent creates SHOULD name every node.
- **MW-14. The core is another party.** What a core produces is read by MW-10 to MW-13
  like any document from outside. A gate MUST NOT take an object from the core on trust
  (CORE-OUT-1, CORE-OUT-2).

## Canonical forms, digests and proofs

A digest always names one document: a message, a statement, a mandate, an offer, the
message an approval is bound to, an entry in the record. The authenticity suite of the
configuration says which canonical form the digest and the proof use. No other part of an
agent needs to know which is in use.

- **MW-15. Signed bytes** (`jws`, the baseline). The canonical form is the JSON
  Canonicalization Scheme over the document without its proof. A developer can check it
  with no linked-data tooling. Reading such a document as a graph is sound only because
  of MW-9 to MW-11: the context is inside the signed bytes, it is a pinned context, and
  every name is defined, so the signed bytes have exactly one meaning. A verifier MUST
  check the proof over the bytes first and convert after. A document that has been written
  out again in another form no longer verifies under this suite.
- **MW-16. Signed graph** (`data-integrity`). The canonical form is RDF Dataset
  Canonicalization 1.0 over the document's graph, and the proof is a Data Integrity proof.
  A document can be written out again in any form that keeps the graph, with names in any
  order, and still verifies. A statement issued this way is an ordinary Verifiable
  Credential, and this is the form a proof system takes as its input (DER-13).
- **MW-17. Proofs keep their own graph.** Under MW-16 the proof's options sit in a named
  graph of their own. A text form that cannot carry named graphs, such as Turtle, does not
  carry the whole signed document. A lossless copy uses TriG or N-Quads. Turtle MAY be used
  to show the content of a message to a person.
- **MW-18. One digest per suite.** Within a conversation, every digest uses the canonical
  form of the conversation's authenticity suite. An approval is bound to the digest, in
  that form, of the exact message that would be sent (CORE-OUT-7).

## Inside an agent

- **MW-19. Checks read the graph.** Every check of both gates, and every mechanism a check
  calls, reads through typed access to the graph: the message, the statements it carries,
  the mandate's rules, the terms. A check MUST NOT read a parsed JSON object, and MUST NOT
  build a statement by joining strings.
- **MW-20. One reader, one writer.** Bytes become a graph in one place and a graph becomes
  bytes in one place. Everything else in the agent handles graphs.
- **MW-21. What is stored is the graph.** The agent's memory, its policies and its record
  hold messages, statements, mandates and terms as graphs, with the digest under which
  each was admitted.
- **MW-22. Representation changes nothing.** Moving a decision from one representation to
  another MUST NOT change the decision, the reason, or the order of the checks. An
  implementation that changes representation SHOULD keep the sequence of verdicts from
  before and compare.

## What a developer sees

A `describe` message, as a tool would show it with the context folded away:

```json
{
  "id": "urn:uuid:5d0c…",
  "type": "Describe",
  "from": "https://sam.example/agent#it",
  "to": "https://northbank.example/agent#it",
  "conversation": "urn:uuid:91aa…",
  "purpose": "mortgage-application",
  "body": { "operation": "decision-in-principle" },
  "proof": { "type": "JsonWebSignature", "jws": "eyJ…" }
}
```

On the wire the same document begins with its context, which is one line:

```json
{ "@context": "https://w3id.org/jeswr/awp/context/v1", "id": "urn:uuid:5d0c…", … }
```

The same content as a graph, which is what the gates check:

```turtle
<urn:uuid:5d0c…> a awp:Describe ;
    awp:from <https://sam.example/agent#it> ;
    awp:to <https://northbank.example/agent#it> ;
    awp:purpose <https://w3id.org/jeswr/awp#purpose/mortgage-application> ;
    awp:operation <https://w3id.org/jeswr/awp#op/decision-in-principle> .
```

## Which checks draw on it

All of them. This document adds no check of its own beyond reading (MW-10 to MW-13),
which is the first part of the inbound integrity check and of the outbound gate's reading
of a proposal.

## Open questions

- **An implied context.** A context bound by the signed configuration identifier, and so
  left out of each message, would save one line and add a way for two parties to disagree
  about meaning. This draft does not allow it.
- **Full ODRL context.** The reader pins the ODRL terms the design uses, not the whole
  published context. A statement that uses other ODRL terms is refused under MW-11.
- **Compact binary forms.** CBOR-LD would shorten messages for constrained transports. Not
  specified.
