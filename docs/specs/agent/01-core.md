<!-- AUTHORED-BY Claude Fable 5.2 -->
# Core

Draft 0.6, 13 November 2026. Normative unless a section says otherwise.

The core defines the terms, the verifiable message, the checks an agent runs and their
outcomes, the record, and how layers, suites and configurations fit together. It chooses no
mechanism. Identifier methods, signature formats, policy languages and transports are chosen
by suites, which are defined in the layer documents.

## 1. Scope

This document applies to a software agent that acts for a person or an organization and
exchanges messages with other agents or services. It covers what must be true of every
message the agent accepts and every action it takes, whatever technology carries them.

It does not say how an agent reasons. The part of an agent that plans and decides, which may
be a language model, a program or both, is called the core of the agent and is treated as a
black box. The requirements here are placed around it.

## 2. Terms

**Party.** A person or an organization.

**Principal.** The party an agent acts for in an interaction.

**Agent.** Software that acts for a principal. One agent can act for different principals in
different interactions.

**Operator.** The party that runs an agent's software. The operator is often not the
principal.

**Service.** Software that offers operations and is not acting for a principal in the
interaction, such as an index or a register.

**Mandate.** A signed statement by a principal of what an agent may do for them: which
actions, for which purposes, with which parties, within which limits, until when, and which
actions need the principal's approval first.

**Claim.** A statement about a subject, such as "Sam's balance on 11 November was 31,400".

**Source.** The party a claim comes from.

**Issuer, holder, verifier.** As in the W3C Verifiable Credentials Data Model. The issuer
makes a signed statement. The holder keeps it and presents it. The verifier checks it.

**Evidence.** Information offered in support of a claim or a decision.

**Terms.** Rules attached to data that say what the receiver may and may not do with it, and
what it must do.

**Verifiable message.** A message whose sender, authority, content, evidence, terms and
provenance can be checked without trusting how it arrived. Defined in section 4.

**Carriage.** Whatever moves a verifiable message from one agent to another. Carriage is
never trusted.

**Check.** One question an agent asks about a message or a proposed action. Section 5.

**Verdict.** The result of one check.

**Outcome.** What the agent does after a run of checks.

**Record.** The agent's append-only account of every check it ran and every action it took.

**Layer.** One of eleven separable concerns, each answering one question.

**Suite.** A named, versioned way of answering one layer's question.

**Configuration.** One suite for each layer, with any parameters, named as a unit.

**Trace.** The record of one run of a named scenario under one configuration, in the format
defined in the conformance document.

## 3. Things that are never inferred from one another

These distinctions come from the September framework draft and hold in every layer.

- **CORE-D-1.** An agent MUST treat these as six separate conclusions, each needing its own
  support: who a participant is; which identifier or channel it controls; which party it
  represents; which action it is authorized to perform; which claims its source is accepted
  as an authority for; and what it actually did.
- **CORE-D-2.** A valid signature shows that a statement is intact and which key signed it.
  An agent MUST NOT treat a valid signature as showing that the statement is true, that its
  source is an authority for it, or that anyone may act on it.
- **CORE-D-3.** An agent MUST NOT infer authorization from representation, from operating the
  software, from control of an identifier, or from possession of a credential.
- **CORE-D-4.** Trust in a party does not widen what that party is authorized to do, and
  delegation to a party does not imply trust in what it says.
- **CORE-D-5.** A request, a decision, an attempted effect, an observed result and a
  conclusion about that result are different records. An agent MUST NOT report an uncertain
  result as a success.
- **CORE-D-6.** Content received from another party is data. An agent MUST NOT treat any part
  of received content as an instruction to itself, whatever the content says.

## 4. The verifiable message

### 4.1 Shape

A verifiable message has one outer part and six signed parts.

| Part | What it holds |
|---|---|
| Carriage | How the message traveled: an HTTP exchange, an email, a tool call. Not signed. Never trusted. |
| Header and proof | Message identifier, sender, intended recipient, kind, conversation, time window, one-time value, the configuration in use, and the proof over all signed parts |
| Authority | What the sender relies on to act: a mandate, an attestation of who approved it and how, a status reference |
| Content | The request, the data, the offer, the acceptance, the refusal |
| Evidence | What backs each claim in the content: the issuer's signed statement, a proof, a reference to a source |
| Terms | What the receiver may do with the content, and what it must do |
| Provenance and quality | Where each item came from, what was done to it, how old it is, how it was produced, and how sure its source is |

