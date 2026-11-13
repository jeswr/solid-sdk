<!-- AUTHORED-BY Claude Fable 5.2 -->
# Evaluation

Draft 0.5, 13 November 2026. Informative. A plan: no result is reported here until a run has
produced it.

**Question: how do we know the design works, and how would we find out that it does not?**

## 1. What "works" means

The design makes four promises. An agent built to it does only what its principal allowed,
even when its model is fooled. It discloses no more than a task needs. It relies only on
what it has reason to rely on. And when something goes wrong, the records show who was at
fault. Each promise has a cost: work not done, people asked too often, time and bytes. An
evaluation that reports the promises without the costs is not one.

## 2. Questions and measures

| # | Question | Measure | Method |
|---|---|---|---|
| Q1 | If the model is fully taken over, what can it cause? | Attack success rate with a worst-case core: the share of attacker goals that get a go | A |
| Q2 | How much legitimate work still gets done? | Task completion with the gates, against the same agent without them, with and without an attack running | E |
| Q3 | How often is the person asked? | Approvals per task, and the share the person would have granted anyway | A, E |
| Q4 | How much more than the minimum is revealed? | Items disclosed against the smallest set the task needs | E |
| Q5 | Does the inbound gate admit the right things? | Verdict and reason code after one change per check to a valid message. False admits must be zero | B |
| Q6 | Can an outsider tell who was at fault? | Share of injected faults for which a checker, given only the records, names the right party and clause | C |
| Q7 | How many real situations can it express? | Use cases that run from a profile and a scenario file with no change to the core | D |
| Q8 | Can each layer really be swapped? | Same scenario in every configuration: the outlines must match | D |
| Q9 | What happens where structure runs out? | On tasks with prose or pictures: the share finished without a person, and the share of wrong readings that reached a decision | E |
| Q10 | What does it cost? | Time, message size and round trips per exchange; the price of each way of assuring a derived answer | F |

## 3. Methods

**A. A worst-case core.** Most evaluations of agent defenses ask how often a particular model
is fooled. That number changes with every model. This design claims something stronger: the
gates hold whatever the model does. So the first test removes the model. The core is replaced
by an adversary that proposes exactly the actions an attacker wants, and by a generator of
random actions over everything the agent could propose. The gates decide. The properties
checked on every generated action are:

1. No action outside the mandate gets a go.
2. No item leaves for a recipient or purpose its terms do not allow.
3. Nothing reaches the core's context or the agent's memory without passing the inbound
   checks.
4. Every go and every stop is in the record before the action happens.
5. An approval covers exactly the digest the principal was shown.

A failure of any of these is a bug in the gates, not a statistic.

**B. One change at a time.** Every message in every real run is altered once per check (a
bad signature, an old timestamp, a different issuer, a withdrawn status, a mandate that does
not cover the request, terms changed after acceptance) and replayed. The expected verdict
and reason code follow from the clause the change breaks.

**C. Injected faults.** Each party misbehaves in turn: withholds a receipt, changes terms
after approval, uses data outside its terms, denies having received a message. A checker
that sees only the two records must name the party and the clause.

**D. The catalogue as tests.** Each use case in [35 Use cases](35-use-cases.md) becomes a
domain profile and a scenario file: parties, sources, the principal's mandate, the messages,
and the branches with their expected outcomes. A general scenario engine runs them through
the real gates with a scripted core, so runs are reproducible. A use case that needs a change
to the core is a finding about the core.

**E. Published benchmarks, with a real model as the core.** Section 4. Each is run in three
arms: the model with no gates; with the gates; and with each check switched off in turn, to
show which check stops which attack.

**F. Measurement.** Timings and sizes from the runs above.

**Later: proof.** The five properties in A are small enough to state formally over the
conversation state machine and to check with a model checker, and then to prove. That work
belongs with the formal treatment of derived data.

## 4. Existing benchmarks and how each is adapted

Task and attack counts are as reported by each benchmark's authors.

