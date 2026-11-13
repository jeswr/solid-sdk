<!-- AUTHORED-BY Claude Fable 5.2 -->
# Commitments

Draft 0.6, 13 November 2026. Layer 6 of the paper's seven gaps.

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

## Payment

A payment is a contract: money in return for a service. It is the plainest commitment an
agent makes for a person, and the one most often made today with nothing to show what was
offered or that the person agreed. Under every suite in this layer:

> A payment settles an agreement. An agent may pay only what a signed offer, accepted with
> authority, says is due, to the party that offer names, once.

So a payment is never a message kind of its own. It is a step of performance (CM-8) under
an agreement made by one of the suites above, and it adds requirements of its own.

- **CM-10. Nothing is paid without an agreement.** The order to pay names an agreement the
  agent holds, with both proofs verified, in effect and not past its time
  (`no-agreement`, `expired`). A sentence in a message is not an agreement, however it is
  worded.
- **CM-11. The amount and the payee are the agreement's.** The amount and currency equal
  what the agreement says is due (`amount-differs`). The payee is the party the agreement
  names (`payee-differs`), and the account or address paid is bound to that party by a
  source the agent accepts for that (`source-not-authoritative`). An account taken from an
  invoice, an email or a web page is never enough.
- **CM-12. Within the mandate, and approved where it says so.** The mandate permits paying
  for this purpose, within its limit for one payment and its limit for a period
  (`not-authorised`, `limit-exceeded`). Where it requires approval, the person approves
  these terms: the request is built by the gate from the agreement and names the service,
  the payee as established by lookup, the amount and the limit that applies. The approval
  is bound to the terms digest and to the order.
- **CM-13. Once.** An amount due is ordered once. The order carries a key derived from
  the terms digest and the instalment, and a second order with the same key is refused
  (`replay-conflict`).
- **CM-14. What leaves can pay this and nothing else.** The instruction that leaves the
  gate is usable for this payee, this amount and this currency, until a stated time. The
  part of the agent that thinks never holds anything that can pay.
- **CM-15. The receipt is evidence.** The payment provider's confirmation is a statement
  admitted through the inbound checks, with the provider as its source. It must name the
  same agreement, payee, amount and currency as the order (`receipt-mismatch`), and it is
  recorded beside the agreement.

Refunds, disputes and reversals follow the rules of the payment scheme used. The scheme's
reference is recorded with the agreement so that the two can be tied together.

### Settlement suites

How the payment is expressed and carried is a choice of its own, made at the point of
payment. A configuration names one settlement suite beside its commitments suite. Whatever
is chosen, the suite lifts its own objects to the same terms, and CM-10 to CM-15 are
checked on those terms. A protocol that cannot supply a fact a check needs is not thereby
excused: the suite says where that fact comes from instead.

| Suite | Name | Status | Builds on | Maturity of what it builds on |
|---|---|---|---|---|
| `rdf-order` | Described in RDF | Baseline | ODRL `compensate` duties; schema.org `Invoice` and `PayAction` | Standard |
| `x402` | x402 | Defined | x402 version 2, scheme `exact` with EIP-3009 | Industry specification |
| `mpp` | Machine Payments Protocol | Defined | The "Payment" HTTP authentication scheme, draft 01; intent `charge` | Internet draft |
| `ap2` | Agent Payments Protocol | Defined | AP2 version 0.2 checkout and payment mandates | Industry specification |
| `acp` | Agentic Commerce Protocol | Defined | ACP version 2026-04-17 checkout sessions and delegated payment | Industry specification |

The terms every suite lifts to:

| Fact | Terms |
|---|---|
| What is offered and what it costs | An ODRL Offer with a permission for the service and a duty to `compensate`: the amount, its unit, and the party to be paid |
| That it was agreed | An ODRL Agreement, named by its terms digest, with the proofs of both sides |
| The request for payment | A schema.org `Invoice`: total due, due date, the agreement it is for |
| The order to pay | A schema.org `PayAction`: payer, payee, price, currency, the invoice, the agreement settled, the payee's account, the once-only key, a time limit |
| The receipt | A statement from the payment provider about that `PayAction`: completed, the scheme's reference, amount, payee, the agreement settled |

#### `rdf-order`

Every object is a document in those terms, carried in ordinary verifiable messages. The
payee's agent sends the invoice. The payer's gate checks CM-10 to CM-14, signs the order
and sends it to the payer's payment provider. The provider moves the money and answers
with the receipt. The payer's agent admits the receipt and passes it to the payee's agent
under the agreement. This suite needs nothing but the message format and a payment
provider that runs an agent.

#### `x402`

The payee's agent answers a request for the paid resource with HTTP status 402 and its
payment requirements. The requirements are lifted as the request for payment; the address
to pay must be bound to the payee by an accepted source. The gate signs a transfer
authorisation for exactly that recipient and value, within a time window, and the request
is sent again with it. A facilitator verifies and settles. The protocol has no offer or
acceptance, so the agreement of this layer is made first and the requirements must say
the same; and it does not sign the settlement response, so the receipt is the
facilitator's own signed statement.

#### `mpp`

As `x402` in shape, with the HTTP authentication framework: a challenge bound to its
parameters, a credential that echoes the challenge and carries the payment proof, and a
receipt header. The agreement's terms digest travels in the challenge. A challenge is
used once.

#### `ap2`

The payee's agent signs a checkout object stating what is bought and for how much. With
the person present, the gate's approval is the trusted surface, and on approval the gate
issues two closed mandates in the person's name: one for the checkout, to the merchant,
and one for the payment, to the credential provider, each bound to the checkout by its
hash. Without the person present, the person signs open mandates ahead of time, with
limits and the agent's key, and the gate closes them. An open mandate's limits and this
layer's mandate rules must say the same, and the suite shows that they do. The closed
payment mandate is what meets CM-14.

#### `acp`

The payer's agent opens a checkout session with the payee's agent, and the session is
lifted as the request for payment. The gate asks the payment provider for a delegated
payment token with an allowance: one use, a maximum amount, this merchant, this session,
an expiry. The session is completed with that token. The protocol makes message
signatures optional; this suite requires them. The allowance is what meets CM-14, and
the protocol's idempotency key carries CM-13.

**Example.** The lender's decision in principle says a valuation is needed. Sam's agent
finds a valuer on a register it accepts. The valuer's agent offers a valuation for 450,
valid for seven days. Sam's mandate allows payments only with approval. The gate asks
Sam, showing the service, the valuer's name as the register gives it, the fee and the
limit. Sam approves, the agent accepts, and the valuer's agent sends its invoice. If the
invoice asked for 495, the gate would stop and tell Sam the difference. If it named an
account that an accepted source binds to someone else, the gate would stop. If a message
merely said "pay the valuation fee now to keep this decision", there would be no
agreement behind it and nothing would be paid.

## Open questions

- Lining up the offer and acceptance messages with existing contract formation rules in the
  main jurisdictions, including notices a consumer must be given before being bound.
- Agreements among more than two parties.
- Whether an agent's acceptance should always name the person who approved it, or only show
  that an approval of the required strength exists.
