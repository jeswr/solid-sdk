<!-- AUTHORED-BY Claude Fable 5.2 -->
# Data access

Draft 0.4, 13 November 2026. Layer: plumbing.

**Question: how does the content get there?**

## What this layer decides

A message can hand over data in more than one way. It can carry the data. It can carry a
pointer and a right to read. It can carry the answer to a question instead of the data the
answer came from. It can carry a result that several holders worked out together. A data
access suite fixes which of these an exchange uses, and what each side must do.

The choice changes what is disclosed, so it is the main lever of the outbound disclosure
check (CORE-OUT-4). It does not change who is believed. The evidence, terms of use and
provenance parts always describe the thing actually conveyed (CORE-M-9).

## What a data access suite must define

- **DA-1. Form.** Which of the four forms in the core (by value, by reference, as a proof, as
  a joint result) it uses, and for which kinds of content.
- **DA-2. What the receiver learns.** Exactly what the receiver ends up knowing, and what
  each other party involved learns.
- **DA-3. Evidence.** How the receiver checks the source of what it gets, given that it may
  never see the underlying data.
- **DA-4. Terms.** How terms of use attach to what is conveyed, and, for a pointer, how the
  terms and the access right stay in step.
- **DA-5. End of access.** How access ends: deletion, withdrawal of a grant, expiry of a
  session.
- **DA-6. Assumptions.** What must hold for the claimed privacy to hold, such as "no two of
  the computing parties share what they see".

## Which checks draw on it

Outbound disclosure and data terms. Inbound source and fitness, for the evidence of what was
conveyed.

## Suites

| Suite | Name | Status | Builds on | Maturity of what it builds on |
|---|---|---|---|---|
| `by-value` | By value | Baseline | | This work |
| `by-reference-solid` | By reference on Solid | Defined | Solid access grants, Linked Web Storage | Community draft, working draft |
| `by-query` | By query | Defined | SPARQL, DCAT catalog records | Standard |
| `aggregate-mpc` | Joint computation | Defined | Additive secret sharing, signed input attestations | Research |

### `by-value`

The content part holds the data. The sender's disclosure check reduces it first: a figure
instead of a document, a summary instead of a list. What is sent is in the receiver's hands
from then on, and only the terms of use and the receiver's own gate govern it. This is the
simplest form and the one that discloses most, which is why the other suites exist.

### `by-reference-solid`

The data stays in a pod. The sender's outbound gate does two things as one action: it grants
the receiver read access to the resource, and it sends a pointer with the terms of use. The
six outbound checks run on "change who can read this" exactly as they run on "send this".

- The grant MUST be no wider than the terms: same resource, same party, same period.
- The receiver's read of the pod is an inbound message and passes its five checks.
- Withdrawing the grant ends access to the source. It does not undo copies the receiver was
  permitted to make, so the terms of use MUST say whether copying is allowed.
- The pod's operator sees each read. The suite's description says so (DA-2).

### `by-query`

The receiver sends a question and gets back only the answer, with provenance for each row.
This is the form used against a public index or a register, and it can be used against a
pod. The question itself can reveal things about the asker, so a query to a public service
MUST carry no personal data, and the asker filters on its own side. Each row of an answer
that the asker will rely on MUST be checkable against the source that signed it.

### `aggregate-mpc`

Several holders work out one answer together, such as a total across accounts. Each holder
splits its input into random shares, one per computing party. Each computing party adds the
shares it holds and sends only that partial sum to the receiver. The receiver adds the
partial sums and gets the total. No share and no partial sum says anything on its own.

- Each holder MUST sign an **input attestation**: a statement that, for this session, it
  contributed the true value of the named item about the named subject at a stated time,
  with a commitment to the value and without the value. The receiver's source check runs on
  these attestations.
- The session, the question, the computing parties and the receiver MUST be fixed in a signed
  opening message that each holder's inbound gate admits before it contributes.
- The result MUST NOT be sent back to the holders when that would let one work out another's
  input. With two holders and a sum, it would.
- Assumptions (DA-6): the parties follow the protocol, and no two computing parties share
  what they hold. The registered version resists curious parties, not malicious ones. A
  version that resists malicious parties is future work with the engine's own computation
  library.

The receiver learns one number. Each holder learns nothing about the others. That is the
difference from `by-value`, where the receiver would see every statement.

## A fifth form in another layer

"As a proof" is listed in the core as a form of content. The mechanisms for it, selective
disclosure and zero-knowledge proofs of query results, are suites of the authenticity layer,
because what they change is how a statement is tied to its source. A configuration that
uses them pairs `by-value` here, carrying the proof, with that authenticity suite.

## Open questions

- Private lookup, where even the index does not learn the question. Oblivious HTTP hides who
  is asking. Private information retrieval hides what is asked. Neither is drafted here.
- Whether `by-reference` needs a second suite for stores that are not Solid pods.
