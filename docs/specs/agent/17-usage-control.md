<!-- AUTHORED-BY Claude Fable 5.2 -->
# Usage control

Draft 0.4, 13 November 2026. Layer 5 of the paper's seven gaps.

**Question: what may be done with the data, and who enforces it?**

## What this layer decides

Access control answers "may this party see this". Usage control answers what happens after
that: what the party may do with what it has seen, for how long, and whom it may pass it to.
A bank that gives Sam's agent a balance for a mortgage application does not thereby agree to
the balance being sold to a broker.

A usage control suite says how such terms are written, how they travel with the data, how a
decision is reached from them, and who is in a position to enforce the decision. Terms of use
are attached in both directions: by the party that supplies data, and by the principal when
their agent sends data on.

Nothing in this layer makes misuse impossible. A party that holds data can misuse it. What
the layer provides is that the terms are known, that each honest agent enforces them in code
at its own gates, and that a breach leaves evidence. Whether a breach has consequences is the
accountability layer's question.

## What a usage control suite must define

- **UC-1. The language.** The policy language, the subset of it that is supported, and the
  exact meaning of each action and constraint in that subset. A term outside the subset is
  `indeterminate` (`unsupported-term`), never ignored (SM-3).
- **UC-2. Attachment.** How terms are bound to the data they govern, so that neither can be
  swapped. In the baseline the terms part names the content by digest and both are covered
  by the message proof.
- **UC-3. Staying attached.** How terms stay with data in memory, and how they apply to data
  derived from it (CORE-IN-12). A fact derived from several inputs carries the terms of all
  of them.
- **UC-4. Decision.** How a decision is reached, with at least three outcomes: permitted,
  prohibited, and not decided. Not decided is never treated as permitted (CORE-C-3).
- **UC-5. Who decides.** Which parts of the decision are made by rules in code, which may
  involve a model, and which need a person. Nothing a model says may make the decision more
  permissive than the rules alone.
- **UC-6. Who enforces.** Where the decision is enforced: at the receiver's own gates, at the
  place the data is stored, or both.
- **UC-7. Duties.** How obligations are expressed and discharged, such as "delete after 90
  days" or "tell me if you pass this on", and how discharge is evidenced.
- **UC-8. Default terms.** The terms a receiver applies when data that needs terms arrives
  with none (CORE-IN-11). The default MUST be at least as strict as "use for the purpose of
  this exchange only, do not pass on".
- **UC-9. Conflict.** What happens when the supplier's terms and the receiver's own rules
  disagree. The stricter prevails; if the receiver cannot work under the stricter, it does
  not admit the data.

## Which checks draw on it

Inbound terms: can I accept these terms. Outbound mandate: does my principal's own policy
allow this. Outbound disclosure and data terms: do the terms on each item allow sending it
to this recipient for this purpose.

## Suites

| Suite | Name | Status | Builds on | Maturity of what it builds on |
|---|---|---|---|---|
| `odrl-rules` | ODRL terms, rules only | Baseline | ODRL 2.2, a stated subset, three-valued evaluation | Standard |
| `odrl-model-tighten` | Rules, and a model that may tighten | Sketch | ODRL 2.2 plus a model that can only narrow | Research |
| `human-approval` | Human approval | Defined | ODRL 2.2 plus approvals bound to the exact action | This work |
| `solid-access-control` | Solid access control | Sketch | Web Access Control or Access Control Policy; Linked Web Storage access grants | Community draft |

### `odrl-rules`

Terms are ODRL policies. The supported subset is small on purpose:

| Element | Supported |
|---|---|
| Rules | permission, prohibition, duty |
| Actions | `use`, `read`, `store`, `derive`, `share` (pass to a named party or kind of party), `aggregate` |
| Constraints | purpose, recipient or kind of recipient, date and time, elapsed time, count |
| Duties | delete by a date, inform the assigner on sharing |

Evaluation is in code and gives one of three answers.

- Prohibitions are evaluated first. A matching prohibition gives prohibited.
- Otherwise a matching permission whose constraints are all met gives permitted.
- Otherwise the answer is not decided. A constraint whose value is not known, such as a
  purpose that was not stated, gives not decided with `missing-context`.

Not decided leads to `ask-principal` at the outbound gate when the mandate allows asking, and
otherwise to stop. At the inbound gate it leads to refusal with `terms-not-acceptable`.

Purposes are terms from the vocabulary named by the shared meaning suite. A purpose is
matched as written or through a stated narrower-than relation; it is never matched by
resemblance.

The assigner of a policy is the party whose data it is or who supplied it. The assignee is
the receiver. An ODRL Offer becomes an Agreement when the commitments suite records its
acceptance.

**Example.** Harbour Bank's balance statement arrives with terms: permission to `use` for
the purpose `mortgage-application`, permission to `share` with a regulated lender for that
purpose, duty to delete within 90 days, prohibition on `share` for marketing. Sam's agent
admits it. Later the core proposes including the balance in a request for an insurance
quote. The data terms check finds no permission for that purpose: not decided, so the
action stops, and the record shows which term was missing.

### `odrl-model-tighten`

As `odrl-rules`, and a model reads the context to catch what rules miss, such as a request
whose stated purpose does not match what is being asked for. The model's output can change
permitted to not decided or to prohibited. It can never change an answer in the other
direction, and this is enforced by the order of evaluation: the rules run first and the
model is only consulted on a permitted answer. The model's view and its reason are recorded
as an input to the decision, marked as a model's opinion. Sketch only.

### `human-approval`

As `odrl-rules`, and every use the rules leave not decided goes to a person. The approval
is bound to the exact action: its digest, the recipient, the purpose and an expiry. An
approval for one action does not carry over to another that looks similar. The request the
person sees is built by the gate from the action itself (CORE-OUT-7).

This suite is the safest and the slowest, and it wears people down if overused. A profile
that adopts it should say which decisions are expected to reach a person, and the mandate
should cover the routine ones.

### `solid-access-control`

The data stays in a pod and the terms are translated into access rules on it: who can read
which resource until when. The translation MUST NOT grant more than the mandate and the
terms allow, and the translated rules name the policy they came from. Enforcement is then
at the pod, which refuses a read that the rules do not allow, as well as at the agent's
gate. Access rules express less than ODRL: they can say who may read, and they cannot say
what the reader may do next. The remainder still travels as terms. Sketch only.

## Open questions

- A standard way to evidence that a duty was discharged, such as proof of deletion.
- Whether purposes need a shared vocabulary across sectors or one per sector profile.
- Enforcement inside the receiver, for instance by confidential computing. Out of scope
  here; a suite could add it without changing the checks.