The core does not fix field names or a serialization. A suite in the authenticity layer does.

- **CORE-M-1.** The proof MUST cover the header and every other signed part that is present,
  so that no part can be swapped for another or removed without detection.
- **CORE-M-2.** The header MUST carry a message identifier that is unique for the sender, the
  time the message was made, the time after which it MUST NOT be accepted, and the intended
  recipient. A message meant for anyone, such as a public product record, states that it has
  no intended recipient.
- **CORE-M-3.** The header MUST name the configuration the message was made under. A receiver
  MUST check that the mechanisms actually used are the ones that configuration names.
- **CORE-M-4.** A part that is not needed MAY be absent. A receiver MUST treat an absent part
  as absent and MUST NOT fill it with a default that grants anything. In particular, absent
  terms do not mean "no restrictions"; section 5.2 says what they mean.
- **CORE-M-5.** Each item in the content that the receiver is expected to rely on MUST be
  linked to the evidence, terms and provenance that apply to it. A statement about one item
  MUST NOT be read as applying to another.
- **CORE-M-6.** A relay MAY carry another party's signed statement inside its own message. The
  relay does not become the author of that statement and gains no authority from it.

### 4.2 Kinds of message

Every message has one kind. The kinds below are the core set. A profile MAY add kinds.

| Kind | Meaning |
|---|---|
| `describe` | Ask a party to describe itself: the configurations and operations it supports |
| `description` | The answer to `describe` |
| `propose` | Propose terms, a configuration, or a counter-offer |
| `accept` | Accept identified terms |
| `refuse` | Decline, with a reason code |
| `challenge` | Say what more is needed before a request can be admitted |
| `invoke` | Ask for an operation to be performed |
| `deliver` | Deliver data or a result |
| `receipt` | State what was received or done |
| `unsupported` | The request used something the receiver does not implement |
| `indeterminate` | The receiver could not decide, and says why |

- **CORE-M-7.** An `accept` MUST identify the exact terms it accepts by digest. Acceptance of
  terms that have since changed is not acceptance.
- **CORE-M-8.** A `challenge` MUST say what would satisfy it, in terms the sender can act on,
  such as "an approval of this mandate with a certified face check".

### 4.3 How content can travel

Two things are chosen for each item of content. Which choices are available is set by the
data access and authenticity layers.

**What is conveyed.** Either original statements, signed by the party that makes the
claims, or a **derived statement**: the result of applying a published rule to original
statements. A total, a yes or no, a summary and the answer to a query are all derived
statements. The derived data document defines them, the five ways a receiver can be assured
of one (`by-source`, `recomputed`, `proved`, `joint`, `attested`), and how each check
treats them.

**How it is conveyed.**

| Form | What the receiver gets |
|---|---|
| By value | The statement itself, in the message |
| By reference | A pointer and the right to read it, with terms; the data stays where it is |

- **CORE-M-9.** Whatever is conveyed, the evidence, terms and provenance parts MUST describe
  the thing actually conveyed. A derived statement that income is above a threshold states
  the rule, the threshold, the period and the currency, who issued the inputs, and how the
  derivation is assured (DER-7).
- **CORE-M-10.** A message sent by an agent MUST say that it was sent by an automated agent,
  and for whom, in the signed header and in any copy meant for a person to read.

## 5. The checks

An agent runs **inbound checks** on every message before its core sees the content, and
**outbound checks** on every action its core proposes before anything leaves. The checks are
run by ordinary code outside the core.

### 5.1 Verdicts and outcomes

Each check gives one verdict.

| Verdict | Meaning |
|---|---|
| `pass` | The check's question is answered yes, with support |
| `fail` | The question is answered no |
| `ask-more` | Inbound only. The question could be answered yes if the sender supplied something more |
| `ask-principal` | Outbound only. The action is allowed only with the principal's approval |
| `indeterminate` | The question could not be decided: a term was not understood, a lookup failed, a required fact was missing |
| `not-applicable` | The question does not arise for this message or action, and the check says why |

A run of inbound checks ends in one of three outcomes: **admit**, **ask for more**, or
**refuse**. A run of outbound checks ends in one of three outcomes: **go**, **ask the
principal**, or **stop**.

