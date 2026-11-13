<!-- AUTHORED-BY Claude Fable 5.2 -->
# Derived data and inference

Draft 0.5, 13 November 2026. Part of the core. Clause prefix DER.

**Question: when an agent conveys an answer instead of the records behind it, why should the
receiver believe the answer, and what follows from it?**

## 1. Why this document

Sharing whole signed statements is simple and discloses the most. An agent that wants to
disclose less conveys something worked out from the statements instead: a total, a yes or
no, a summary, the rows that match a question.

Earlier drafts treated three ways of doing that as three different things: answering a
query, giving a proof, and computing a result jointly. They are one thing. In each, a
**rule** is applied to **source statements** and gives a **derived statement**. What differs
is only how the receiver knows that the rule was applied honestly to real inputs.

This document defines that one thing once, and says how every check treats it. The layer
documents then only add mechanisms.

The idea in one sentence: **a receiver that accepts the sources, accepts the rule, and can
check how the rule was applied, can treat the result as data.**

## 2. Terms

**Statement.** A set of claims with a proof of who made it. In the reference encoding the
claims are an RDF graph.

**Original statement.** A statement signed by the party that makes the claims: a bank's
statement of a balance, a register's entry.

**Rule.** A published, deterministic function from statements to claims. The reference rule
language is a subset of SPARQL `CONSTRUCT`: the rule matches patterns in the input graphs
and builds the output graph.

**Derivation.** One application of a rule to named inputs, giving an output.

**Derived statement.** The output of a derivation, with its **derivation record**.

**Deriver.** The party that ran the rule.

**Assurance.** How the receiver knows the output is what the rule gives on those inputs.

## 3. What a rule must be

- **DER-1. Named and fixed.** A rule MUST have an identifier and a digest of its text. A
  derivation names both. A receiver MUST NOT accept a derivation under a rule whose text it
  cannot obtain and match to the digest.
- **DER-2. Deterministic.** The same inputs and parameters MUST give the same output.
  Anything that would vary, such as the current time or a threshold, is a named parameter
  bound in the derivation record. Output is put in canonical form before its digest is
  taken.
- **DER-3. Declared inputs and outputs.** A rule MUST declare the kinds of claim it reads
  and the kinds of claim it can produce. A rule can produce only what it declares.
- **DER-4. Declared needs.** A rule MUST declare whether it needs complete inputs
  (section 7), and the units, period and rounding of what it produces.
- **DER-5. Language.** The reference rule language is SPARQL 1.1 `CONSTRUCT` restricted to:
  basic graph patterns, `FILTER`, `BIND` with arithmetic and comparison, `OPTIONAL`,
  `UNION`, and the aggregates `SUM`, `COUNT`, `MIN`, `MAX` and `AVG`. No federated
  `SERVICE`, no random or time functions, no property paths of unbounded length. `ASK` is
  the special case that produces one true or false claim. A suite MAY define another rule
  language if it meets DER-1 to DER-4.
- **DER-6. Who vouches for a rule.** A rule answers a question. Whether it is the right
  question is a matter of meaning, so rules are published in a domain profile, next to the
  vocabulary they read and write. A receiver accepts a rule when its profile lists it for
  the kind of claim needed, or when the receiver wrote the rule itself.

A model's summary of a document is not a derivation. It is not deterministic and no rule
can be named. Its output has the method `model-output` (reliance layer) and is never
presented as derived.

## 4. The derivation record

A derived statement carries, in the evidence part of the message, a record with these
fields.

| Field | What it holds |
|---|---|
| Rule | Identifier, digest, and the values bound to its parameters |
| Inputs | For each input: the issuer, the kinds of claim read, when it was made and the period it covers, its method, and a reference to it. The reference is a digest when the receiver may see the input, and a commitment when it may not. |
| Completeness | For each input set the rule needs complete: the statement of completeness relied on (section 7) |
| Output | Digest of the derived claims |
| Deriver | Who ran the rule |
| Assurance | The way of assuring it (section 5) and the material that goes with it |
| Time | When the rule was run |

- **DER-7.** The record MUST be covered by the message proof (CORE-M-1), and the content
  item MUST refer to it (CORE-M-5).
- **DER-8.** The record is written with PROV-O: the output `wasGeneratedBy` an activity that
  `used` each input, with the rule as its plan and the deriver as its agent. No new
  provenance vocabulary is defined.
- **DER-9. Chains.** An input MAY itself be a derived statement. Its record then travels
  with it, so the receiver sees the whole chain down to original statements. A suite sets a
  maximum depth; the default is 3.

## 5. Assurance

There are five ways for a receiver to know that the output is what the rule gives on real
inputs. They differ in who runs the rule, what the receiver sees, and what the receiver must
rely on besides the sources and the rule.

