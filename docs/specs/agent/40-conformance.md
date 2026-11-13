<!-- AUTHORED-BY Claude Fable 5.2 -->
# Conformance

Draft 0.4, 13 November 2026.

## What a claim of conformance means

An implementation never conforms "to the core". It conforms to the core **under a named
configuration**, and it shows this by running named scenarios and producing traces that
match their expected outlines.

A trace is a step-by-step account, written by the gates themselves, of every message, check,
verdict and decision in a run. It is the unit of evidence in this family. A suite with no
trace is a sketch (CORE-L-5), and the explorer shows nothing that did not come from a trace.

This document defines the trace format, scenarios and outlines, the levels of evidence, and
what must be true before a claim is made.

## 1. The trace format, `agent-trace/0.1`

A trace is one JSON document.

| Field | Meaning |
|---|---|
| `schema` | `"agent-trace/0.1"` |
| `scenario` | `id`, `title`, and `steps`: a map from step number to a short title |
| `configuration` | `id`, and `layers`: a map from each of the eleven layer identifiers to the suite in force |
| `agents` | The agents and services that take part: `id`, `name`, `actsFor`, `role` |
| `generated` | `commit` of the implementation, and `core`: `scripted`, `recorded-model` or `fixture` |
| `events` | The ordered list of events |

Each event has:

| Field | Meaning |
|---|---|
| `seq` | Position in the run. A logical clock; traces carry no wall-clock time. |
| `step` | The step of the scenario this event belongs to |
| `agent` | The agent in which it happened |
| `part` | `principal`, `transport`, `inbound-gate`, `core`, `memory`, `outbound-gate`, `record` |
| `kind` | `message-in`, `message-out`, `check`, `decision`, `store`, `recall`, `propose`, `ask-principal`, `principal-reply`, `record` |
| `check` | On a check: one of the five inbound or six outbound checks |
| `verdict` | On a check or decision: `pass`, `fail`, `ask-more`, `ask-principal`, `indeterminate`, `not-applicable` |
| `outcome` | On a decision: `admit`, `ask-more`, `refuse`, `go`, `ask-principal`, `stop` |
| `reason` | A reason code from the core registry or the profile |
| `rule` | The rule behind the verdict: `id`, and `text` generated from the rule itself |
| `refs` | The layers this check drew on: `layer`, `suite`, and `clause`, the identifier of the requirement applied |
| `resolution` | On a check that rested on a lookup: `question`, `path`, `answer` |
| `packet` | On a message event: the message as seen at the gate (below) |
| `fact` | On a store or recall: the item with its labels |
| `chat` | What the principal saw or said: `who`, `text` |
| `caption` | One plain sentence saying what happened |

A `resolution` path is a list of hops. Each has `at` (who was asked), `kind` (`own-list`,
`root`, `register`, `federation`, `international`) and `says` (what it answered).

A `packet` gives the message's `id`, `from`, `to` and `kind`, the `carriage` (the transport
suite and a summary, never trusted), and for each signed part (`header`, `authority`,
`content`, `evidence`, `terms`, `provenance`) whether it is `present`, a `summary`, and
optionally the `raw` value and its `digest`.

- **CF-1.** Events MUST be emitted by the code that runs the checks. A scenario driver MUST
  NOT write events on the gates' behalf.
- **CF-2.** Every check that ran MUST appear, including those with `not-applicable`
  verdicts, each with its reason.
- **CF-3.** `rule.text`, `chat.text` shown to a principal, and `caption` MUST be generated
  from the rule and the facts. They are not written by the core.
- **CF-4.** A trace MUST be reproducible: fixed test keys, a logical clock, and a core that
  is scripted or replayed from a recording. Two runs of the same commit give the same trace.
- **CF-5.** A trace whose `generated.core` is `fixture` was written by hand or by a
  generator for development. It is not evidence, and anything that displays it MUST say so.
- **CF-6.** A trace MUST NOT contain a private key, or personal data about a real person.

## 2. Scenarios and outlines

A scenario is a fixed story with fixed parties, facts and rules. Its identifier is
`<domain>-<name>`, such as `mortgage-main`. A trace is named `<scenario>--<configuration>`.