- **CORE-C-1.** Checks MUST run in the order given in sections 5.2 and 5.3. A later check
  MUST NOT run on a message whose integrity check did not pass.
- **CORE-C-2.** The outcome is admit, or go, only when every check gave `pass` or
  `not-applicable`.
- **CORE-C-3.** `indeterminate` MUST NOT be treated as `pass`. Inbound, an indeterminate
  verdict leads to ask for more when the sender could resolve it and to refuse otherwise.
  Outbound, it leads to stop, or to ask the principal when the mandate allows the principal
  to decide such cases.
- **CORE-C-4.** A `not-applicable` verdict MUST carry a reason. A check MUST NOT be skipped
  silently.
- **CORE-C-5.** Every verdict MUST carry a reason code from the registry in section 9 and
  MUST identify the rule that decided it, when a rule did.
- **CORE-C-6.** The checks MUST be implemented so that the core cannot change their inputs,
  their rules or their verdicts. The core has no access to signing keys.

### 5.2 Inbound checks

| # | Check | Question |
|---|---|---|
| 1 | Integrity | Is the message intact, in its time window, not seen before, meant for me, and whose key signed it? |
| 2 | Source | Do I accept this source for this kind of claim, for the task in hand? |
| 3 | Authority | Is the sending agent acting for who it says, and may that party deal with me in this context? |
| 4 | Terms | Can I keep the terms attached to this data, and are they compatible with what I need it for? |
| 5 | Fitness | Is this data good enough for the task: fresh enough, produced in an acceptable way, sure enough, and consistent with what I already hold? |

In the words of the W3C Verifiable Credentials Data Model, integrity is *verification*: is
this authentic and current. The other four are *validation*: does it meet this receiver's
rules. Deciding to accept an issuer is validation, not verification.

**Integrity.**

- **CORE-IN-1.** The receiver MUST verify the proof with key material obtained through the
  identity suite in force, and MUST NOT accept key material supplied only by the message
  itself.
- **CORE-IN-2.** The receiver MUST refuse a message outside its time window, a message whose
  identifier it has already seen with different content, and a message addressed to someone
  else.
- **CORE-IN-3.** A message that fails integrity MUST NOT be shown to the core, stored in
  memory, or answered in a way that reveals anything beyond a reason code.

**Source.**

- **CORE-IN-4.** For each claim the receiver intends to rely on, it MUST decide whether the
  claim's source is accepted as an authority for that kind of claim, about that subject, for
  the current purpose. The decision is made under the trust framework suite in force and the
  applicable domain profile.
- **CORE-IN-5.** Acceptance of a source for one kind of claim MUST NOT carry over to another
  kind. A bank accepted for balances is not thereby accepted for income.
- **CORE-IN-6.** When the decision rests on a lookup, the receiver MUST keep the path of the
  lookup with the decision: who was asked, what each said, and how fresh each answer was.

**Authority.**

- **CORE-IN-7.** When the sender acts for a principal, the receiver MUST verify the mandate or
  other statement of authority back to the principal who made it, MUST check that it covers
  the requested action, purpose and recipient, and MUST check its status under the delegated
  authority suite in force.
- **CORE-IN-8.** A receiver MAY require a stronger approval of the mandate for some actions
  than for others. When the approval presented is weaker than the receiver requires, the
  verdict is `ask-more`, and the receiver sends a `challenge` that states the level it needs.
- **CORE-IN-9.** A request made on no one's behalf, such as a public read, has an authority
  verdict of `not-applicable`, with that reason.

**Terms.**

- **CORE-IN-10.** The receiver MUST read the terms attached to incoming data before admitting
  it, MUST decide whether it can keep every prohibition and every duty, and MUST refuse or
  ask for different terms when it cannot. A term the receiver does not understand gives
  `indeterminate`.
- **CORE-IN-11.** When data that needs terms arrives with none, the receiver MUST apply the
  default set by the domain profile. When the profile sets none, the default is: use for the
  purpose of the current interaction only, no onward sharing, delete when that purpose ends.
- **CORE-IN-12.** Terms admitted with data MUST stay attached to that data in memory and to
  anything derived from it, under the propagation rules of the usage control suite in force
  (DER-22).

**Fitness.**