| Assurance | Who runs the rule | The receiver sees | Relied on besides sources and rule | Mechanism |
|---|---|---|---|---|
| `by-source` | The source, over its own records | The output | Nothing more. The source signs the output as its own statement. | Any authenticity suite |
| `recomputed` | The receiver, again | The output and every input | Nothing more | Inputs attached under any authenticity suite |
| `proved` | The holder | The output, and who the issuers are | That the proof system is sound | `selective-disclosure`, `zk-query-proof` |
| `joint` | Several holders together | The output, and who contributed | That the computing parties do not collude beyond a stated number | `aggregate-mpc` |
| `attested` | A deriver that is not the source | The output | The deriver | Any authenticity suite, with the deriver accepted under the trust framework |

- **DER-10.** A derivation record MUST state exactly one assurance, or `joint` together with
  `proved` when a joint computation also yields a proof.
- **DER-11. `by-source`.** When the source for every input is the deriver, the output is an
  original statement of a narrower claim. This is what a query to a bank, a register or a
  payroll provider returns. The source learns the rule and that it was asked.
- **DER-12. `recomputed`.** The inputs are attached. The receiver MUST verify each input as
  an original statement, run the rule, and compare digests. This discloses everything and
  assures the most. It is also what a query to an index returns: rows that are original
  statements, with the index as the route they came by.
- **DER-13. `proved`.** The proof MUST establish that the output is the rule's result on
  inputs that carry valid proofs from the issuers named, bound to the subject named, and
  that each input's terms permit the derivation (DER-22). The receiver MUST verify the proof
  against the rule digest in the record. Showing some claims of a statement and
  withholding others is the simplest case: the rule is a projection.
- **DER-14. `joint`.** Each holder MUST sign an input attestation as the data access layer
  defines. The record names the computing parties and the assumption. The receiver MUST
  verify every attestation and MUST treat a missing one as a failed derivation, never as a
  smaller total.
- **DER-15. `attested`.** A deriver's signature shows only that the deriver says so. The
  receiver MUST establish, under the trust framework, that the deriver is accepted to
  attest derivations of this kind for this purpose. Hardware attestation of the deriver's
  environment is a way to earn that acceptance; it is not a sixth kind of assurance. An
  agent attesting its own derivation to a party that has no reason to accept it gives a
  claim with the method `reported-by-subject`.
- **DER-16. Stating what is needed.** A request for data SHOULD state the claim needed, the
  rules it accepts and the assurances it accepts, instead of naming documents. A request
  that names only documents leaves the sender nothing less to offer.

## 6. How the checks treat a derived statement

Nothing new is checked. Each existing check has one more case.

### Inbound

- **DER-17. Integrity.** The message proof is verified as usual. Then the assurance is
  verified by its own mechanism: digests compared, proof verified, attestations verified,
  deriver's signature verified. A failure is `fail` with `derivation-not-verified`.
- **DER-18. Source.** The sources of a derived statement are the issuers of its inputs, not
  the deriver. The source check MUST run for each input issuer, for the kind of claim read
  from it, by the same lookup as for an original statement (CORE-IN-6), and each path is
  kept. For `attested`, the deriver is looked up as well. The rule MUST be one the receiver
  accepts for the claim (DER-6); otherwise `fail` with `rule-not-accepted`.
- **DER-19. Terms.** The terms of a derived statement are worked out from the terms of its
  inputs (DER-22) and stated in the terms part. The receiver reads them as any other terms.
- **DER-20. Fitness.** A derived claim has the method `derived`, and takes its quality from
  its inputs, weakest first:
  - its time is the time of its oldest input;
  - its basis is the lowest-ranked method among its inputs, in the profile's order, so a
    total of self-reported figures is still self-reported;
  - when a needed statement of completeness is missing, it is marked `partial`, and the
    profile says whether the task accepts that.
  Assurance does not raise quality. A proof makes a claim checkable, not better founded.

### Outbound

- **DER-21. Disclosure.** The disclosure check (CORE-OUT-4) chooses among the ways the
  recipient accepts: which rule, which assurance, by value or by reference. It MUST prefer
  the one in which the fewest parties learn the least. In general: `joint` and `proved`
  before `by-source`, `by-source` before `attested`, and all of these before `recomputed`
  and before sending the statements themselves. When the rule was supplied by the other
  party, the gate MUST check the rule's declared outputs against the mandate, run it, and
  check the actual output as well. A rule whose outputs are not bounded by its declaration
  is refused.
- **DER-22. Data terms.** Unless an input's terms say otherwise, a derived statement
  carries every prohibition and every duty of every input, the permissions common to all of
  them, the narrowest purpose and the shortest retention. An input's terms MAY grant a
  derivation: under a named rule or class of rule, the output may carry stated, lighter
  terms. In ODRL these are the `derive`, `aggregate` and `anonymize` actions with
  constraints. Lighter terms apply only when every input grants them. Where the receiver
  cannot see the inputs' terms, the assurance MUST cover them: inside the proof for
  `proved`, in each holder's attestation for `joint`, and by the source's own signature for
  `by-source`.