An **expected outline** is what a correct run must show. For one scenario under one
configuration, it is the ordered list of `{ agent, part, kind, check, verdict, reason }` for
every `message-in`, `message-out`, `check`, `decision` and `ask-principal` event.

- **CF-7.** A trace conforms when its events of those kinds match the outline in order and
  in every listed field.
- **CF-8.** For a scenario that ends in a refusal or a stop, the trace MUST also show that
  nothing the refusal was meant to prevent happened afterwards: no later `message-out`
  carrying the refused action, and no `store` of the refused content.
- **CF-9.** Outlines are published with the specification. An implementation does not write
  its own.

Changing the transport suite or the data access suite must not change the verdicts
(CORE-L-8). So the outline of a scenario under a configuration that differs from the
baseline only in those layers is the baseline's outline with the `message-in` and
`message-out` events adjusted, and the conformance suite checks exactly that.

### Required scenarios for `baseline/0.1`

| Scenario | What it shows |
|---|---|
| `mortgage-core` | The shortest complete exchange: request, evidence, approval, application, decision in principle |
| `mortgage-main` | The full story: index lookup, register chain, a request for stronger approval, evidence from two sources, offer, approval, acceptance, records |
| `mortgage-over-ask` | The lender asks for more than the mandate allows. The mandate check fails; nothing is sent |
| `mortgage-out-of-limit` | The offer is outside Sam's limits. The agent stops or asks, as the mandate says |
| `mortgage-injected-fee` | A message carries an instruction. The core is deceived and proposes a payment; the outbound gate stops it |
| `mortgage-stale-evidence` | A statement is too old. Fitness fails with `stale-data` and a fresh one is requested |
| `mortgage-forged-source` | A statement is signed by a key the register does not list for that source. Source fails |
| `mortgage-withdrawn-mandate` | Sam withdraws the mandate mid-flow. The agent's own gate stops, and the lender's status check fails |
| `mortgage-replay` | A message is sent twice. Integrity refuses the second |

The first five have traces from the reference implementation or are being produced now.
The last four are specified and have no trace yet.

### Scenarios for other suites

Each registered suite names at least one scenario that exercises what is different about
it. For the suites defined so far:

| Suite | Scenario |
|---|---|
| `email`, `mcp`, `a2a` | `mortgage-main` under a configuration that differs only in transport |
| `by-reference-solid` | `mortgage-main` with the balance read from Sam's pod under a time-limited grant |
| `aggregate-mpc` | `mortgage-deposit`: two banks, one total, neither balance revealed; and `mortgage-deposit-missing-attestation` |
| `regulator-claim` | `mortgage-claim`: the fee dispute, taken to the regulator with both records |

## 3. Levels of evidence

A claim says which level it is at.

| Level | Meaning |
|---|---|
| 0. Specified | Written down. No trace. |
| 1. Runs | One implementation produces conforming traces, with both sides of every exchange run by the same code base. |
| 2. Independent | Two implementations by different teams, sharing no code, produce conforming traces against each other. |
| 3. Deployed | In use between organizations, with real registers and real principals. |

Everything in this family is at level 0 or 1 today. The explorer says so on every page.
Level 1 shows what the design does. It does not show that independent implementations
interoperate, and nothing here should be read as claiming that.

## 4. Making a claim

- **CF-10.** A claim of conformance names the configuration and its version, the scenarios
  run, the level of evidence, and the commit of the implementation.
- **CF-11.** The claim is part of the agent's signed statement of what it runs (CORE-L-13)
  and of its description (CORE-L-9). Like any description, it is a claim that a receiver
  verifies and may decline to rely on.
- **CF-12.** An implementation that fails a required scenario MUST NOT claim the
  configuration. There is no partial conformance.

## 5. What conformance does not cover

Not normative. Conformance shows that the checks run in order and give the stated verdicts
on stated inputs. It does not show that an implementation's keys are well kept, that its
core cannot reach the network by some other path, or that its rules are wise. Those need
review of the implementation, and the requirements document lists what to look for.

## Open questions

- A JSON Schema for the trace format, published with the outlines.
- A way to run a conformance scenario against a remote agent, for level 2, without sharing
  test keys.
- Outlines for model-driven cores: the verdicts must match, and the proposals a model makes
  will vary. The outline format above already leaves `propose` events out for this reason.
