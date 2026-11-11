<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/pod-legacy

A security-critical, generated record of recovery and digital legacy wishes. This first slice
**never applies a grant**. `proposedGrants` returns `pod-access` descriptions for review only;
there is no executor, timer, background delivery or automatic enforcement.

`legacy.ttl`, `legacy.shacl.ttl` and `codegen.config.json` generate `src/generated/` using
`@jeswr/federation-codegen`; the byte-for-byte regeneration test covers all artifacts. Do not
edit generated files. The identity sector models people and claims, not inactivity plans, so
this package has its own profile. It reuses Dublin Core creator/created/modified, schema.org
contentUrl/url/isActive/lastInteractionDate, vCard fn, and ODRL target/action. Only LegacyPlan,
LegacyContact and plan-specific contact/scope/inactivityMonths/warningDays/notifyMeBy are minted
under `NS.LEGACY` (`https://jeswr.org/ns/legacy#`). Required SHACL fields fail closed. Contacts
are generated entities linked inside the same document; no remote contact data is fetched.

- `serializePlan(url, plan)` / `buildPlan` / `parsePlan`: generated RDF access and the ODRL policy.
- `evaluatePlan(plan, now)`: disabled, active, warning (level 1, 2, …), or due, with nextCheck
  and ceil-rounded daysUntilDue. Invalid inputs/clocks are disabled with reason invalid-plan.
- `dueDate`: UTC calendar months with month-end clamping, bounded to 120,000 months (10,000 years)
  and JavaScript's date range. Future activity delays the schedule rather than shortening it.
- `recordActivity`: immutable update after at least 24 hours; no backward timestamps, no repair
  of malformed plans. The app invokes it only after a trusted pointer or keyboard interaction when a plan already exists.
  Silent session restoration is not activity. `boundedNow` caps a fast device clock to five minutes
  beyond server time; the suite advances the load response’s Date (Last-Modified fallback) with a
  monotonic clock and uses that same bound for heartbeats, warnings and new-plan timestamps.
  Missing/invalid server time disables heartbeats and warnings until a dated response is observed.
- `proposedGrants`: read only, explicit targets with inheritance, never performs I/O. Disabled
  plans can still be previewed. Malformed plans have no proposals.
- `planPolicy`: standard ODRL read permissions, assignee = exact contact WebID, target = exact
  selected container. Calendar inactivity is lowered to `odrl:dateTime gteq` the computed
  deadline. `elapsedTime` measures a period of action usage rather than activity on this account;
  a dateTime threshold avoids inventing an operand or incorrectly treating calendar months as
  fixed durations. Activity regenerates the policy. Disabled/invalid plans have no permissions.
  This policy is advisory; **it does not authorise an access-control write**.

`createLegacyStore({storage, owner, fetch})` uses `settings/legacy-plan.ttl`. `load()` returns
null only for a missing resource, otherwise a validated private `{plan, etag}`. A zero-byte
resource returns `{plan: null, etag}` after the privacy proof. Fill that placeholder with its
strong ETag; it is never an invalid plan or a create-only retry. Nonempty bodies remain subject
to generated validation. Raw and RDF reads must have the same ETag. `save(plan, etag)`
is conditional; use null only for initial creation. `delete(etag)` conditionally removes the plan after the same privacy proof. No automatic conflict retries. New resources
start empty. Initial saves first verify the settings folder’s future-member access, then verify
the created resource itself; no plan content is sent until both checks pass. It never edits an ACL.

The first storage adapter supports WAC Solid only. It pins the access model through pod-access
and reads the advertised own/nearest ancestor ACL with pod-access's conservative WAC reader.
It checks **all modes**, including partial Write/Control rights omitted by role projections,
and refuses any principal other than the owner. Owner Read, Write and Control are required.
Missing, ambiguous, unreadable, conditional, unknown, ACP or LWS access fails closed with
`LegacyPrivacyError`. Make settings owner-private using the access manager before saving.
The fictional demo pod has matching owner-only ACL metadata, but is a local fixture without
real server enforcement; do not use it as evidence of deployed protection.

Content ETags protect concurrent edits. ACL verification and content persistence are separate
requests: a server-side ACL change can race a save. Transactional access proofs and other access
models need a separately reviewed adapter. A refused first save can leave an **empty** placeholder
and settings container; it never leaves plan contents there. If a write response supplies no
reliable strong validator, save reloads the complete private snapshot and its strong ETag before
returning. A heartbeat that loses a two-tab race reloads the winning snapshot and skips its write.
Disabled plans may have no contacts; enabled plans still require at least one.
The facade rejects any raw contact term dropped by the generated optional-set projection, so
malformed contact links cannot leave a partially accepted plan eligible for evaluation.

## Enforcement slice

The installed `@jeswr/solid-odrl` evaluator supports exact target IRI matching, without
`odrl:AssetCollection` / `odrl:partOf` asset resolution. A permission for a container does **not**
permit reads of its descendants. Proposed `pod-access` grants describe inheritance, but this ODRL
snapshot cannot enforce that part of the intent. No access-control writes happen in this slice.
A future enforcer needs a reviewed descendant/collection resolution mechanism and must default deny.

An enforcer must **never pass requester-controlled `request.attributes`** to the evaluator:
solid-odrl reads `attributes.dateTime` before its trusted `now` option. Construct the evaluation
request from trusted inputs and supply the trusted evaluation clock. “Activity” must mean an
actual user interaction, never a silent sign-in/session restore or background refresh.

Settings and everything below `<storage>settings/` (including encoded aliases and the plan itself)
are forbidden targets. Whole-pod scope is a snapshot of explicitly listed top-level containers
except settings, with one inherited read proposal per container. It excludes the root, root-level
files, and containers created after the snapshot. The UI lists the folders included in the preview;
recreate the contact to refresh its scope. A whole-pod root IRI from older plans is refused rather
than silently proposing access to settings. Disabled empty-contact plans round-trip through the
generated model; conditional deletion withdraws the plan without changing ACLs or profiles.

Warnings use Settings and optionally the notification tray while the app runs; notifyMeBy records
only those supported channels. This is not a promise of email or unattended warnings. Export
history belongs to the future export feature. No dependency on pod-export is introduced.

Run dependency-first build, lint, typecheck, test (100% per-file coverage), root codegen/layer
checks, and the suite's recovery-and-legacy Playwright flow before handing off.