- **DER-23. Evidence.** The record entry for the action holds the derivation record and,
  on the sender's side, references to the inputs themselves. The sender keeps the inputs
  for as long as their terms allow, so that a derivation can be opened later (section 9).

### The acceptance rule, stated once

A receiver accepts a claim *c* from a derived statement for a task when all of these hold.

1. The rule is accepted for claims of the kind of *c*.
2. Every input read by the rule comes from an issuer accepted as a source for what was read
   from it.
3. The assurance is one the receiver accepts for the task, and it verifies.
4. Any completeness the rule needs is established, or the task accepts a partial result.
5. The receiver can keep the terms.
6. The claim, with the quality it takes from its inputs, is fit for the task.

Points 2, 5 and 6 are the ordinary source, terms and fitness checks, applied to the inputs.
Points 1, 3 and 4 are what derivation adds.

## 7. What a derivation cannot show

A rule runs on the inputs it is given. The holder chooses what to give.

- **DER-24. Presence is shown; absence and totality are not.** A rule that only matches
  patterns that are present, such as "there is a payslip above this amount", is sound on
  any subset of the truth. A rule that counts, sums, takes a minimum or tests that
  something is absent is sound only if its inputs are complete. A holder who leaves out a
  loan account gets a better total.
- **DER-25. Completeness is a claim.** Where a rule needs complete inputs, completeness
  MUST itself be a claim made by a party in a position to know: "these are all the accounts
  this customer holds here, as of this date", signed by the bank; "this person has no other
  employer on record", signed by the tax authority. It is checked by the source check like
  any other claim. Where no one can state it, the result is `partial` (DER-20), and the
  record says "over the inputs supplied".
- **DER-26. One subject.** Every input MUST be bound to the same subject, or the rule MUST
  state how subjects relate. A total over two people's accounts is not one person's
  deposit.
- **DER-27. Asking twice.** Two derived answers can reveal a value neither reveals alone.
  The outbound gate MUST record each derivation it releases about a subject to a recipient,
  and a profile MAY cap how many it releases under related rules. This is a known limit,
  not a solved problem (section 11).

## 8. Meaning is derivation too

Translating a term from one vocabulary to another applies a rule: the mapping. So a
translated claim is a derived claim. Its rule is the mapping, its input is the original
claim, and the party that published the mapping vouches for the rule (DER-6). The shared
meaning layer says which mappings exist; this document says how a claim that passed through
one is checked. The same holds for a class or property inferred from an ontology: the
ontology's axioms are the rule.

- **DER-28.** An agent MUST NOT rewrite a claim into another vocabulary silently. Either the
  original claim travels with the mapping named, or the translated claim travels with a
  derivation record.

## 9. Opening a derivation

A `proved` or `joint` derivation hides its inputs from the receiver. That must not put them
beyond the reach of a dispute.

- **DER-29.** A party that conveyed a derived statement MUST be able to show, to a forum
  that the accountability layer recognises, the inputs it used, for as long as it relies on
  the result or is bound by an agreement made on it. The commitments in the record make
  that showing checkable: the forum can see that the inputs shown are the inputs used.
- **DER-30.** Opening is a disclosure. It passes the outbound checks, with the forum as the
  recipient and the dispute as the purpose.

## 10. Where each mechanism lives

| Mechanism | Layer | What it supplies |
|---|---|---|
| Sending the statements | Data access `by-value` | No derivation, or `recomputed` |
| A pointer and a right to read | Data access `by-reference-solid` | Either, read at the pod. A pod that runs rules is a deriver, `attested` unless it is the source. |
| Asking a question | Data access `by-query` | The rule travels in the request. `by-source` when the holder is the source; `recomputed` from an index. |
| Joint computation | Data access `aggregate-mpc` | `joint`, for the rules the suite supports |
| Selective disclosure | Authenticity `selective-disclosure` | `proved`, for projection rules |
| Zero-knowledge proof of a query | Authenticity `zk-query-proof` | `proved`, for the rule language of DER-5 |
| Accepting a deriver | Trust framework | The lookup for `attested` |
| Quality of the result | Reliance | DER-20 |
| Terms of the result | Usage control | DER-22 |
| Opening | Accountability | DER-29, DER-30 |

The baseline supports derived statements with `by-source` and `recomputed` assurance. Both
need nothing beyond signed statements. `proved` and `joint` are what a sector adds when the
data is sensitive.

## 11. Open questions

- Which party's rule wins when the receiver's rule and the profile's rule for the same claim
  differ.
- Hiding which issuer signed an input, by proving only that the issuer is on a register.
  The source check would then run on the register's list as a whole.
- Limits on repeated questions (DER-27). Query auditing and differential privacy are the
  known approaches; neither is drafted.
- Rules over data that is not a graph: a scan, a recording, free text. Today these can be
  conveyed only as original statements or as `model-output`.
- Joint computation with proofs, so that correctness does not depend on the computing
  parties. The engine's own proof and computation libraries are the intended mechanism.
