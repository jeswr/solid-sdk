<!-- AUTHORED-BY Claude Fable 5.2 -->
# Trust framework

Draft 0.4, 13 November 2026. Layer 4 of the paper's seven gaps.

**Question: why should I accept this party or source at all?**

## What this layer decides

A signature says which key made a statement. It does not say whether the key's owner is a
real lender, a certified identity provider, or the bank it claims to be. A trust framework
suite says how an agent finds that out: who it asks, in what order, what an answer looks
like, and how far an answer reaches.

No agent holds one list of everyone it trusts. A person trusts a handful of people and
services directly, each for particular things. For everyone else they rely on institutions:
a business register to say a company exists, a regulator to say it may lend, a certification
scheme to say an identity provider meets a standard. Those institutions are themselves
arranged in chains, and the chains have roots, usually national. So a lookup works the way a
name lookup works in the domain name system: start local, then start at a root and follow
delegations until someone can answer.

An answer is always scoped. "Accepted" on its own means nothing. The answer is "accepted as
a mortgage lender", "accepted as an authority for balances of its own accounts", "accepted
to attest face checks at this level".

## What a trust framework suite must define

- **TF-1. The questions it answers.** The kinds of question that can be asked: is this party
  of this kind; is this source an authority for this kind of claim; is this service accepted
  for this function.
- **TF-2. The principal's own list.** How the principal's direct choices are held: each entry
  names a party, its key, what it is accepted for, and until when. An entry can also block
  (CORE-K-3).
- **TF-3. Roots.** Which roots a principal can accept, how a root is named, and how its key
  is obtained. Accepting a root is the principal's decision, or their operator's on their
  behalf with their knowledge.
- **TF-4. Delegation.** How a root or register states that another register answers for a
  kind of party or claim, and the limits on such a delegation. A register answers only
  within what was delegated to it.
- **TF-5. Answers.** What a register's answer contains: the party, its key or keys, what it
  is accepted for, its status, when the answer was made and when it expires. Answers are
  signed and are verified like any other message (CORE-K-2).
- **TF-6. Path.** That the agent keeps the path of every lookup with the decision it
  supported (CORE-IN-6): each party asked, what it said, how fresh it was.
- **TF-7. Order and conflict.** The order in which sources are consulted, and what happens
  when they disagree or one cannot be reached. An unreachable register gives
  `indeterminate` (`lookup-failed`), never acceptance.
- **TF-8. Governance.** Who runs the framework, how a party gets listed and removed, and
  where a complaint about a listed party goes. Accepting a framework is separate from the
  framework existing.
- **TF-9. What a lookup reveals.** What each register learns from being asked.

## Which checks draw on it

Inbound source and authority. Outbound recipient. The identity layer, for keys carried in
answers.

## Suites

| Suite | Name | Status | Builds on | Maturity of what it builds on |
|---|---|---|---|---|
| `register-chain` | Own list, then a chain of registers | Baseline | Modeled on trusted lists, trust framework registers, vLEI chains, federation trust chains | This work |
| `pinned-list` | Own list only | Defined | | This work |
| `federation` | Federation membership | Sketch | OpenID Federation 1.0 | Standard |
| `trusted-index` | Trusted index | Defined | SCITT (RFC 9943), DCAT 3 | Standard |
| `reputation` | Reputation | Sketch | | Research |

### `register-chain`

A lookup runs in this order and stops at the first source that answers.

1. **The principal's own list.** If the party is there for this purpose, it is accepted. If
   it is blocked, it is refused. Otherwise go on.
2. **A root the principal accepts.** The agent asks the root which register answers for this
   kind of party or claim. The root's reply is a signed delegation.
3. **The register named.** The agent asks it about the party. The reply is a signed answer
   under TF-5. A register may delegate once more, for instance from a national regulator to
   a sector body; the suite parameter caps the number of hops, and the default is three.

Each reply passes the inbound checks: integrity with the key of the party that sent it, and
source against the delegation above it. The agent keeps the answer, with its path, until it
expires. Lookups use the public read configuration: the asker gives no name, and a question
about an organization carries no personal data.

Across borders, a root can delegate to another country's root for parties established
there, or a higher root can link national ones. The suite does not assume such a root
exists. It defines how one would be used.

**Example.** Sam's agent wants to send an application to North Bank. Sam's own list has no
entry. The national trust root says lenders are answered by the financial sector register.
That register says North Bank is authorized for mortgage lending, gives its key, and dates
the answer today. Accepted, for mortgage applications only.

**Real-world roots this is modeled on.** Not normative. National trusted lists under eIDAS;
the register of certified services under the UK digital identity and attributes trust
framework; company registers; regulators' registers of authorized firms; the chain from
GLEIF to the issuers of legal entity identifiers and their verifiable form. None of these
answers in the form of TF-5 today. A deployment needs an adapter in front of each, and says
so in its description.

### `pinned-list`

Only step 1 above. Every party the agent deals with is listed by hand with its key and what
it is accepted for. Suitable for closed groups, tests and first contact between two people
who know each other. It does not scale to dealing with strangers, which is the reason for
the baseline.

### `federation`

Parties are members of a federation. Membership is shown by a chain of signed statements
from the party up to the federation's authority, and the federation's rules say what
membership means. This fits sectors that already run a scheme with a rule book. It differs
from `register-chain` in that the party presents its own chain instead of the agent looking
it up, so the register learns nothing about who is asking. Sketch only.

### `trusted-index`

The party is found through an index. An index gathers records that each source has signed,
such as lenders' product records, and keeps each record with its signature. What the agent
trusts the index for is narrow: that it holds what it says it holds, and that it is up to
date. It never trusts the index for the content of a record.

- Each record MUST be signed by its source, and the agent MUST verify it against the source,
  whose acceptance is established by lookup as above. The index's own signature on a record
  adds nothing to the record's truth.
- The index SHOULD give a receipt showing a record is in its append-only log, so that it
  cannot show different sets to different askers unnoticed.
- The index MUST state its coverage (which sources it gathers, out of which register) and
  how it ordered the results. An agent MUST NOT treat the order as advice.
- Each record carries when it was made and for how long it holds. The reliance layer decides
  how old is too old.
- A query to the index carries no personal data. The agent filters on its own side.

### `reputation`

A rating service the principal accepts scores how a party's agents have behaved. A score is
an input to the principal's own rules and never a substitute for a register: a lender with
a high score that is not on the regulator's register is still not a lender. No standard
scheme exists. Sketch only.

## Open questions

- A common answer format (TF-5) that existing registers could publish directly.
- How a principal changes roots, and what happens to decisions made under the old one.
- Whether lookups should be made through a relay, so that a register cannot tell which
  agent is asking about whom.
