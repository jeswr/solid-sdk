<!-- AUTHORED-BY Claude Fable 5.2 -->
# Baseline configuration

Draft 0.5, 13 November 2026.

## Why there is a baseline

The layers let communities choose. Choice alone does not let two agents talk: if every
implementation picks differently, none of them can talk to another. So this family
recommends one configuration that every implementation is asked to support (CORE-L-12). Two
agents that have nothing else in common have this.

The baseline is a floor to meet on. It is not the best choice in every layer, and the last
section says how to move up from it.

It was chosen by four rules.

1. Everything in it can be built today on published standards.
2. It has the fewest moving parts that still answer every check.
3. It needs no service that does not exist, except registers, which need an adapter.
4. Each suite in it can be swapped for a stronger one without touching the others.

## The Answerable baseline, `baseline/0.1`

| Layer | Suite | Why this one |
|---|---|---|
| Transport | `direct-http` | Every platform has it. The message is the body of a POST. |
| Data access | `by-value` | The data travels in the message. Nothing else has to be online. |
| Identity | `pinned-key` | A party is named by the thumbprint of its key. No resolver to trust. |
| Shared meaning | `fixed-vocabulary` | Terms are agreed before the exchange, in a published profile. |
| Delegated authority | `mandate-signed` | One signed ODRL document. Stronger approval can be asked for when needed. |
| Authenticity | `jws` | The most widely implemented signature format. |
| Trust framework | `register-chain` | The principal's own list first, then a root and its registers. Strangers can be checked. |
| Reliance | `precedence-rules` | Age, method and an order of sources. No numbers to argue about. |
| Usage control | `odrl-rules` | Terms are decided by code alone, with three outcomes. |
| Commitments | `signed-offer-acceptance` | Two signed messages, tied by a digest. |
| Accountability | `local-ledger` | Each side keeps a signed chain of its own decisions. |

The baseline supports derived statements with two kinds of assurance: `by-source`, where
the source answers a question over its own records and signs the answer, and `recomputed`,
where the inputs travel and the receiver runs the rule again. Neither needs anything beyond
signed statements.

Lookups against public services use the public read configuration, `public-read/0.1`: the
same suites, with identity `anonymous` for the asker, data access `by-query`, and no
mandate, because the request is made on no one's behalf (CORE-IN-9).

- **BL-1.** An implementation that claims to support the baseline MUST implement every suite
  in the table and the public read configuration, and MUST pass the conformance scenarios
  listed for `baseline/0.1` in the conformance document.
- **BL-2.** An implementation that supports other configurations SHOULD also accept the
  baseline, unless its principal's policy forbids it for the task in hand. When it refuses,
  it says so with `unsupported-configuration` and lists what it does accept.

## What it needs around it

- A key for each agent's gate and a key each principal controls.
- A root and registers that answer in the form the trust framework layer defines, or an
  adapter in front of existing registers. For tests and closed groups the principal's own
  list is enough.
- A domain profile that names the vocabulary, the accepted kinds of source, the freshness
  limits and the approval levels for the task. The mortgage profile is the worked example.

## What it does not give

Stated plainly, so that nobody adopts it expecting more.

- **No privacy beyond need-to-know.** Data is copied to the receiver. A whole signed
  statement is shown or none of it, unless its source will sign a narrower answer. The
  whole mandate is shown.
- **No unlinkability.** A party is named by a long-lived key, and receivers can compare
  notes.
- **No enforcement inside the receiver.** Terms are known and each honest agent enforces
  them; a dishonest receiver is dealt with after the fact.
- **No forum.** Each side holds evidence. Where to take it is left to the law that applies.
- **No proof of independent interoperation yet.** The conformance document says what
  evidence exists.

Each of these has a suite that addresses it: `by-reference-solid`, `by-query` and
`aggregate-mpc` for data access; `selective-disclosure` and `zk-query-proof` for
authenticity, which give derived statements the `proved` assurance; `mandate-credential` for authority; `regulator-claim` for accountability.

## Starting from email

Most people and most organizations cannot adopt a new protocol in one step. They can receive
email. So the family defines an entry configuration that works over ordinary email, and a
way for two parties to move up from it one layer at a time.

### The entry configuration, `entry-email/0.1`

