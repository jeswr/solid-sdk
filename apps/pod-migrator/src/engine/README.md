<!-- AUTHORED-BY Codex GPT-6 -->

# Migration engine safety notes

The public contract is `index.ts`. `planMigration` performs reads only. `finalizePlan` requires
an explicit valid choice for every decision item and proves the resulting access policies do
not widen access. Executable plans carry a private snapshot, are bound to the original two
sessions, and are single-use. Downloaded JSON is a report, not a resumable executable plan.

The offline CSS 7.2 and `@solid/access-control-policy` implementations resolve ambiguities in
DESIGN.md as follows. These notes are colocated with the engine because this lane does not own
the design document.

- ACP matcher values are ORed within one attribute; different attributes are ANDed. The design's
  statement that all matcher attributes are alternatives would widen access. The reader preserves
  the intersections. Clause expansion is bounded at 64. Conjunctive `noneOf` expressions that the
  neutral model cannot represent produce a `too-complex` decision, with owner-only/skip/abort.
- CSS uses ACL mode IRIs in ACP policies and evaluates policies protecting the ACR URL itself.
  ESS-style ACP mode IRIs and `acp:access` policies are supported separately in `systems/acp.ts`.
  The root document determines the dialect. Live PodSpaces behavior still needs account testing.
- A WAC 404 means that an own ACL is absent, so the nearest ancestor's defaults apply. ACP 404s
  contribute no own controls. A 403, parsing failure, or failed request makes the policy unknown;
  it never causes permissive inheritance. Uncertainty propagates conservatively to descendants.
- Creating an empty resource before locking it can already expose access through its parent or
  a pre-existing orphan ACL. The engine proves the initial target permissions safe before creation
  and requires that the target owner retains control. Unsafe target inheritance is refused;
  owner-only output cannot remove additive ACP ancestor grants. Unknown target systems must abort.
- Placeholder resources are created with `If-None-Match: *`, then locked, then filled using the
  placeholder's ETag. Existing content is overwritten only by explicit choice with its reviewed
  ETag and unchanged safe target permissions. Missing validators cause a safe failure.
- Grants are installed deepest first. WAC-to-ACP uses explicit controls on existing resources and
  owner-only member controls, with a `per-resource` decision; future children receive no shared
  grants. Other model pairs retain safely translated member controls. Finalization also proves
  the effect of all generated ACP ancestor controls together.
- Root merging preserves original RDF, including unrelated triples and existing member controls;
  it adds only resource grants under distinct rule identifiers and requires the reviewed ACL ETag.
  Target WebID documents and advertised auxiliary resources are protected. Encoded auxiliary
  suffixes and encoded profile path aliases receive the same protection as their decoded forms.
- Owner/creator grants map to the target owner. Source-owner grants remain verbatim. Owner roles
  in exclusions and denials retain the source owner's identity. The original creator identity
  cannot be established from an ACR alone: creator exclusions drop the grant, and creator denials
  remove every possibly denied mode. Denials always exempt the target owner on the target side.
- Group expansion uses only an in-fence, plan-time membership snapshot and warns that future
  membership changes do not follow. Foreign groups cannot be expanded through a credentialed
  transport. The snapshot is rechecked before execution.
- RDF rewriting is opt-in. Parsed term positions are mapped; literal text stays untouched.
  Rewritten data uses TriG so named graphs survive. Default copying preserves the source bytes.
  Partial representations and redirects are refused. No remote JSON-LD contexts are fetched.

Before the first write the executor rechecks relevant source and target controls, group snapshots,
content validators, and root-merge validators. It checks source permissions again before each grant.
These checks detect stale review decisions; they cannot provide a transaction across independent
pods. Concurrent external permission edits after a check are outside the migration's control.
Cancellation stops subsequent requests after the current safe unit, finishing an owner-only lock
when necessary. No rollback broadens or restores old permissions. Logs and the final result are
saved to sessionStorage when available, without depending on browser storage succeeding.

The in-memory LDP tests implement WAC nearest-ACL replacement and ACP additive inheritance with
deny precedence independently of the engine's readers and proof code. They check anonymous and
stranger access after each write, ownership, stale plans, path/redirect fences, conditional
writes, cancellation, every translation construct, RDF rewriting, and read-back verification.
The engine coverage gate requires 100% lines, branches, functions, and statements.