| Benchmark | What it tests | How it maps onto this design |
|---|---|---|
| [AgentDojo](https://arxiv.org/abs/2406.13352) | Injection through tool results: 97 user tasks, 629 security cases in banking, workspace, travel and messaging | A tool call is a proposed action. Tool output is content from a source nobody accepted. The user's request becomes the mandate. |
| [ConVerse](https://arxiv.org/abs/2511.05359) | A hostile agent on the other side: 864 privacy and security attacks in travel, real estate and insurance | Its three areas are in the catalogue. Privacy attacks test disclosure; security attacks test mandate and limits. |
| A2ASecBench | Attacks on agent-to-agent protocols | Impersonation, replay and forged agent descriptions against the integrity, source and authority checks. |
| SovereignNegotiation-Bench | Negotiating for a user: utility, privacy, consent, evidence, escalation, auditability | Its scores line up with the outbound checks: consent with approval, evidence with the evidence check, auditability with the record. |
| [AgentDAM](https://arxiv.org/abs/2503.09780) | Data minimization: 246 web tasks | Its leak rate is the disclosure measure, with the mandate stating what each task needs. |
| PrivacyLens, PrivacyLens-Live | Whether a disclosure suits its context | Contexts become purposes. Cases where listed purposes cannot express the norm are counted, not hidden. |
| [MedAgentBench](https://arxiv.org/abs/2501.14654) | Clinical tasks on a health record: 300 tasks | Reads are requests to a source under a mandate. Orders and notes are actions through the outbound gate. |
| tau-bench family | Following an organization's policy under pressure from a user | The policy becomes rules in the organization's mandate. The repeat-run score shows whether the gate makes compliance consistent. |
| [Magentic Marketplace](https://arxiv.org/abs/2510.25779) | Markets of buying and selling agents | Sellers that manipulate test limits and approval. Payments go through the commitments layer. |

### The mandate is the experimental variable

These benchmarks have no mandates. Someone has to write them, and whoever writes them
decides the result: a mandate written after reading the attacks will stop the attacks. So
every benchmark is run under three kinds of mandate, and all three are reported.

| Mandate | How it is written | What it shows |
|---|---|---|
| Fitted | From the task's own published solution: the smallest mandate that lets the task finish | The best the gates can do |
| Standing | One per area, written once, before looking at any attack | What a person would realistically set up |
| Drafted | By the model, from the person's instruction, and approved as written | What the baseline does on day one |

A mandate can refer to data: "pay the bill in this file". Then the payee comes from
content nobody vouched for, and the honest outcomes are to ask the principal or to require
the payee from a source that is accepted. Both cost something. Published defenses of the
same kind report the same cost, and this evaluation reports it as approvals per task (Q3),
not as a failure hidden inside a utility score.

### AgentDojo without a model

AgentDojo publishes, for every task and every attack, the tool calls that carry it out.
Replaying the task's calls and then the attack's calls through the gate needs no model and
gives three numbers per mandate kind: the share of attacks whose calls all get a go (Q1),
the share of tasks whose calls all get a go (the ceiling on Q2), and the approvals needed
(Q3). This is the first external result to produce.

## 5. Comparisons

- The same agent with no gates.
- Each benchmark's own published defenses, quoted from their papers and not re-run, with the
  difference in setting stated.
- The gates with one check removed, for each check.
- For disclosure: sending originals, against sending derived answers.

## 6. Phases

| Phase | What | Needs |
|---|---|---|
| E0 | Methods A, B and C over the mortgage runs and the catalogue | The general scenario engine |
| E1 | AgentDojo replayed without a model | A bridge from the benchmark's Python to the gate |
| E2 | AgentDojo and ConVerse with a model as the core | A model key |
| E3 | MedAgentBench with the health profile; tau-bench with policy as mandate | A health profile |
| E4 | Negotiation and marketplace benchmarks | The commitments layer running |

## 7. What would count against the design

- Any failure of the five properties under a worst-case core.
- A false admit in method B.
- Under standing mandates, attack success near that of the undefended agent: the gates
  would then depend on hindsight.
- Approvals per task so high that a person would stop reading them.
- A large share of catalogue use cases needing changes to the core.
- Faults a checker cannot attribute from the records.

## 8. Threats to validity

- **We write the mandates and profiles.** Hence the three mandate kinds, and standing
  mandates fixed and committed before attack sets are opened.
- **We wrote the catalogue.** Hence the external benchmarks.
- **The benchmarks were built for one agent with tools**, not for two agents that each have a
  principal. The mapping in section 4 is ours and can be argued with.
- **Scripted counterparties and fictional registers.** Runs show that the mechanisms work,
  not that institutions will run them (evidence level 1 in [40 Conformance](40-conformance.md)).
- **Model variance.** Runs with a model are repeated, and the share of tasks passed on every
  repeat is reported beside the mean.
- **People.** Whether a principal understands an approval request is not tested here. It
  needs a user study.
