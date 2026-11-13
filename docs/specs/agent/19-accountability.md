<!-- AUTHORED-BY Claude Fable 5.2 -->
# Accountability and redress

Draft 0.5, 13 November 2026. Layer 7 of the paper's seven gaps.

**Question: what happens when something goes wrong?**

## What this layer decides

Every other layer tries to stop a wrong thing happening. This one assumes it has happened:
an agent accepted terms it should not have, a lender relied on a statement that was false, a
payment went to the wrong party. An accountability suite says what record exists, who can
see it, who answers, and where the wronged party goes.

It has two halves. The record is technical: what each agent wrote down, and how anyone can
tell it was not changed afterwards. Redress is institutional: who carries the loss, who
hears a complaint, what they can order. A specification can define the first and can only
connect to the second. The suites below differ mainly in the route to redress.

The core's default position on who answers follows the paper: a person or organization that
delegates an act to an agent answers for that act as if they had done it themselves, within
the mandate they gave. When the agent acted outside the mandate, the question moves to
whoever built or operated it. The record is what shows which case applies.

## What an accountability suite must define

- **AC-1. The record.** What is recorded beyond the core's minimum (CORE-R-1, CORE-R-2), and
  the form of an entry.
- **AC-2. Integrity of the record.** How later alteration is made detectable (CORE-R-3), and
  what that does and does not show (CORE-R-4): an intact record shows entries were not
  changed, not that they were true when written.
- **AC-3. Where it is kept.** Who holds the record, who else holds a copy or a commitment to
  it, and what happens to it if the agent's operator disappears.
- **AC-4. Access.** Who can read which entries, on what grounds, and how the principal can
  read their own. The record holds personal data (CORE-R-6): retention, access and deletion
  are stated.
- **AC-5. Reconstruction.** How a third party, given the record, the rules in force and the
  messages, re-runs a decision and reaches the same verdicts (CORE-R-5).
- **AC-6. Who answers.** The rule for who answers for an act, in terms of what the record
  shows: within the mandate, outside it, or the mandate itself obtained by deception.
- **AC-7. The route.** Where a wronged party takes a claim, what it files, and what the
  other side must then produce.
- **AC-8. Signals.** Whether an outcome is published or scored, who may do so, and how the
  party it concerns can answer.
- **AC-9. Stopping.** How a principal, an operator or an authority stops an agent, and how
  that is recorded (CORE-OUT-10).

## Which checks draw on it

Outbound evidence, which writes the decision before the action goes out (CORE-OUT-9). Every
check, in that each verdict becomes an entry.

## Suites

Every suite in this layer includes the baseline record. They differ in where the record is
also kept and in the route to redress.

| Suite | Name | Status | Builds on | Maturity of what it builds on |
|---|---|---|---|---|
| `local-ledger` | Signed ledger on each side | Baseline | Hash-chained signed entries | This work |
| `pod-mirror` | Record mirrored to a pod | Defined | Solid or Linked Web Storage | Community draft |
| `regulator-claim` | Claim to a regulator | Defined | Sector complaint routes; logging and oversight duties in the EU AI Act | This work |
| `vendor-fault` | Fault passed to the vendor | Sketch | Product liability and contract terms | This work |
| `reputation-post` | Public reputation | Sketch | | Research |
| `reputation-score` | Reputation score | Sketch | | Research |

### `local-ledger`

Each agent keeps its own record. An entry holds: a sequence number, the time, the message
or action it concerns by digest, the check, the verdict, the reason code, the clause
applied, the inputs by reference (rule version, lookup path, key used, statement of what
the agent runs), and the digest of the entry before it. Entries are signed by the gate's
key, which the core cannot use.

Chaining makes a removed or altered entry detectable to anyone who holds a later digest.
The agent therefore gives the latest digest of its record to the other party in each
`receipt`, so that each side holds a commitment to the other's record as of that moment.

When what was sent was a derived statement, the entry holds the derivation record, and the
sender's own record also refers to the inputs. A party that relied on a proof or a joint
result it could not see into can ask a forum to have the derivation opened (DER-29). The
commitments in the record let the forum check that the inputs shown are the inputs used.

**Redress under this suite** is between the two parties. Each can show its own signed
messages and its own record. Because both hold the other's signed messages, neither can
deny what it sent. If they cannot settle it, the record is what each takes to whatever
forum the law gives them. The suite adds no forum of its own.