- **CORE-IN-13.** The receiver MUST decide whether each item is fit for the task, using the
  quality information in the message and its own rules: age, method of production, the
  source's stated confidence, and completeness.
- **CORE-IN-14.** When an admitted item conflicts with one already held, the receiver MUST
  apply a stated precedence rule, record which item prevails and why, and keep the other
  marked as superseded for that purpose. It MUST NOT silently overwrite.
- **CORE-IN-15.** A principal MAY state how sure they are of an item they supply and which
  kind of source should prevail over it. Receivers of such an item MUST keep that statement
  with it.

**After the checks.**

- **CORE-IN-16.** Only admitted content reaches the core, and it reaches the core labeled
  with its source, terms and quality.
- **CORE-IN-17.** Nothing enters the agent's memory except through the inbound checks.
- **CORE-IN-18.** An agent MUST limit the size of messages it will read and the rate at which
  it will accept them from one sender, and MUST refuse beyond those limits before doing any
  costly work.
- **CORE-IN-19.** Where no register covers a sender, a profile MAY let the principal decide.
  The gate then holds the message, shows none of it to the core, and asks the principal
  whether to add the sender's key to their own list. The request is built by the gate: the
  key, how the message arrived, and what the sender says it is. The record shows
  `source-unknown` and the question. A yes adds an entry limited to that party and purpose,
  with an expiry, and the message is checked again from the start. A no refuses it. An entry
  made this way is never treated as more than the principal's own word.
- **CORE-IN-20. A statement that fails, and the message that carried it.** A statement that
  fails the source or the fitness check is not admitted and stays out of memory, whatever
  happens to the rest of the message. When the operation the message belongs to needs a
  claim of that kind, and the sender could cure the failure with another statement (from a
  source the receiver accepts, made by an accepted method, fresher, or complete), the outcome
  for the message is ask for more: the receiver names the kind of claim and what it would
  accept, and gives the reason the statement failed. When nothing the sender could supply
  would cure it, the outcome is refuse. An action proposed later that depends on a claim
  that was not admitted MUST stop, with the reason that claim failed for.
- **CORE-IN-21. A message that lacks a claim its operation needs.** When the operation a
  message belongs to declares the kinds of claim it needs, the fitness check on the message
  MUST establish that each kind is covered: by a statement admitted from this message, or by
  one already held for this task about the same subject and still fit. Where a kind is not
  covered, the outcome for the message is ask for more, with the reason `evidence-missing`.
  The receiver names each kind that is missing and what it would accept. Statements in the
  message that passed stay admitted. The operation does not go ahead, and the core is not
  handed the message as a request to act on.

### 5.3 Outbound checks

An **action** is anything that has an effect outside the agent: sending a message, calling a
tool, changing who can read something, making a payment, accepting an offer.

| # | Check | Question |
|---|---|---|
| 1 | Mandate | Does the principal's mandate allow this action, for this purpose, with this party? |
| 2 | Recipient | Is the other side who it claims to be, and accepted for this? |
| 3 | Disclosure | Is this the least data that does the job? |
| 4 | Data terms | Do the terms on every item being sent allow this use and this recipient, and are the right terms attached for the receiver? |
| 5 | Limits and approval | Is the action within the limits on spend, rate and number of steps, and does it need the principal's approval? |
| 6 | Evidence | Is everything the receiver will need to check attached, and is the decision written to the record? |

- **CORE-OUT-1.** Every action the core proposes MUST pass the outbound checks. There MUST be
  no other way for the core to cause an effect outside the agent.
- **CORE-OUT-2.** The mandate check MUST evaluate the action as proposed, not as described by
  the core. An action the mandate does not allow gives `fail`. An action the mandate
  prohibits gives `fail` whatever else allows it.
- **CORE-OUT-2a. General permissions.** A permission for a general action grants the more
  specific actions it includes only where they have no effect outside the agent. An action
  that discloses data to another party, moves or pays money, accepts or makes an offer,
  deletes, or passes authority on MUST be permitted by name. A prohibition on a general
  action still prohibits every action it includes. The same reading applies to the terms
  attached to data: terms that permit use do not permit passing the data on.
- **CORE-OUT-3.** The recipient check MUST establish the recipient under the identity and
  trust framework suites in force, and MUST keep the lookup path as in CORE-IN-6. When the
  trust framework states what a recipient is registered to ask for, the check MUST also
  establish that the data requested is within that registration.
