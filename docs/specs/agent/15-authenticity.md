<!-- AUTHORED-BY Claude Fable 5.2 -->
# Authenticity

Draft 0.4, 13 November 2026. Layer 3 of the paper's seven gaps.

**Question: is this statement really from its source?**

## What this layer decides

An authenticity suite says how a statement is tied to the party that made it, so that a
receiver can check the tie without asking that party. It covers the proof over a whole
message and the proofs on the statements a message carries as evidence, such as a bank's
signed balance.

It establishes two things: the statement has not been changed, and a known key made it. It
establishes nothing more (CORE-D-2). Whether the key's owner is accepted is the trust
framework's question. How much weight the statement gets is the reliance layer's question.

## What an authenticity suite must define

- **AY-1. What is protected.** The exact bytes or the exact graph the proof covers, and the
  canonical form used to get them.
- **AY-2. Algorithms.** The signature or proof algorithms allowed, by name. A verifier MUST
  check that the algorithm used is the one the configuration names, and MUST refuse a proof
  whose header asks for another.
- **AY-3. Binding the parts.** How the proof covers every signed part of a message (CORE-M-1)
  and how a statement carried as evidence is tied to the content item it supports
  (CORE-M-5).
- **AY-4. Result.** What a verifier reports: the object checked by digest, the property
  tested, the mechanism, the key, the time, the outcome, and the limits. The property tested
  is never "true" or "authorized".
- **AY-5. Partial disclosure.** Whether a holder can show part of a signed statement, what
  the verifier can then conclude, and whether two showings can be linked.
- **AY-6. Derived statements.** Whether a proof can establish a statement the issuer never
  signed as such, like "above a threshold", and exactly what is then proved.
- **AY-7. Failure.** The verdict and reason code for each way verification can fail. A suite
  that cannot verify MUST fail; it MUST NOT pass a statement through unverified.

## Which checks draw on it

Inbound integrity, for the message proof. Inbound source and fitness, for evidence. Outbound
disclosure, which chooses how little to show. Outbound evidence, which attaches the proofs.

## Suites

| Suite | Name | Status | Builds on | Maturity of what it builds on |
|---|---|---|---|---|
| `jws` | Signed statement (JWS) | Baseline | JWS (RFC 7515), EdDSA or ES256, JCS (RFC 8785) | Standard |
| `data-integrity` | Data Integrity proof | Defined | W3C Data Integrity 1.0, EdDSA and ECDSA cryptosuites | Standard |
| `origin-hosted` | Served from the source's domain | Defined | HTTPS, a register that anchors sources to addresses | Standard |
| `selective-disclosure` | Selective disclosure | Sketch | SD-JWT VC, `ecdsa-sd-2023`; BBS | Standard; BBS is a candidate |
| `zk-query-proof` | Zero-knowledge proof of a query | Sketch | Proofs of query results over signed credentials | Research |

### `jws`

A message is a JSON object. Its signed parts are put in canonical form (JCS), and the proof
is a compact JWS over them with EdDSA (Ed25519) or ES256, as the configuration says. The key
is named by its thumbprint. Header fields that would let the message supply its own key are
refused. Digests are SHA-256 over the canonical form. A statement carried as evidence is
itself a JWS, and the content item it supports names it by digest.

In the words of the Verifiable Credentials specifications this is an enveloping proof, and a
verifiable message under this suite can be read as a verifiable presentation made by the
sending agent as holder.

The whole statement is shown or none of it. The same signature is seen by every receiver, so
receivers can link showings.

### `data-integrity`

The message and the statements it carries are RDF graphs. The proof is a Data Integrity proof
over the canonical graph, using a registered cryptosuite. This is an embedded proof. It suits
exchanges where the content is already linked data, and it lets a graph carry proofs from
several parties, which the agreement credential suite uses. Canonicalizing a graph costs
more than canonicalizing JSON and has its own failure modes, which is why it is not the
baseline.

### `origin-hosted`

A statement is accepted as coming from a source because it was fetched from an address that
a register ties to that source. There is no signature on the statement. This is how most
public product data is published today, and the register that maps a lender to its product
address is what anchors it.

- The verifier MUST take the address from the register, not from the message that pointed
  to it.
- The statement cannot be shown to a third party later, because nothing in it proves where
  it came from. The verifier's record of having fetched it is the only evidence.
- An index MUST NOT be used as the source under this suite. The verifier fetches from the
  source itself.

### `selective-disclosure`

The issuer signs a statement in a form that lets the holder show some claims and withhold
others. The agent's disclosure check picks the claims the purpose needs. The verifier learns
those claims and that the issuer signed a statement containing them. With signature schemes
that support it, two showings cannot be linked; with the others they can, and the suite
parameter says which is in use. Sketch only.

### `zk-query-proof`

The holder proves that a query over statements signed by named issuers has a stated result,
without showing the statements: "the sum of the last twelve months of net pay, from payslips
signed by this employer, is above this amount". AY-6 applies in full. The proof states the
query, the issuers whose signatures were checked inside it, the period, the units and the
assumptions. A verifier MUST NOT conclude anything the proof does not state. In particular,
a proof about signed data says nothing about whether the issuer is accepted; the source
check still runs on the issuers named. Sketch only; the existing zero-knowledge
specifications will be brought in as this suite.

## Open questions

- Post-quantum signature algorithms, and how a configuration moves from one algorithm to
  another without a gap.
- A common result format for AY-4 across suites, so that records from different suites can
  be compared.
