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
  of malformed plans. The app invokes it after sign-in/restore only when a plan already exists.
- `proposedGrants`: read only, explicit targets with inheritance, never performs I/O. Disabled
  plans can still be previewed. Malformed plans have no proposals.
- `planPolicy`: standard ODRL read permissions, assignee = exact contact WebID, target = exact
  selected container/root. Calendar inactivity is lowered to `odrl:dateTime gteq` the computed
  deadline. `elapsedTime` measures a period of action usage rather than activity on this account;
  a dateTime threshold avoids inventing an operand or incorrectly treating calendar months as
  fixed durations. Activity regenerates the policy. Disabled/invalid plans have no permissions.
  This policy is advisory; **it does not authorise an access-control write**.

`createLegacyStore({storage, owner, fetch})` uses `settings/legacy-plan.ttl`. `load()` returns
null only for a missing resource, otherwise a validated private `{plan, etag}`. `save(plan, etag)`
is conditional; use null only for initial creation. No automatic conflict retries. New resources
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
reliable validator, the returned etag is empty: reload before editing again.

Warnings use Settings and optionally the notification tray while the app runs; notifyMeBy records
only those supported channels. This is not a promise of email or unattended warnings. Export
history belongs to the future export feature. No dependency on pod-export is introduced.

Run dependency-first build, lint, typecheck, test (100% per-file coverage), root codegen/layer
checks, and the suite's recovery-and-legacy Playwright flow before handing off.