- **CORE-OUT-4.** The disclosure check MUST compare what is to be sent with what the purpose
  needs, and MUST prefer, among the ways the configuration allows and the recipient accepts,
  the one that reveals least: a derived statement before the statements it came from, and
  among derived statements the one that shows the fewest parties the least (DER-21).
- **CORE-OUT-5.** The data terms check MUST evaluate the terms attached to each item to be
  sent, including items derived from data received from others, and MUST attach to the
  outgoing message terms at least as strict as those the sender is itself bound by.
- **CORE-OUT-6.** An agent MUST enforce limits on spend, on the rate of actions and on the
  number of steps in one task. Loops of asking for more MUST be bounded.
- **CORE-OUT-7.** When an action needs the principal's approval, the request shown to the
  principal MUST be produced by the checking code from the action and the rule that requires
  approval. It MUST NOT be text written by the core. The approval MUST be bound to the exact
  action by digest, MUST expire, and MUST be usable once.
- **CORE-OUT-8.** A receiver of an action MAY ask for a stronger form of approval than the one
  presented. The agent then asks the principal to approve in that form, as an ordinary
  request for approval.
- **CORE-OUT-9.** The evidence check MUST write the decision to the record before the action
  is taken, and the result after. If the record cannot be written, the action MUST NOT be
  taken.
- **CORE-OUT-10.** The principal MUST be able to stop the agent. A stopped agent takes no
  action, and says so in its record.
- **CORE-OUT-11.** A claim sent to another party MUST carry its quality information. A claim
  that was derived, estimated or reported by the principal MUST NOT be presented as a
  first-hand statement from an authority.
- **CORE-OUT-12.** Sending a message is itself an action. The recipient, disclosure and
  evidence checks MUST run on every message that leaves, whether or not it asks for
  anything. The disclosure and data terms checks may give `not-applicable` only when the
  gate itself has established that the message carries no data of the principal's, not
  because the core says so. Free text written by the core is treated as in UNS-8 to UNS-13.
- **CORE-OUT-13.** A read that contacts another party is a message to that party. Fetching a
  page, querying a provider and following a link all pass the recipient and disclosure
  checks. A request to a party that is not established MAY go only when it carries nothing
  of the principal's, including in its address, and what comes back is content, not
  instruction.
- **CORE-OUT-14.** A grant in a mandate covers an action only as far as it names it: the
  kind of action, its object, its counterparty, its amount and the data it carries. Whatever
  a grant leaves unnamed is not granted by it. "May delete files" does not follow from "may
  delete this file", and "may write to this person" does not cover everything that could be
  written.

### 5.4 Status and freshness

- **CORE-S-1.** Mandates, credentials, register entries and agreements can be withdrawn. A
  suite that defines one of these MUST define how its status is checked and how fresh a
  status answer must be.
- **CORE-S-2.** A cached decision MUST NOT outlive the expiry, withdrawal or change of
  anything it rested on. Before an action with lasting effect, mutable conditions MUST be
  checked again.
- **CORE-S-3.** An agent can pass on only authority it holds, and only as narrow as or
  narrower than it holds it. A chain of delegation MUST name each link, so that a receiver
  can see who acted for whom. An agent MUST NOT act as its principal; it acts for them.

## 6. What an agent keeps

An agent keeps four kinds of thing. They need not be four databases, and some are not held
locally at all.

**Policies.** The mandate, the principal's own rules, and agreements made with other parties.

**Memory.** Facts the agent has admitted or been given by its principal. Every fact carries
its source, the time it was obtained, its terms, its quality information, and, when it was
derived, what it was derived from.

**Trust lookup.** How the agent finds out who is accepted for what. This is not one list. It
starts with the principal's own list: people and services the principal has chosen, each for
named tasks. For everyone else, the agent asks: a lookup starts at a root the principal
accepts and follows delegations to the register that can answer, in the way a name lookup
follows the domain name system. The trust framework layer defines how. The agent also keeps
the rules for which kind of source is an authority for which kind of claim; these usually
come from a domain profile.

**Record.** Section 7.

- **CORE-K-1.** Entries in the principal's own list MUST be scoped to tasks or kinds of claim.
  An unscoped entry MUST NOT be read as trust for everything.
