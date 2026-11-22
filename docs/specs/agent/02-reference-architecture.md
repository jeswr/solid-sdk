<!-- AUTHORED-BY Claude Fable 5.2 -->
# Reference architecture

Draft 0.5, 13 November 2026. Not normative, except where it cites a requirement of the
core. This document describes one way to build an agent that meets the core, and the
variants of it that fit different settings. An implementation may be built differently, as
long as its traces conform.

## 1. The shape

```
                       ┌──────────────────────── the agent ────────────────────────┐
                       │                                                           │
   other   ──message──▶│  INBOUND GATE ──admitted, labeled──▶  CORE  ──proposes──▶ │
   agents              │  integrity                            (a model or         │
   and                 │  source                                a program;         │
   services            │  authority                             no keys,           │
           ◀──message──│  terms                                 cannot send)       │
                       │  fitness                                    │             │
                       │      │                                      ▼             │
                       │      ▼                              OUTBOUND GATE         │
                       │   memory ◀──── recall ───────────   mandate               │
                       │                                     recipient             │
                       │   policies   trust store   record   disclosure            │
                       │                                     data terms            │
                       │                                     limits and approval   │
                       │                                     evidence              │
                       └──────────────────────────────────────────┬────────────────┘
                                                                  │ asks, shows, stops
                                                                  ▼
                                                             the principal
```

There are four active parts and four stores.

| Part | What it does | What it must never do |
|---|---|---|
| Principal | The person or organization the agent acts for. Signs the mandate, sets limits, approves what the mandate says needs approval, can stop the agent | |
| Inbound gate | Ordinary code. Runs the five inbound checks on everything that arrives. Admits, asks for more, or refuses | Pass anything to the core or to memory that it did not admit |
| Core | Whatever does the thinking: a language model, a planner, a fixed program. Sees admitted, labeled data. Proposes actions | Hold a key, send a message, write to memory, or change a rule |
| Outbound gate | Ordinary code. Runs the six outbound checks on every proposed action. Lets it go, asks the principal, or stops it. Signs what goes | Let anything out that it did not check |

| Store | What it holds | Who writes it |
|---|---|---|
| Policies | The mandate, the principal's limits and rules, the domain profiles in force | The principal, through the gate |
| Memory | Admitted facts, each with its source, terms, age and method | The inbound gate only |
| Trust store | The principal's own list, the roots they accept, and answers kept from lookups until they expire | The principal; the inbound gate for lookup answers |
| Record | One entry per check, outcome, approval and action | Both gates. Append-only |

The core is a black box on purpose. Nothing in the design depends on how it works or on its
being right. That is what lets the same design hold a small scripted program today and a
more capable model later, and lets two vendors compete on the core while sharing everything
around it.

## 2. One message in, one action out

**In.** A message arrives over some transport. The gate takes the signed parts and ignores
the wrapping. It runs integrity, source, authority, terms and fitness, in that order, and
writes each verdict to the record. If all pass, the content goes to memory with its labels
and to the core as data. If the gate needs something the sender can supply, such as a
stronger approval, it says what. Otherwise it refuses, with a reason that reveals no more
than the sender needs.

**Out.** The core proposes an action: send this, ask for that, accept an offer. The gate
runs mandate, recipient, disclosure, data terms, limits and approval, and evidence, in that
order. If the mandate says the principal must approve, the gate asks them, in words it
builds itself from the action. If everything passes, the gate writes the decision to the
record, signs the message and hands it to the transport.

A message that needs nothing from the core, such as a receipt, still passes both gates.

## 3. Where the lines are

Three boundaries matter. An implementation should be able to point to each in its code.

1. **Around the core.** Everything the core reads came through the inbound gate. Everything
   it causes goes through the outbound gate. It has no network access of its own. Code it
   writes runs inside this boundary.
2. **Around the keys.** The gate's signing key is usable by the outbound gate alone. The
   principal's key is on the principal's own device and is never held by the agent. An
   approval is something the principal's device signs, not something the agent asserts.
3. **Around the record.** Entries are signed by the gate and chained. The core cannot write
   or change one. A copy or a commitment leaves the agent on each receipt.

What is inside the trusted base is deliberately small: the two gates, the rule evaluator,
the signature code and the stores. It contains no model.

## 4. Variants

The same shape fits different principals and different ways of holding data.

### 4.1 A personal agent

The principal is a person. Policies are few and written in their terms: limits on money,
on who may be dealt with, on what needs asking. The trust store starts with the roots their
operator suggests, which they accept or change, and their own short list. Approval reaches
them in chat or as a notification, and the stronger levels use a passkey or an identity
provider. This is the variant the worked example shows.

### 4.2 An organization's agent

The principal is an organization. Three things change. The mandate is issued under the
organization's own governance, by an officer who can bind it; competence is established by
a register (CORE-D-3). "Ask the principal" goes to a role or a queue, not to one person,
and the record names who answered. And there are usually many agents under one
organization: each has its own key and its own mandate, narrower than the organization's
authority (CORE-S-3).

