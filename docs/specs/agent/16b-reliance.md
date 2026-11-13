<!-- AUTHORED-BY Claude Fable 5.2 -->
# Reliance

Draft 0.4, 13 November 2026. Layer 4b. Split out of the paper's fourth gap (trust
frameworks).

**Question: how far should I rely on this, for this task?**

## What this layer decides

Authenticity says who made a statement. The trust framework says whether to accept them for
this kind of statement. Neither says how much weight this particular statement should get
now. A balance from Sam's bank is from an accepted authority, but if it is six months old it
is no use for a mortgage. Sam's own note of their salary is authentic and Sam is certainly
entitled to say it, but a payroll record should win when the two differ. A reliance suite
says how such judgments are expressed and made.

It has three parts: how quality is described in a message, how a receiver decides whether
that is good enough for a task, and which statement prevails when two disagree.

## What a reliance suite must define

- **RL-1. Quality information.** What a statement says about itself: when it was made, the
  period it covers, how it was produced (measured, recorded, reported by the subject,
  estimated, derived, produced by a model), and, if the suite uses it, how sure the source
  is.
- **RL-2. Who states it.** Which party states each item of quality information. The source
  states its own method and confidence. The receiver works out age.
- **RL-3. Thresholds.** How a receiver states what a task needs: maximum age, accepted
  methods, minimum confidence. These come from a domain profile or from the receiver's own
  policy.
- **RL-4. Precedence.** The rule that decides between conflicting statements about the same
  thing, and how the outcome is recorded (CORE-IN-14).
- **RL-5. The principal's own statements.** How a principal marks facts they supply
  themselves, including how sure they are and which kind of source should be believed over
  them (CORE-IN-15).
- **RL-6. Carrying it onward.** How quality information stays with a fact in memory and
  travels with it when it is sent on, and how a derived fact gets its quality from its
  inputs (CORE-OUT-11).
- **RL-7. Honesty about confidence.** How a number for confidence was arrived at. A number
  with no stated method MUST be treated as an opinion, and a model's own estimate of its
  confidence MUST be marked as uncalibrated unless a method is recorded.

## Which checks draw on it

Inbound fitness. Outbound evidence, which makes sure quality information goes out with each
claim and that a derived or self-reported claim is not presented as first-hand.

## Suites

| Suite | Name | Status | Builds on | Maturity of what it builds on |
|---|---|---|---|---|
| `precedence-rules` | Precedence and freshness rules | Baseline | PROV-O for sources; ranked statements | This work |
| `stated-confidence` | Stated confidence | Sketch | Data Quality Vocabulary; RDF 1.2 annotations | Draft |
| `corroboration` | Two sources must agree | Sketch | | This work |
| `quality-certificate` | Certified quality | Sketch | Data Quality Vocabulary certificates and policies | Draft |

### `precedence-rules`

No numbers. Each statement carries when it was made, the period it covers and its method,
from this list: `recorded-by-authority`, `measured`, `reported-by-subject`, `estimated`,
`derived`, `model-output`. A domain profile gives, for each kind of claim:

- the methods accepted for a task;
- the maximum age;
- an order of precedence among kinds of source.

The fitness check applies them. A statement that is too old gives `fail` with `stale-data`,
and the agent can ask for a fresh one. A statement by a method the task does not accept
gives `fail` with `method-not-accepted`. When two statements about the same thing differ,
the one from the kind of source higher in the order prevails; the other is kept and marked
`superseded-by-better-source` for that purpose.

A principal marks their own facts with a rank and, if they wish, a rule:

| Rank | Meaning |
|---|---|
| `preferred` | Use this over other sources unless a rule says otherwise |
| `normal` | Use this when nothing better is held |
| `yield-to` | Use this only until a named kind of source says otherwise, such as "a clinician" |

So Sam can record "my salary is about 52,000" as `normal`, and the payroll provider's figure
prevails when it arrives. A patient can record a health fact as `yield-to: clinician`:
probably right, but take the doctor's word over mine.

**Example.** The mortgage profile says income for an application must be
`recorded-by-authority` by a payroll provider or tax authority, no older than three months.
Sam's own figure is `reported-by-subject`. Both are in memory. The application uses the
payroll figure, and the record shows why.

### `stated-confidence`

Each statement can carry a number between 0 and 1 for how sure its source is, with the
method that produced the number and whether the uncertainty is about the world or about the
source's knowledge of it. A receiver sets a threshold per task. RL-7 applies: a confidence
with no method does not meet any threshold, and a model's own estimate is recorded as
uncalibrated. There is no standard property for confidence; the suite uses quality
measurements from the Data Quality Vocabulary attached to individual statements. Sketch
only.

### `corroboration`

A claim is relied on only when two sources that are independent of each other agree within
a stated tolerance. The suite defines what counts as independent: two statements derived
from the same record are one source. It suits claims where no single authority exists.
Sketch only.

### `quality-certificate`

A third party certifies that a data set or an index meets a stated quality policy, such as
"accurate, up to date and complete". The receiver accepts the certifier through its trust
framework suite and then relies on records from the certified source without checking each
one's quality. It suits bulk data and indexes. Sketch only.

## Open questions

- A shared list of methods (RL-1) across domains. The one above is a starting point.
- How quality combines through a derivation: the weakest input, or something finer.
- Whether precedence should ever be settled by a model. The baseline says no: the rules are
  code, and a case the rules do not settle is `indeterminate`.