- **CORE-K-2.** An answer obtained by lookup MUST be verified like any other message, MUST
  carry its own expiry, and MUST be kept with the path that produced it.
- **CORE-K-3.** A principal MAY block a party in their own list. A block prevails over any
  register.
- **CORE-K-4.** An agent that acts for more than one principal MUST keep each principal's
  memory, policies and record apart.
- **CORE-K-5.** The checks MUST NOT depend on any rule staying secret from the core or from
  the other party. Secrets, such as keys, are kept out of the core's reach altogether.

## 7. The record

- **CORE-R-1.** The agent MUST write one entry for every check it runs, every outcome, every
  request to its principal and the reply, every action taken and every result observed.
- **CORE-R-2.** Each entry MUST state the time, the message or action it concerns by
  identifier and digest, the check, the verdict, the reason code, the rule applied, and the
  configuration in force.
- **CORE-R-3.** The record MUST be append-only and MUST make later alteration detectable, for
  example by chaining each entry to the one before it.
- **CORE-R-4.** The integrity of a record shows that its entries were not changed. It does
  not show that nothing was left out. A claim of completeness needs a suite in the
  accountability layer that supports it.
- **CORE-R-5.** The record MUST hold enough for a third party, given the same rules and
  inputs, to reach the same verdicts.
- **CORE-R-6.** The record itself holds personal data. The accountability suite in force MUST
  say who may read it, for how long it is kept, and what is kept after the underlying data
  has been deleted.

## 8. Layers, suites and configurations

### 8.1 The eleven layers

| Layer | Question |
|---|---|
| Transport | How does a message get there? |
| Data access | How does the content get there? |
| Identity | What names a party, and how is its key found? |
| 1. Shared meaning | Do both sides read the terms the same way? |
| 2. Delegated authority | May this agent do this for this person? |
| 3. Authenticity | Is this statement really from its source? |
| 4. Trust framework | Why should I accept this party or source at all? |
| 4b. Reliance | How far should I rely on this, for this task? |
| 5. Usage control | What may be done with the data, and who enforces it? |
| 6. Commitments | What was agreed, and is it binding? |
| 7. Accountability and redress | What happens when something goes wrong? |

### 8.2 Suites

- **CORE-L-1.** A suite MUST have a stable identifier and a version, MUST name the layer it
  belongs to, and MUST define everything that layer's document requires of a suite.
- **CORE-L-2.** A suite MUST state what it depends on in other layers and which combinations
  it does not support. Support for two suites in different layers does not imply support for
  them together.
- **CORE-L-3.** A suite MUST state what it protects and what it does not, what it reveals to
  whom, and what it assumes.
- **CORE-L-4.** A suite MUST state how each failure it can meet maps to a verdict and a reason
  code. A suite that cannot perform a required protection MUST fail; it MUST NOT fall back to
  a weaker one without the configuration saying so.
- **CORE-L-5.** A suite is registered only when at least one trace shows it running, as set
  out in the conformance document.

### 8.3 Configurations

- **CORE-L-6.** A configuration names exactly one suite for each of the eleven layers, or marks a
  layer "not applicable" with a reason, and fixes any parameters the suites leave open. A
  configuration with any layer unresolved MUST NOT be used.
- **CORE-L-7.** A configuration has an identifier. Messages name it (CORE-M-3).
- **CORE-L-8.** Changing the transport suite or the data access suite MUST NOT change the
  verdict of any check other than through the data actually disclosed. A transport is
  carriage; nothing is trusted because of how it arrived.

### 8.4 Describing and choosing

- **CORE-L-9.** An agent MUST be able to describe itself: the configurations it implements,
  the ones it accepts, and the operations it offers. Implementing a configuration and
  accepting it are different; an agent MAY accept fewer than it implements.
- **CORE-L-10.** A description is a claim. It MUST be verified like any other message before
  it is relied on, and it grants nothing.
- **CORE-L-11.** Two agents choose a configuration both accept. Each side's acceptance policy
  decides; the weakest shared option is not automatically acceptable. The choice MUST be
  bound into the messages that follow, so that neither side can later be moved to a weaker
  one unnoticed.
- **CORE-L-12.** An implementation SHOULD implement the baseline configuration, so that any
  two implementations have one configuration in common.
