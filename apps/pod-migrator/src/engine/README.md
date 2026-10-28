<!-- AUTHORED-BY Codex GPT-6 -->

# Migration engine safety notes

The public contract is `index.ts`. `planMigration` performs reads only. `finalizePlan` requires
an explicit valid choice for every decision item and proves the resulting access policies do
not widen access. Executable plans carry a private snapshot, are bound to the original two
sessions, and are single-use. Downloaded JSON is a report, not a resumable executable plan.

The offline CSS 7.2 and `@solid/access-control-policy` implementations resolve ambiguities in
DESIGN.md as follows. These notes are colocated with the engine and reflected in the design document.

- ACP matcher values are ORed within one attribute; different attributes are ANDed. The design's
  statement that all matcher attributes are alternatives would widen access. The reader preserves
  the intersections. Clause expansion is bounded at 64. Conjunctive `noneOf` expressions that the
  neutral model cannot represent produce a `too-complex` decision, with owner-only/skip/abort.
- **Reading SOURCE:** take the most restrictive plausible interpretation across server dialects.
  An uncertain grant is not granted and produces a report with skip/abort (an uninterpretable
  document offers owner-only/skip/abort); an uncertain denial or exclusion counts as applying.
  This includes ESS/CSS/NSS differences, legacy `acl:defaultForNew`, ACR-self policies,
  `acp:access`, ACP-namespace modes and typed ACRs without `acp:resource`.
- CSS 7.2 uses ACL mode IRIs and resource Control. Its configured `AuthAuxiliaryReader` derives
  ACR access from that Control; ACR-self Read/Write and `acp:access` do not grant resource Control.
  ESS source forms are accepted only with independently established ESS semantics, documented in
  `systems/acp.ts`. `PodSide.implementation` is a trusted caller assertion, never inferred from
  editable RDF or mode IRIs. ACP target writes without established CSS/ESS semantics abort.
  Live PodSpaces behavior still needs account testing; the browser connection currently leaves
  implementation unestablished, so ACP target writes fail closed until a trusted integration
  supplies that assertion. Missing owner Control at creation also fails closed on ESS.
- **Writing TARGET:** never rely on a condition the target might not enforce. CSS 7.2's configured
  WAC checker chain ignores `acl:origin`, so origin-restricted grants are unsupported on every
  WAC and ACP target: skip the affected clause or abort, never preserve or remove only its origin.
  CSS ignores `acl:defaultForNew`; it is accepted only for an established NSS source. Writers
  emit `acl:default`, and CSS ACP output uses resource Control without ineffective ACR-self or
  `acp:access` grants. Target reads reject ambiguous denials and role matchers rather than relying
  on them to mask actual grants. Only CSS 7.2 source-established enforcement or the explicitly
  selected ESS behavior in `systems/acp.ts` may be emitted.
- CSS applies Write→Append implication after ACP denial subtraction. Source denials remain
  conservative; output denials of either Write or Append cover both. Existing target denials
  of just one are refused because their derived Append behavior needs a richer neutral model.
  CSS supplies no owner/creator/VC matcher context; uncertain exclusions cannot weaken a
  source denial, and cannot be trusted as target restrictions.
- CSS selects policies from every `acp:resource` statement, choosing access controls for
  matching IRIs and member controls otherwise. Foreign-node denials are conservatively retained;
  unplaceable grants and unknown/detached constructs fail closed. Target scopes must be exclusive
  during parsing and verification, preventing an ineffective denial from masking a broader grant.
- Target inventory includes existing siblings and the profile even when review skips them. Shared
  access URLs and foreign resource bindings are refused before ACL PUTs, including newly created
  placeholders. Final verification proves the owner retains root access including Control.
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
- **Planning against TARGET:** replay the actual access documents after each creation, lock,
  copy and bottom-up grant, checking every affected resource. Replaced documents contribute none
  of their old denials or exclusions. Retained skip/overwrite documents and root merges keep
  their actual policies. Repeat the phase proof on fresh target documents before writing;
  unchanged initial permissions alone cannot expose a root change masked by a replaced denial.
- Root merging preserves original RDF, including unrelated triples and existing member controls;
  it adds only resource grants under distinct rule identifiers and requires the reviewed ACL ETag.
  Target WebID documents and advertised auxiliary resources are protected. Encoded auxiliary
  suffixes and encoded profile path aliases receive the same protection as their decoded forms.
- Owner/creator grants map to the target owner. Source-owner grants remain verbatim. Owner roles
  in grant exclusions and denial subjects retain the source owner's identity. Uncertain
  owner/creator/VC exclusions on source denials are removed to keep those denials restrictive.
  The original creator identity
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

The in-memory LDP tests default to CSS 7.2 semantics: origin ignored, defaultForNew ignored,
ACL mode IRIs used verbatim, and ACR access derived from resource Control. Explicit `ess`/`nss`
fixture options exercise the alternative mode, ACR-self/`acp:access`, typed-root and legacy WAC
semantics where relevant. WAC nearest-ACL replacement and ACP additive inheritance with deny
precedence are evaluated independently of the engine's readers and proof code. Tests check anonymous and
stranger access after each write, ownership, stale plans, path/redirect fences, conditional
writes, cancellation, every translation construct, RDF rewriting, and read-back verification.
The engine coverage gate requires 100% lines, branches, functions, and statements.
