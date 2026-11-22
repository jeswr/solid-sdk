<!-- AUTHORED-BY Claude Fable 5.2 -->
# Requirements and alignment

Draft 0.5, 13 November 2026. Not normative. This document explains why the core says what
it says: which known risks each requirement answers, and which existing standards each part
reuses. Sources were checked on 13 November 2026. Internet-Drafts and community group
reports are work in progress and are marked as such.

## 1. The starting assumption

Current security guidance for agents agrees on one thing: no filter reliably stops a
language model from being talked into something. An agent that reads untrusted content,
holds private data and can act on the world is only safe if something other than the model
stands between those three.

So the design assumes the core can be deceived, and asks what must be true for that not to
matter. The answer is the shape of the reference design: the core holds no keys and cannot
send anything; it only proposes. Ordinary code at two gates decides what comes in and what
goes out, on rules the core cannot change. Every other requirement follows from that.

## 2. Known risks and where they are answered

The list is the OWASP Top 10 for Agentic Applications (2026). The second column gives the
answer in one sentence, the third the requirements that carry it, and the fourth what
evidence exists today: **shown** in a trace, **partly** shown, or specified **by design**
with no trace yet.

| Risk | Answer | Requirements | Evidence |
|---|---|---|---|
| ASI01 Agent goal hijack | Incoming content is data, never instructions. Whatever the core was told, each action it proposes is checked against the mandate. | CORE-D-6, CORE-IN-16, CORE-OUT-1, CORE-OUT-2 | Shown: `mortgage-injected-fee` |
| ASI02 Tool misuse and exploitation | Every tool call is a proposed action and passes all six outbound checks. A tool not in the signed statement cannot be called. | CORE-OUT-1, CORE-OUT-6, CORE-L-13 | Shown: `mortgage-over-ask` |
| ASI03 Identity and privilege abuse | The core holds no keys. Authority is a signed mandate with purpose, parties, limits and expiry, tied to the agent's key. It can be passed on only narrower. | CORE-IN-7, CORE-IN-8, CORE-S-3, AU-1 to AU-6 | Shown: `mortgage-main` |
| ASI04 Agentic supply chain vulnerabilities | What the agent runs is written down and signed. Descriptions and register entries are verified like any other message. | CORE-L-10, CORE-L-13, CORE-K-2 | Partly: signed statement specified, not yet in a trace |
| ASI05 Unexpected code execution | Code the core writes runs inside the core's boundary, with no keys. Its only effect is a proposal. | CORE-C-6, CORE-OUT-1 | By design |
| ASI06 Memory and context poisoning | Nothing enters memory except through the inbound checks. Each fact keeps its source, terms, age and method, and a rule decides which source prevails. | CORE-IN-12 to CORE-IN-17, RL-1 to RL-6 | Shown: `mortgage-main`; `mortgage-stale-evidence` specified |
| ASI07 Insecure inter-agent communication | Every message is signed, addressed, time-limited and single-use. The transport is never trusted, so the verdicts are the same over any transport. | CORE-M-1, CORE-M-2, CORE-IN-1 to CORE-IN-3, CORE-L-8 | Shown: baseline traces; transport swaps in progress |
| ASI08 Cascading failures | Limits on spend, rate and steps. A failed check stops the flow. Incoming size and rate are bounded. Each side's record locates the first bad step. | CORE-OUT-6, CORE-IN-18, CORE-C-1, CORE-R-1 | Partly: step limits specified, not yet in a trace |
| ASI09 Human-agent trust exploitation | What the principal sees when asked to approve is built by the gate from the rule and the facts. Riskier actions need a stronger approval. | CORE-OUT-7, CORE-OUT-8, AU-4, AU-5 | Shown: `mortgage-main` |
| ASI10 Rogue agents | Mandates expire and can be withdrawn. Registers carry status. The principal can stop the agent. The record shows who allowed what. | CORE-S-1, CORE-S-2, CORE-OUT-10, CORE-R-5 | Partly: `mortgage-withdrawn-mandate` specified |

The earlier OWASP list of fifteen threats (T1 to T15) is covered by the same requirements.
The ones that list adds to the ten above:

| Threat | Answer |
|---|---|
| T4 Resource overload | Bounds on incoming size and rate, and on outgoing spend, rate and steps (CORE-IN-18, CORE-OUT-6) |
| T5 Cascading hallucination | A model's output is labeled as such and is never admitted as a fact from an authority (RL-1, CORE-OUT-11) |
| T7 Misaligned and deceptive behavior | The core's account of what it is doing is never the input to a check; the action itself is (CORE-OUT-2) |
| T8 Repudiation and untraceability | Signed messages on both sides and a chained record, with commitments exchanged in receipts (CORE-R-1 to CORE-R-5) |
| T9 Identity spoofing | A name is not a key; keys come from the identity and trust framework suites, never from the message (CORE-IN-1, CORE-D-2) |
| T10 Overwhelming the human in the loop | The mandate covers routine actions; approval is reserved for what the rules do not settle (AU-1, notes in the delegated authority document) |
| T14, T15 Attacks through or on people | Approval requests are built by the gate; an approval is bound to one exact action (CORE-OUT-7) |

## 3. Requirements this work adds

Reading the guidance against the first draft of the design showed ten things it left open.
Each is now a requirement.