### 4.3 A service with no core

An index, a register and a trust root answer questions from data they hold. They have both
gates and no core: the "proposal" is a fixed function of the request. They still sign what
they send, still record what they answered, and still refuse a request they cannot
authorize. Drawing them this way makes one point plain: the checks do not depend on there
being a model.

### 4.4 Data in a pod

Memory lives in storage the principal controls, with its own access rules, at a provider
separate from the agent's operator. The agent reads and writes it through the gates. Other
parties can be given time-limited access to a resource instead of a copy (data access
`by-reference-solid`), and the record can be mirrored there (accountability `pod-mirror`).
The principal can change agents and keep their memory and their record.

### 4.5 A knowledge graph as memory

Memory is a graph of statements, each admitted fact a small signed, sourced unit. The core
queries it. Because each statement keeps its labels, a derived answer can be traced to the
statements it used, and the outbound gate can apply the terms of every one of them
(UC-3). Conflicts are held side by side with their ranks instead of being overwritten
(CORE-IN-14).

### 4.6 Gates around an assistant the person already uses

Many people already have an assistant. The gates can be supplied as an adapter that the
assistant calls as a tool: the assistant is the core, and the adapter is everything else.
The assistant can only propose through the adapter, and only sees what the adapter admits.

This is the easiest way to adopt the design, and it has a limit that must be stated: the
adapter controls the channel it provides and nothing else. If the assistant has other tools
that reach the network or the person's data, the boundary around the core does not hold,
and the deployment does not meet CORE-C-6. An honest adapter says so in its description,
and claims conformance only for the channel it controls.

## 5. Where each store's contents come from

| Question | Answer |
|---|---|
| Who may the agent deal with? | The principal's own list, then a lookup from a root they accept (trust framework layer) |
| What may it do? | The mandate (delegated authority layer) and the principal's limits |
| What may it do with data it holds? | The terms attached to each item (usage control layer) |
| What does it believe? | Admitted facts, weighed by the reliance rules |
| What did it do? | The record (accountability layer) |

## 6. How built agents compare

Three agents built before this design were checked against it on 13 November 2026, reading
their code. None was built to it, and the gaps are the reason for the design. Filled means
present, partial means present in some paths, none means absent.

| | Protocol pilot | Suite agent | Policy sandbox |
|---|---|---|---|
| What it is | Separate signed agents exchanging messages; scripted roles | Production packages and a daemon acting for a person | One organization's agent with a gate on every tool call |
| Core | Scripted. No model | A model that reads with no tools and proposes; it cannot send | A model, plus code it writes, run in a locked box |
| Inbound integrity | Filled: signature, audience, time window, single use | Partial: structure checks only; no signature is verified and nothing stops a replay | None: no signatures; labels are unsigned |
| Inbound source | Partial: source rules exist, and only some flows call them | None | None |
| Inbound authority | Filled: a signed statement of representation on every message | None | None |
| Inbound terms | Partial: terms are negotiated and bound to what is delivered | None | Filled: a record is released only if its label allows the read |
| Inbound fitness | None | None | None |
| Ask for more | None; refusal reason codes come closest | None | None |
| Outbound mandate | Filled; the mandate also limits recipients | Filled: the mandate is a credential | Filled: checked per recipient |
| Outbound recipient | Filled: pinned keys and the mandate's recipient list | Filled | Partial: a fixed directory of names, no keys |
| Outbound disclosure | Partial | None | Partial: withholds whole records, not fields |
| Outbound data terms | Partial | None | Filled |
| Limits and approval | Partial: approval is bound to the exact action; no spend or rate limits, no stop switch | Filled: limits and a stop switch | Filled: send and spend limits and a person approving held calls; the approval is unsigned and there is no stop switch |
| Evidence and record | Filled: signed, hash-chained | Filled: a ledger mirrored to the person's pod | Partial: hash-chained, held in memory only |
| Memory | Partial: runtime state | None at runtime: the package exists and is not wired in | Partial: labels on what has been read |
| Trust store | Pinned keys and source rules | Partial: the owner's keys only | Partial: a fixed directory, no keys |
| Transports | In-process, HTTP, email, MCP, A2A | Email and direct channels | Tool calls |

Read across, the three have complementary halves. The pilot has the strongest inbound side
and message format and no model. The suite agent is strong on the way out and thin on the
way in. The sandbox has the best treatment of data terms and of an organization's rules,
and no signatures. The reference implementation that produces this family's traces starts from
the pilot and adds what the other two show is needed. Bringing the suite agent up to the
design is on the roadmap.

## 7. What the explorer shows

The explorer is a debugging view of the reference implementation. Each agent is drawn as in
section 1. Playing a trace lights each part as it acts, fills each check with its verdict,
shows each message with its parts, and shows what the principal saw. It draws nothing that
is not in a trace, and it marks which traces came from the implementation and which are
development fixtures (CF-5).