| Layer | Suite | Difference from the baseline |
|---|---|---|
| Transport | `email` | The verifiable message is an attachment. The body is prose. |
| Data access | `by-value` | |
| Identity | `email-endpoint` | A party is named by an address; its key is found from the domain. |
| Shared meaning | `plain-language-upgrade` | Prose can be read and answered. It cannot be evidence. |
| Delegated authority | `mandate-signed` | |
| Authenticity | `jws` | |
| Trust framework | `pinned-list` | Only parties the principal has listed. |
| Reliance | `precedence-rules` | |
| Usage control | `human-approval` | Anything the rules do not settle goes to the person. |
| Commitments | `signed-offer-acceptance` | |
| Accountability | `local-ledger` | |

A person with no agent reads the email and replies as they always have. A person with an
agent gets more: their agent verifies the attachment, knows who sent it and on whose
authority, and can answer in kind.

### The footer

An agent that sends a signed email under the entry configuration on behalf of a principal
adds a short footer to the body.

> Sent by Sam's agent, an automated assistant acting for Sam. It is an Answerable agent:
> this message is signed, says what the agent is allowed to do, and is recorded. You can
> reply as normal. If you use an agent of your own, it can check all of this for you. Get
> one that is Answerable too: *link*.

When the signed message carries no conformance claim it uses the neutral form: *Sent by Sam's
agent, an automated assistant acting for Sam. I use an agent that supports signed messages:
a signed copy of this message is attached. You can reply as normal. If you use an agent of
your own, it can check the signed copy for you. What this means, and how to get such an
agent:* link.

- **BL-3.** The footer MUST say that the message was sent by an automated agent and name
  whom it acts for (CORE-M-10).
- **BL-4.** The footer MUST NOT appear on a message that does not carry a verifiable
  message, and MUST NOT use the name Answerable unless the sender's signed statement of
  what it runs carries a claim of conformance (CF-10). It describes what is attached, not
  what the sender hopes to be.
- **BL-5.** The footer MUST NOT claim that the message is safe, verified or trustworthy.
  Those are conclusions for the receiver's own checks.
- **BL-6.** The message MUST also carry the address of the sender's agent description in the header field
  `Agent-Description`, whose value is one `https` address. The header is an unverified hint.
  Any description used for negotiation MUST be verified as a claim (CORE-L-10). The reference
  engine and pilot use the signed description exchange. They do not resolve the address, and
  the header never selects or upgrades a configuration. A receiver MUST NOT act on the footer
  text or follow its link.
- **BL-7.** The link leads to a page that explains what the footer means and how to get an
  agent that supports the same thing. The page MUST offer more than one route and MUST NOT
  require an account with the sender's own provider.

The page behind the link describes deployment options. The intended routes are adding an
adapter to an assistant the person already uses or using a hosted agent. Builders can also
run the reference agent.

### Moving up

- **BL-8.** When both sides have agents, selection uses the sender's verified description
  (CORE-L-10) and chooses the strongest configuration both accept (CORE-L-11). The reference
  engine and pilot discover capabilities through signed `describe` and `description` messages.
  If selection differs from the configuration used for discovery, they refuse it with
  `unsupported-configuration`.
- **BL-9.** Once two parties have exchanged messages under a configuration, an agent MUST
  NOT accept a message under a weaker one in the same conversation, and MUST ask its
  principal before accepting one in a new conversation with the same party. Otherwise an
  attacker would simply ask for the weakest.
- **BL-10.** Moving up changes suites, never the checks. A record made under the entry
  configuration and one made under the baseline are read the same way.
- **BL-11.** The footer supplies no evidence of identity, authority or capability. Readable-copy
  parity checks the footer's exact wording and presence after signature verification. Mail with
  no structured part yields `no-structured-content`. An invalid signature yields `bad-signature`
  even if the footer was also altered.
- **BL-12.** The footer is part of the readable copy (TR-3). A sender derives it from the signed message
  alone, and a receiver's agent checks it with the rest of the readable copy. The named variant
  requires a conformance claim in the sender's own description carried in that signed message.
  Other signed messages use the neutral variant when they name a represented principal.
- **BL-13.** The link in the footer MUST be the same for every recipient and every message. It MUST NOT carry
  a query, an identifier or a redirect, and the message MUST NOT contain remote images or other content
  fetched when it is opened.

The same path continues above the baseline. A sector adopts a profile, then swaps in the
suites its risks call for: selective disclosure where data is sensitive, a claim route where
there is a regulator, a joint computation where several parties each hold part of the
answer.

## Open questions

- Whether the entry configuration should allow `register-chain`, so that an email from a
  bank can be checked against a register on first contact.
