<!-- AUTHORED-BY Claude Fable 5.2 -->
# Shared meaning

Draft 0.5, 13 November 2026. Layer 1 of the paper's seven gaps (semantic interoperability).

**Question: do both sides read the terms the same way?**

## What this layer decides

Two agents can exchange a perfectly signed message and still disagree about what it says.
"Income" might be gross or net, monthly or yearly, one person's or a household's. A shared
meaning suite says where the terms in a message are defined, how each side shows which terms
it understands, and what happens when it does not understand one.

This layer is about the content part of a message and the vocabulary used in the terms of
use. It does not decide whether a statement is true or whether its source is accepted.

## What a shared meaning suite must define

- **SM-1. Where terms are defined.** Who publishes the definitions, where, and under what
  change process. Published versions MUST NOT change; a change in meaning is a new version.
- **SM-2. Declaring understanding.** How an agent states which vocabularies and versions it
  implements. Recognizing an identifier is not understanding it: a declaration covers the
  terms whose behavior the agent actually implements.
- **SM-3. Unknown terms.** What a receiver does with a term it does not understand. A term
  that matters to a decision MUST NOT be ignored. The verdict is `indeterminate`
  (`unsupported-term`), which leads to a request for clarification or a refusal.
- **SM-4. Mappings.** How a mapping between two vocabularies is stated: its direction, its
  scope, and what is lost. A mapping MUST NOT silently drop information that matters to a
  decision, and a value that was mapped or converted says so in its provenance.
- **SM-5. Units and qualifiers.** For quantities: unit, currency, period and whose value it
  is MUST be explicit in the data, not assumed from context.
- **SM-6. Who approves new terms.** When terms can be added during an exchange, who approves
  them and how that approval is recorded.

## Which checks draw on it

Inbound terms (can I read these terms of use) and fitness (is this the quantity I need).
Outbound disclosure (am I sending what was asked for, in the form asked for).

## Suites

| Suite | Name | Status | Builds on | Maturity of what it builds on |
|---|---|---|---|---|
| `fixed-vocabulary` | Fixed vocabulary | Baseline | Versioned RDF vocabularies | Standard |
| `registry-lookup` | Registry lookup | Sketch | A term and mapping registry | This work |
| `negotiated` | Negotiated | Sketch | A deliberation platform for standards | Research |
| `plain-language-upgrade` | Plain language, then upgrade | Sketch | | Research |

### `fixed-vocabulary`

Both sides use vocabularies published by one body, each at a named version, and listed in
the configuration. A domain profile names the vocabulary for its claims; the mortgage profile
does this for income, balances and offers. Terms of use are written in ODRL with a stated
set of actions and constraints. An agent's description lists the exact versions it
implements. A message that uses a term outside those versions is `indeterminate` at the
check that meets it.

This is the least flexible suite and the most predictable one, which is why it is the
baseline. It works when a sector has a body that can publish a vocabulary, and it puts all
the effort of agreement before the exchange instead of during it.

### `registry-lookup`

Terms and mappings between vocabularies are published in a shared registry. When a receiver
meets a term it does not implement, it looks for a registered mapping to one it does. A
mapping is a signed statement by its publisher and passes the receiver's inbound checks like
any other claim: is this publisher accepted for mappings between these vocabularies. A value
that arrived through a mapping carries that fact in its provenance, and the fitness check
can take it into account.

### `negotiated`

When no shared term exists, the agents propose one. The proposal goes to a deliberation
platform where the bodies and people concerned can comment, and a person with the authority
to do so approves the result. Until then the agents can proceed only on terms each side's
principal has approved for this exchange. The suite fixes how a proposal is made, how its
approval is evidenced, and how the approved term gets a stable identifier.

This is the route by which a fixed vocabulary grows. It is slow by design: agreeing what a
word means is a human decision.

### `plain-language-upgrade`

The exchange starts as ordinary prose, such as an email between two people or between a
person and an agent. Structured terms are added when both sides can handle them. Under this
suite a message in prose alone can be read and answered, but it MUST NOT be relied on for
anything the receiver's profile requires in structured form: prose can ask for a meeting;
it cannot be the evidence of income. Each side advertises the structured vocabularies it
supports, so the next message can use them. What an agent may do with prose, pictures and
its own free text under any suite is in [04 Content that does not fit](04-unstructured-content.md). The baseline document describes how this suite,
with the email transport, lets people start with what they already have.

## Open questions

- A register of terms for this family itself (the checks, verdicts and reason codes) as an
  ontology, with its governance. Planned on a deliberation platform.
- How much of a domain's meaning can be validated by machine. Structural validation shows a
  message is well formed. It does not show that both sides mean the same thing by it.
