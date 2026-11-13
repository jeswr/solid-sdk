<!-- AUTHORED-BY Claude Fable 5.2 -->
# Answerable: overview and map

Draft 0.4, 13 November 2026.

**Answerable** is the name of this family of specifications. An agent that follows it answers
for what it does, and answers to the person or organization it acts for. An implementation
that passes the conformance scenarios for a configuration can call itself an Answerable
agent under that configuration.

This family of documents describes how software agents that act for people and organizations
can deal with each other, and with ordinary services, in a way that can be checked afterwards.
It builds on the September 2026 framework draft (0.3) and its outline (0.2). Those set out the
concepts. This revision adds three things: a processing model (the checks an agent runs on
every message in and every action out), a layered set of interchangeable suites, and a
conformance method based on recorded traces.

## Status

This is a working draft by one group. It is not a standard, and no standards body has
endorsed it. One implementation exists, and both sides of every recorded exchange run that
implementation. Independent implementations are the next test. Where a document says an agent
MUST do something, that is a proposed requirement for implementations that claim to follow
this draft.

## The idea in one page

An **agent** acts for a **principal**, who is a person or an organization. The principal signs
a **mandate** that says what the agent may do, for what purpose, with whom, within what
limits, and when it must ask first.

Agents exchange **verifiable messages**. A verifiable message can be checked without trusting
the way it arrived. It carries who sent it and a proof, the sender's authority, the content,
the evidence behind the content, the terms for using it, and where it came from and how good
it is.

Every message that arrives passes five **inbound checks**, in order, before the agent's
reasoning sees it: integrity, source, authority, terms, fitness. Every action the agent
proposes passes six **outbound checks**, in order, before anything leaves: mandate, recipient,
disclosure, data terms, limits and approval, evidence. The checks are ordinary code. They do
not depend on a model behaving well. Each check writes its verdict, and the rule that decided
it, to a **record**.

No single standard supplies all of this, and different communities will make different
choices. So the family is split into eleven **layers**. Each layer answers one question. For each
layer there are interchangeable **suites**. One suite per layer is a **configuration**. Two
agents can work together when they share a configuration they both accept. The **baseline
configuration** is the one every implementation is asked to support, so that two strangers'
agents always have something in common.

A suite counts only when it has run. Every suite and every configuration is backed by a
**trace**: the record of a real run of a named scenario. The traces are the test suite, and
they are what the explorer site replays.

## The documents

| Document | What it is | Part of the September outline |
|---|---|---|
| [00 Overview and map](00-overview.md) | This page | |
| [01 Core](01-core.md) | Terms, the verifiable message, the checks and their outcomes, the record, configurations. Normative. | A. Conceptual framework |
| [02 Reference architecture](02-reference-architecture.md) | Two gates around a black-box core, and its variants. Not normative. | A (informative) |
| [10 Transport](10-transport.md) | How a message gets there | E. Bindings |
| [11 Data access](11-data-access.md) | How the content gets there | E. Bindings |
| [12 Identity](12-identity.md) | What names a party, and how its key is found | C. Mechanism profiles |
| [13 Shared meaning](13-shared-meaning.md) | Whether both sides read the terms the same way | B. Vocabulary, D. Descriptions |
| [14 Delegated authority](14-delegated-authority.md) | Whether this agent may do this for this person | C. Mechanism profiles |
| [15 Authenticity](15-authenticity.md) | Whether a statement is really from its source | C. Mechanism profiles |
| [16 Trust framework](16-trust-framework.md) | Why to accept this party or source at all | C. Mechanism profiles |
| [16b Reliance](16b-reliance.md) | How far to rely on a statement, for this task | C. Mechanism profiles |
| [17 Usage control](17-usage-control.md) | What may be done with the data, and who enforces it | C. Mechanism profiles |
| [18 Commitments](18-commitments.md) | What was agreed, and whether it is binding | C. Mechanism profiles |
| [19 Accountability and redress](19-accountability.md) | What happens when something goes wrong | C. Mechanism profiles, F. Assurance |
| [20 Baseline configuration](20-baseline.md) | The recommended default, one suite per layer, and the path up from plain email | D. Descriptions |
| [30 Mortgage profile](30-profile-mortgage.md) | The worked example: claims, accepted sources, assurance levels | F. Domain profiles |
| [40 Conformance](40-conformance.md) | The trace format, expected outlines, and what a claim of conformance means | G. Conformance |
| [50 Requirements and alignment](50-requirements.md) | How the design answers known risks and lines up with existing standards | G. Governance |

The first three layers (transport, data access, identity) are plumbing. Seven of the others
are the seven gaps named in the paper "Letting Software Agents Act for Us": semantic
interoperability, delegated authority, authenticity, trust frameworks, usage control,
commitments, and accountability and redress. The eleventh, reliance, is split out of the
trust framework gap and is labeled 4b: the trust framework says whether to accept a source,
and reliance says how much weight its statement gets for the task in hand.

## How the layers and the checks fit together

A check is a question an agent asks at a point in time. A layer is a place where communities
choose a mechanism. Most checks draw on more than one layer.

| Check | Layers it mainly draws on |
|---|---|
| Inbound 1. Integrity | Authenticity, identity, transport |
| Inbound 2. Source | Trust framework, authenticity |
| Inbound 3. Authority | Delegated authority, identity, trust framework |
| Inbound 4. Terms | Usage control, shared meaning |
| Inbound 5. Fitness | Reliance, shared meaning |
| Outbound 1. Mandate | Delegated authority, usage control |
| Outbound 2. Recipient | Identity, trust framework |
| Outbound 3. Disclosure | Data access, authenticity, usage control |
| Outbound 4. Data terms | Usage control |
| Outbound 5. Limits and approval | Delegated authority, commitments |
| Outbound 6. Evidence | Accountability, authenticity, reliance |

## Conventions

The words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are used as in RFC 2119 and RFC 8174.
Each requirement has an identifier, such as `CORE-IN-3`, so that a trace can cite the clause a
check applied. Sections marked "not normative" explain and do not add requirements.

Examples use fictional people and organizations: Sam, Sam's agent, North Bank, Harbour Bank,
Canal Bank, Paywell, a mortgage product index and a sector register.

## What is not decided

- A permanent namespace for identifiers. Examples use `https://w3id.org/jeswr/awp#`, which is
  provisional and unregistered.
- Which standards body, if any, should take this up. The alignment document lists the groups
  whose work it reuses.
