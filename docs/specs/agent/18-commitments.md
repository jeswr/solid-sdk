<!-- AUTHORED-BY Claude Fable 5.2 -->
# Commitments

Draft 0.4, 13 November 2026. Layer 6 of the paper's seven gaps.

**Question: what was agreed, and is it binding?**

## What this layer decides

Agents exchange many messages that commit no one: questions, descriptions, product records,
quotes "subject to checks". At some point one message does commit someone. A commitments
suite says how that point is marked, what exactly is agreed, who is bound, and what each
side holds afterwards to show it.

The suite does not decide whether a court would enforce the agreement. That depends on the
law that applies. It does make sure the facts a court or an ombudsman would ask for exist
and can be checked: the exact terms, who offered, who accepted, on whose authority, and
when.

## What a commitments suite must define

- **CM-1. What is not a commitment.** Which message kinds never bind. A description, a
  product record and an indicative quote MUST be marked as not binding, and a receiver MUST
  NOT treat them as offers.
- **CM-2. The offer.** What an offer contains: the terms in full, who makes it, to whom, and
  until when it can be accepted.
- **CM-3. The terms digest.** How the exact terms are identified, so that both sides can be
  shown to have agreed to the same thing (CORE-M-7).
- **CM-4. The acceptance.** How acceptance refers to the offer, who can accept, and what
  authority the acceptance carries with it. Acceptance of terms that differ from the offer
  in any way is a new offer.
- **CM-5. Approval.** Which commitments need the principal's own approval, and how that
  approval is bound to the terms digest (CORE-OUT-7).
- **CM-6. When it takes effect.** The moment from which both are bound, and what each side
  must hold at that moment.
- **CM-7. Change and withdrawal.** How an offer is withdrawn before acceptance, how an
  agreement is changed or ended afterwards, and how that is recorded. Any cooling-off right
  the law gives is stated in the terms.
- **CM-8. Performance.** How steps taken under the agreement refer to it, and how completion
  is acknowledged.
- **CM-9. Who is bound.** That the agent binds its principal within its mandate and only
  within it. An acceptance outside the mandate does not bind the principal, and the
  accountability layer says who answers for it.

## Which checks draw on it

Outbound limits and approval, for making an offer or accepting one. Inbound authority, for
checking that an acceptance was made with authority to commit. Outbound evidence, for the
record of what was agreed.

## Suites

| Suite | Name | Status | Builds on | Maturity of what it builds on |
|---|---|---|---|---|
| `signed-offer-acceptance` | Signed offer and acceptance | Baseline | ODRL Offer and Agreement; JWS over the terms digest | Standard |
| `agreement-credential` | Agreement credential | Defined | Verifiable Credentials 2.0 with two proofs | Standard |
| `payment` | Offer, acceptance and payment | Sketch | Agent Payments Protocol mandates; payment scheme rules | Industry specification |

### `signed-offer-acceptance`

Two messages make an agreement.

1. **`propose`** carries the offer: the terms in full as an ODRL Offer, the offeror, the
   offeree, and the time until which it stands. The offeror's proof covers it.
2. **`accept`** names the offer by the digest of its terms, and carries the accepting
   agent's mandate with the approval statement that covers this commitment. The acceptor's
   proof covers it.

From the moment the offeror admits the `accept`, both are bound. Each side holds both signed
messages, and each can show the agreement to a third party without the other's help. The
offeror answers the `accept` with a `receipt` so that the acceptor knows it arrived.

- An `accept` whose digest does not match the offer is refused with `terms-digest-mismatch`.
- An `accept` after the offer's time is refused with `expired`.
- An agent MUST NOT send an `accept` for a commitment its mandate marks as needing approval
  until the principal has approved the terms by digest. The approval request shows the terms
  themselves, in words the gate builds from them.
- A change after agreement is a new `propose` that names the agreement it replaces, and
  takes effect only on a new `accept`.
- Every later message under the agreement names it by digest.

**Example.** North Bank sends an offer: a loan of 380,000 at 4.6 percent fixed for five
years, a fee of 995, valid for 14 days. Sam's mandate says any credit agreement needs Sam's
approval. The outbound gate asks Sam, showing the amount, rate, term, fee and the lender's
name as established by lookup. Sam approves with a passkey. The agent sends `accept` with
the digest of those terms. If the offer had carried a fee the product record did not
mention, the gate would have shown the difference, because it compares the offer with the
record the agent admitted earlier.

### `agreement-credential`

The agreement is one document: a verifiable credential whose subject is the terms, carrying
a proof from each party. It is easier to store, to show and to check than a pair of
messages, and it can carry a status entry so that either side can see whether it has been
ended. It needs an authenticity suite that allows more than one proof on a document.

### `payment`

As the baseline, and the agreement is settled by a payment. Payment adds three things.

- **Its own approval.** A payment is approved by the principal against stated limits: the
  payee, the amount or a ceiling, the currency and the time. A mandate can open with
  constraints, such as "up to 50 for groceries this week", and close with the final amount.
- **Its own evidence.** The payment scheme's confirmation is admitted through the inbound
  checks like any other statement, with the scheme or the payment provider as its source.
- **Its own rules.** Refunds, disputes and reversals follow the payment scheme. The suite
  records the scheme's reference with the agreement so the two can be tied together.

An agent never holds a payment credential that can be used outside the gate. The gate, or a
payment provider acting on the gate's signed instruction, makes the payment. Sketch only.

## Open questions

- Lining up the offer and acceptance messages with existing contract formation rules in the
  main jurisdictions, including notices a consumer must be given before being bound.
- Agreements among more than two parties.
- Whether an agent's acceptance should always name the person who approved it, or only show
  that an approval of the required strength exists.