**Example.** Sam finds a fee on the first statement that was not in the terms Sam approved.
Sam's record holds the offer as admitted, the terms digest Sam approved, and North Bank's
receipt for the acceptance carrying that digest. The fee is not in those terms. Sam does
not need North Bank's cooperation to show this.

### `pod-mirror`

As the baseline, and each entry is also written to a pod the principal controls, at a
provider that is separate from the agent's operator. The principal can read their record
without the operator, move it, and keep it if they change agents. The pod's own access
rules decide who else can read it. Entries are written to the pod before the action they
concern goes out; if the pod cannot be reached, the evidence check gives `indeterminate`
with `record-unavailable` and the action waits.

### `regulator-claim`

As the baseline, and a route: a wronged party files a claim with the body that oversees the
other party, found through the trust framework lookup (the register that lists a lender
also names who regulates it).

- A claim is a verifiable message of kind `propose` to the regulator's endpoint. It names
  the agreement or the messages concerned by digest and attaches the claimant's record
  entries for them.
- The regulator's agent can require the other party to produce its entries for the same
  digests. A party that conforms to this suite MUST produce them, and the chain commitments
  exchanged in receipts let the regulator see whether anything was withheld.
- The person or organization that delegated the act answers for it (AC-6). It is no answer
  that an agent did it.
- The regulator's decision is itself a signed statement, which both parties' agents admit
  like any other.

This suite is the one that fits regulated sectors, where a complaints body or ombudsman
already exists. The suite carries the evidence to that body in a form it can check. It does
not change what the body can order.

### `vendor-fault`

As the baseline, and a rule for the case where the record shows the agent acted outside its
mandate or against a check. The signed statement of what the agent runs (CORE-L-13) names
who built and who operates the gate and the core. The principal's claim then goes to that
party under their contract or under product liability law. The suite defines what the
record must show for this: the mandate in force, the action taken, and that the gate let
through something the mandate did not allow, or that the gate was bypassed. Sketch only.

### `reputation-post`

As the baseline, and a wronged party's agent can publish a statement of what happened, with
the evidence a reader needs to check it: the signed messages concerned, by the claimant's
choice and within the terms that govern them. A post is a claim like any other, and a
reader's agent runs its own inbound checks on it. The party it concerns has a right of
reply attached to the same post. Posts about individuals are out of scope. Sketch only.

### `reputation-score`

As the baseline, and a rating service scores how each party's agents behave, sector by
sector, from evidence submitted to it. A score feeds the trust framework layer's
`reputation` suite. The suite would have to define what evidence counts, how a party
contests a score, and how the service is itself held to account. Sketch only.

## How this lines up with law

Not normative, and not legal advice. Article numbers should be checked against the text in
force before anything is built on them.

- **Record keeping.** The EU AI Act requires high-risk systems to keep logs automatically
  and deployers to keep them for a period. The record in this layer is that log, per
  decision, in a form a third party can check.
- **Human oversight.** The Act requires that a person can oversee and stop a high-risk
  system. CORE-OUT-7 (approval built by the gate) and CORE-OUT-10 (stop) are the hooks.
- **Telling people they are dealing with a machine.** The Act's transparency duties are met
  by CORE-M-10.
- **Automated decisions about people.** Data protection law gives a person rights where a
  decision with legal effect is made about them by automated means. A lender's agent that
  refuses an application falls under this; the record supports the explanation and review
  such law requires.
- **Signatures and seals.** Whether an approval or an acceptance counts as a signature in
  law depends on the level used. The approval levels in the delegated authority layer are
  meant to map onto national schemes, and that mapping is an open question there.
- **Liability.** Who carries a loss is settled by contract, sector rules and the general
  law. The paper's position, that the delegating party answers within the mandate, is the
  default this layer records evidence for. It is not something a specification can impose.

## Open questions

- A common export format for records, so that a regulator can read any agent's.
- How long to keep a record, when the data in it is personal and the reason to keep it is
  to be able to answer a claim years later.
- Whether chain commitments should also go to a neutral transparency service, so that a
  party cannot keep two records.
- What a person can do when the other side's agent is not accountable at all: no register
  entry, no record. The baseline answer is that their own gate refuses to commit to such a
  party, which the recipient check enforces.
