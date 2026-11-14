<!-- AUTHORED-BY Claude Fable 5.2 -->
# Identity

Draft 0.5, 13 November 2026. Layer: plumbing.

**Question: what names a party, and how is its key found?**

## What this layer decides

Before a signature can be checked, the receiver needs the signer's key from somewhere other
than the message (CORE-IN-1). An identity suite says what kind of name a party goes by and
how a key is found for that name. It answers nothing else. Knowing whose key signed a message
does not say whether to accept the signer (trust framework), whether it may act for anyone
(delegated authority), or whether what it says is so (reliance).

An exchange has several names in it, and they are kept apart: the agent, the principal it
acts for, and the operator that runs it. A suite says how each is named.

## What an identity suite must define

- **ID-1. Names.** The form of identifier for agents, principals and operators.
- **ID-2. Key discovery.** How a verifier gets the key for a name, from where, and what it
  trusts in doing so.
- **ID-3. Control.** What shows that a party controls a name, and what control does not show.
- **ID-4. Change.** How keys are rotated, how long a key may live, and how a lost or stolen
  key is replaced. Keys MUST have a stated lifetime.
- **ID-5. Past signatures.** Which key applied at the time a past message was signed. Today's
  key for a name is not evidence about last year's.
- **ID-6. Linkability.** Whether the same name is seen by every party the holder deals with,
  and whether per-relationship names are possible.
- **ID-7. Who must be named.** Whether a requester must be named at all.

## Which checks draw on it

Inbound integrity (whose key signed it). Outbound recipient (is the other side the party
named). Inbound authority, to tie the agent's key to the mandate.

## Suites

| Suite | Name | Status | Builds on | Maturity of what it builds on |
|---|---|---|---|---|
| `pinned-key` | Web address with a pinned key | Baseline | JWK thumbprints (RFC 7638) | Standard |
| `webid` | WebID | Defined | WebID, Controlled Identifiers 1.0 | Community draft, standard |
| `did` | Decentralized identifier | Defined | Decentralized Identifiers 1.0 | Standard |
| `email-endpoint` | Email address as an endpoint | Defined | `mailto` identifiers | This work |
| `anonymous` | No identifier | Defined | | This work |

### `pinned-key`

A party is named by a web address. Its key is identified by its thumbprint and is looked up
only in what the verifier already holds: its principal's own list, or an answer it obtained
through the trust framework suite, which carries the key for the party it names. A key
offered by the message itself, or a link in the message to a key, MUST be refused.

Nothing is fetched at verification time, so a party cannot be impersonated by taking over a
web page. The cost is that keys must be obtained beforehand or through a register. In the
baseline configuration, the register answer that says "North Bank is an authorized lender"
also carries North Bank's key, so one lookup serves both purposes.

Keys are rotated by publishing a new register entry or a new signed entry for the
principal's list. The old key stays valid for messages signed before the change.

### `webid`

A party is named by the address of a profile document it controls, and the key is published
in that document as a verification method. The verifier fetches the document. Control of the
document is control of the name, so the security of this suite is the security of the web
server and of the name's registration. The fetch MUST be made safely: no private addresses,
bounded size, no redirects to other sites without re-checking.

### `did`

A party is named by a decentralized identifier and the key is found by resolving it. The
suite parameter names the methods accepted. Each method has its own answers to ID-3 to ID-5,
and a configuration MUST list the methods it accepts instead of accepting all of them.

### `email-endpoint`

A party is reached at an email address. The address names a mailbox, not a person. This suite
MUST be combined with separate evidence of who controls the mailbox and for what: a prior
exchange, a challenge sent to the address, or a statement from a register. Control of a
mailbox shows control of a mailbox. It does not show that the sender may bind an
organization. Forwarding, shared mailboxes and reassignment are expected.

### `anonymous`

The requester gives no name. This is the normal case for a public read: asking an index for
product records, or a register whether a lender is authorized. Answers are still signed by
the service. A service MUST NOT treat the absence of a name as a grant of anything beyond
what it offers to everyone.

## Two identities people confuse

The agent's identity in this layer is the identity it signs messages with. The software that
runs the agent has a second identity inside its operator's systems, used to obtain its keys
and reach its stores. Work on workload identity (WIMSE, SPIFFE) covers that second one. It is
outside this layer, and CORE-L-13 is where the two meet: the signed statement of what an
agent runs.

## Open questions

- Per-relationship names, so that two lenders cannot tell they are dealing with the same
  person's agent. Possible with `did` and with pseudonyms in some credential formats. Not
  drafted.
- A suite for identifiers issued under a national wallet scheme.