- **CORE-L-13.** An agent MUST have a signed statement of what it runs: its configurations,
  the tools its core can call, and the model or program that is its core. Record entries
  MUST name the statement in force. A tool that is not in the statement MUST NOT be callable.

## 9. Reason codes

A reason code explains a verdict. It never grants anything. The core registry follows; a
profile MAY add codes.

| Group | Codes |
|---|---|
| Integrity | `malformed`, `bounds-exceeded`, `unsigned-not-allowed`, `unknown-key`, `bad-signature`, `configuration-mismatch`, `sender-key-mismatch`, `wrong-audience`, `expired`, `not-yet-valid`, `lifetime-too-long`, `replay-conflict` |
| Interaction | `unsupported-configuration`, `unsupported-operation`, `unsupported-kind`, `unsupported-term`, `protocol-violation`, `terms-digest-mismatch`, `round-limit`, `conversation-closed` |
| Source | `source-accepted`, `source-not-authoritative`, `source-unknown`, `lookup-failed`, `status-withdrawn`, `rule-not-accepted`, `deriver-not-accepted` |
| Authority | `representation-missing`, `representation-invalid`, `representation-expired`, `representation-out-of-scope`, `mandate-invalid`, `mandate-withdrawn`, `assurance-insufficient` |
| Policy | `not-authorised`, `prohibited`, `purpose-not-permitted`, `insufficient-scope`, `missing-context`, `indeterminate-policy`, `terms-not-acceptable`, `no-agreement` |
| Fitness | `stale-data`, `method-not-accepted`, `confidence-too-low`, `superseded-by-better-source`, `partial-result`, `completeness-not-established`, `structured-form-required` |
| Disclosure | `excessive-scope`, `minimal-disclosure`, `form-not-available`, `rule-unbounded`, `context-not-clear` |
| Limits | `approval-required`, `approval-denied`, `limit-exceeded`, `budget-exceeded`, `stopped-by-principal` |
| Evidence | `evidence-invalid`, `evidence-missing`, `record-unavailable`, `derivation-not-verified` |
| Execution | `execution-failed`, `result-uncertain` |
| Pass | `intact`, `source-accepted`, `authority-valid`, `terms-acceptable`, `fit-for-use`, `within-mandate`, `recipient-established`, `minimal-disclosure`, `terms-allow`, `within-limits`, `approval-given`, `evidence-complete`, `established-earlier` |
| Not applicable | `no-action`, `no-claims`, `no-principal`, `no-data`, `no-personal-data` |

A `pass` verdict carries a code from the Pass group, so that CORE-C-5 holds for every
verdict. The codes in the last group are the only ones a `not-applicable` verdict can carry
(CORE-C-4): the message proposes no action; it carries no claim to rely on; it is made on no
one's behalf; it carries no data that needs terms; it carries no personal data. A check is
never not applicable because of the configuration: every configuration answers every check.
A check whose answer was established earlier in the same conversation gives `pass` and names
the earlier entry, subject to CORE-S-2.

- **CORE-X-1.** A reason code sent to another party MUST NOT reveal more than that party needs
  to act on it. The full reason stays in the sender's record.

## 10. Security and privacy considerations

This section is not normative. The requirements document maps the design to published lists
of risks.

The design assumes that the core can be deceived. It therefore gives the core no keys and no
direct way to act, and it puts every decision that matters in code the core cannot change. Code the core writes or
runs stays inside the core's own boundary: it has no keys, and its only way to cause an
effect is to propose an action.
What remains is the quality of the rules and of the inputs to them: a mandate that allows too
much, a register that lists a bad actor, a profile that accepts a weak source. Those are
governance questions, and the layers make them visible instead of hiding them in a model.

A verifiable message links its parts together, and a record links messages to decisions. Both
create data about people. Suites are required to say what they reveal and to whom (CORE-L-3),
and the record's retention and access are required to be stated (CORE-R-6). Forms of content
that reveal less are preferred when available (CORE-OUT-4).

## 11. Conformance

An implementation conforms to a configuration when, for each scenario the conformance
document requires for that configuration, its trace matches the expected outline: the same
checks, in the same order, with the same verdicts and reason codes. Conformance to the core
alone is not claimed; it is always conformance to the core under a named configuration.