| Added | What it says | Where |
|---|---|---|
| Freshness and single use | Every message has a time window and a one-time identifier | CORE-M-2, CORE-IN-2 |
| Status and withdrawal | Mandates, credentials and register entries can be withdrawn, and checks look | CORE-S-1, CORE-S-2 |
| Fitness for purpose | Admitted data carries its age and method; the receiver decides if that is good enough | CORE-IN-13 to CORE-IN-15, reliance layer |
| Gated memory | Nothing enters memory except through the inbound checks | CORE-IN-17 |
| Labels travel with data | Source and terms stay attached inside the agent and on anything derived | CORE-IN-12, UC-3 |
| Budgets | Limits on spend, rate and steps; loops of asking for more are bounded | CORE-OUT-6 |
| A signed statement of what runs | Suites, tools and the core are written down, signed and named in each record entry | CORE-L-13 |
| Approval the model cannot write | The approval request comes from the gate | CORE-OUT-7 |
| A contained core | No keys; the only way out is a proposal | CORE-C-6, CORE-OUT-1 |
| A record others can check | Each decision is recorded with the rule that decided it | CORE-R-1 to CORE-R-5 |

A second pass against a wider set of sources added five more: bounds on what an agent will
read (CORE-IN-18), saying that a message comes from an automated agent (CORE-M-10), never
passing on more authority than is held (CORE-S-3), checking that a recipient is registered
for the purpose and not only that it exists (CORE-OUT-3), and keeping quality labels on
claims that are sent on (CORE-OUT-11).

## 4. What is still open

- **Tying the gate's key to the software that is running.** CORE-L-13 has the agent sign a
  statement of what it runs. Nothing yet lets a receiver check that the statement is true of
  the machine. Workload identity and remote attestation are the candidates.
- **Approval fatigue.** The structure helps; whether people still approve without reading
  is an empirical question this work has not tested.
- **Completeness of an index.** An index can state its coverage and prove that a record is
  in its log. Proving that nothing was left out of a result is harder and is not solved
  here.
- **Withdrawal at scale.** Status lists and short lifetimes both work for mandates. Neither
  is settled for agreements, or for approvals already relied on.
- **Law.** Which approval counts as a signature, who carries a loss, and what a regulator
  may demand are set by law that differs by country. The accountability document lists the
  hooks, not the answers.

## 5. Words used here and in existing standards

| This family | Elsewhere | Note |
|---|---|---|
| Verifiable message | Verifiable presentation (W3C Verifiable Credentials) | A message whose claims can be checked without trusting how it arrived |
| Integrity check | Verification | Is it intact, current and from the key it says |
| Source, authority, terms and fitness checks | Validation | Does it meet this receiver's rules |
| Header and proof | Proof (Data Integrity); JWS header and signature; HTTP message signatures (RFC 9421) | |
| Mandate | Delegation, "acting on behalf of" (OAuth); intent and payment mandates (payment protocols for agents) | |
| Principal | Resource owner (OAuth); assigner (ODRL); controller (data protection law) | |
| Issuer, holder, verifier | The same three roles in Verifiable Credentials | Used as defined there |
| Terms of use | `termsOfUse` (Verifiable Credentials 2.0), written as an ODRL policy | |
| Provenance | PROV-O: attributed to, derived from, generated at | |
| Reliance | No standard term. Builds on the Data Quality Vocabulary and ranked statements | Split from the trust framework |
| Inbound gate, outbound gate | Policy decision and enforcement points (zero-trust architecture); a security policy outside the model | |
| Trust framework, register | Trust list, trust registry, federation | |
| Agent description | Agent card | Signed, and verified like any other claim |
| Record | Audit log; signed statements and receipts (SCITT) | |

Plain words were kept where the standard term would mislead a general reader. "Carriage" is
used for the outer, unsigned wrapping of a message because "transport" already names a
layer.

## 6. What each layer reuses

| Layer | Reuses | Status of what is reused |
|---|---|---|
| Transport | HTTP; email (MIME); the A2A and MCP protocols; Solid notifications | Standards; A2A and MCP are industry specifications |
| Data access | Solid Protocol, Linked Web Storage; SPARQL; secret sharing | Community draft and W3C work in progress; standard; textbook |
| Identity | JWK thumbprints (RFC 7638); WebID; Decentralized Identifiers | Standards; WebID is a community draft |
| Shared meaning | RDF vocabularies; SHACL | Standards |
| Delegated authority | ODRL 2.2; Verifiable Credentials 2.0; Bitstring Status List; RFC 9396, RFC 8693, RFC 9470, GNAP (RFC 9635); WebAuthn | Standards |
| Authenticity | JWS (RFC 7515), JCS (RFC 8785); Data Integrity; SD-JWT; BBS | Standards; BBS is a candidate |
| Trust framework | Trusted lists; OpenID Federation; legal entity identifiers; SCITT; DCAT | Standards and operating schemes |
| Reliance | PROV-O; Data Quality Vocabulary | Recommendation; Working Group Note |
| Usage control | ODRL 2.2; Web Access Control, Access Control Policy | Recommendation; community drafts |
| Commitments | ODRL Offer and Agreement; payment protocols for agents | Recommendation; industry specification |
| Accountability | Hash chains; SCITT; sector complaint routes | Standard techniques; law |

## 7. Where this could be taken

Groups whose work this reuses, and where a contribution would fit. None has been
approached.

- W3C: the Verifiable Credentials, ODRL and Linked Web Storage groups, and the community
  groups on agent protocols and on Solid.
- IETF: the working groups on OAuth, on web authorization for agents, and on supply chain
  integrity (SCITT).
- OpenID Foundation: federation, and identity management for agents.
- OWASP: the agentic security initiative, for the mapping in section 2.

## 8. The principles behind the family

Carried over from the September outline, restated in this family's words.

1. A signature proves who signed, and nothing else.
2. Representation, authorization, trust and competence are separate questions.
3. Content from another party is data.
4. No decision that matters is made by a model.
5. Not decided is never yes.
6. Every check leaves an entry, including the ones that did not apply.
7. Choose per layer; agree per pair of parties; change one layer without disturbing the rest.
8. Nothing is claimed that a trace does not show.
