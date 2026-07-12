# 0006 — F4 time tracking + F7 permission roles

**Status:** accepted · **Date:** 2026-06-15

Jira/Monday parity items F4 (per-issue time tracking with rollups) and F7 (named
permission roles). Both reuse published, dereferenceable vocabularies — no minted
terms (`docs/data-modelling.md`) — all RDF through the typed `@rdfjs/wrapper`
accessors, and the F7 WAC writes through the existing `sharing.ts` accessors
(never hand-built ACL triples). `AUTHORED-BY Claude Opus 4.8`.

## F4 — time tracking (worklog + OWL-Time, opt-in)

**Estimate stays `dct:extent`.** The existing numeric estimate (story points) is
unchanged — F4 adds *logged work*, not a second estimate predicate.

**A worklog entry is a `prov:Activity`** (the same family as the F3 activity log),
typed `dct:type "worklog"`, carrying:

- `prov:used` → the issue IRI it logs against (the same back-link the F3 log uses),
- `prov:wasAssociatedWith` → who logged it, `prov:startedAtTime` → when,
- `dct:description` → an optional note,
- `time:hasDuration` → an OWL-Time `time:Duration` node (`<entry>-dur`) carrying
  `time:numericDuration` (xsd:decimal **seconds**) and `time:unitType time:unitSecond`.

One **canonical unit (seconds)** so figures sum across a subtree with no
conversion. The duration magnitude is `xsd:decimal` (OWL-Time's `numericDuration`
range), written via `LiteralFrom.datatypeTuple` and read with `LiteralAs.number`.

- **Storage:** worklog entries live in the **issue's own document** (unlike the F3
  log, which is paginated into a sibling `activity/` container) — they round-trip
  with the issue and need no extra fetch to render. `Issue.worklog` reads every
  `prov:Activity` of `dct:type "worklog"` in the document (so F3 status/assignment
  entries sharing a doc are never miscounted). **Append-only:** `Issue.logWork`
  mints a fresh `#work-<uuid>` node; existing entries are never mutated.
- **Rollup:** `Rollup.loggedSeconds` sums logged time over the whole subtree via
  the same cycle-safe `dct:isPartOf` walk as the other rollups. Unlike
  `estimate`/`done` (descendants only), logged time **includes the issue's own
  work**, so a parent's total reflects effort spent on it directly too.
- **UI:** the issue-detail dialog gains a Time-tracking panel (estimate, logged
  this-issue, logged incl. sub-tasks, the entry list, and a free-text log-work form
  parsed by `parseDuration` — "1h 30m" / "90m" / "1.5h" / bare-minutes).

## F7 — permission roles (named presets → WAC mode bundles)

Three named role presets map to WAC mode bundles (`src/lib/roles.ts`):

- **Viewer** → `acl:Read`
- **Editor** → `acl:Read` + `acl:Write` (commenting writes the issue doc, so it
  needs Write — there is no append-only "comment" mode in this app's WAC subset)
- **Admin** → `acl:Read` + `acl:Write` + `acl:Control`

The role **model** is pure data (the `ROLE_PRESETS` map is the single source of the
role→WAC mapping; `accessForRole` / `capabilitiesForRole` / `roleForAccess` derive
from it). **Applying** a role goes through the existing typed WAC accessors
(`assignRole`/`assignGroupRole` → `sharing.ts` `setAccess`/`setGroupAccess`), so the
owner is always preserved and no ACL triple is hand-built. `roleForAccess` (the
inverse) reads an existing grant back as its named role for the UI; it never
*promotes* — a malformed grant lacking read maps to no role rather than to a higher
one. The Share dialog now offers Viewer/Editor/Admin and lists each grant by role.

Out of scope (per the bead): field-level permissions and server-administered
enterprise permission schemes.

## SHACL

`shapes/issue.ttl` gains:

- A `time:Duration` node shape — required `time:numericDuration` (xsd:decimal, =1)
  and `time:unitType` (IRI, =1). A duration with no magnitude or no unit is rejected.
- The `prov:Activity` shape gains an (inert-for-non-worklog) `time:hasDuration`
  (IRI, ≤1) and `dct:description` (string, ≤1). A worklog entry is also a
  `prov:Activity`, so the F3 activity shape (required `prov:startedAtTime`, single
  IRI `prov:used`, http actor) holds for it unchanged — the two coexist on one node.

## Follow-up

- Federating worklog entries across pods (a cross-pod time-tracking roll-up) has
  the same O1-gated federation `@context` dependency the F3 cross-pod audit trail
  does (decision 0005); out of scope here.
