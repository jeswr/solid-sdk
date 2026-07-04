// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Term IRIs + constants for the ODRL usage-control surface (M3 of the
// agentic-Solid roadmap). This is the single source of the string IRIs the typed
// wrappers, the policy builder, the serialiser/parser and the evaluator all key on.
//
// Vocabulary policy (LD/SW best practice — reuse standards verbatim; mint NOTHING
// where a standard term exists). This package uses the REAL W3C ODRL 2.2
// Information Model + Vocabulary (W3C Recommendation, 2018) at its canonical
// namespace `http://www.w3.org/ns/odrl/2/` — see
// https://www.w3.org/TR/odrl-vocab/ . The classes, properties, action concepts,
// operators, operands, conflict strategies and constraint left-operands below are
// all standard ODRL IRIs; nothing here is minted. Adjacent standard vocabularies
// (ACL/WAC modes, DPV purpose, XSD datatypes) are reused where the roadmap binds
// ODRL to a Solid resource / a data-use purpose.

/** The canonical W3C ODRL 2.2 namespace (Information Model + Vocabulary). */
export const ODRL = "http://www.w3.org/ns/odrl/2/" as const;
/** ACL / WAC namespace — the Solid grant modes an ODRL action can map onto. */
export const ACL = "http://www.w3.org/ns/auth/acl#" as const;
/** Data Privacy Vocabulary namespace — the standard `purpose` left-operand values. */
export const DPV = "https://w3id.org/dpv#" as const;
/** XSD namespace (datatypes for typed constraint right-operands). */
export const XSD = "http://www.w3.org/2001/XMLSchema#" as const;
/** W3C PROV-O namespace — the attribution/delegation audit-trail terms. */
export const PROV = "http://www.w3.org/ns/prov#" as const;
/**
 * The `@jeswr` ODRL **agent-delegation profile** term namespace. Terms are minted
 * here ONLY for genuine gaps in ODRL 2.2 (each is documented with its rationale in
 * `docs/delegation-profile.md` §4); everything the standard already provides
 * (`odrl:grantUse`, `odrl:nextPolicy`, `odrl:transfer`, Offer/Agreement,
 * assigner/assignee) is used verbatim at its canonical IRI.
 */
export const ODRLD = "https://w3id.org/jeswr/odrl-delegation#" as const;
/**
 * The profile identifier a policy asserts via `odrl:profile` to opt in to the
 * agent-delegation profile semantics (`docs/delegation-profile.md`).
 */
export const ODRLD_PROFILE_IRI = "https://w3id.org/jeswr/odrl-delegation" as const;
/** RDF namespace. */
export const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#" as const;
/** RDFS namespace. */
export const RDFS = "http://www.w3.org/2000/01/rdf-schema#" as const;
/** Dublin Core terms namespace. */
export const DCTERMS = "http://purl.org/dc/terms/" as const;

/** `rdf:type`. */
export const RDF_TYPE = `${RDF}type` as const;

// --- ODRL classes (standard) ---------------------------------------------
/** `odrl:Policy` — the policy class (a Set/Offer/Agreement is a subtype). */
export const ODRL_POLICY = `${ODRL}Policy` as const;
/** `odrl:Set` — a Policy with no specific assigner/assignee implied. */
export const ODRL_SET = `${ODRL}Set` as const;
/** `odrl:Offer` — a Policy proposed by an assigner (offered, not yet agreed). */
export const ODRL_OFFER = `${ODRL}Offer` as const;
/** `odrl:Agreement` — a Policy agreed between an assigner and an assignee. */
export const ODRL_AGREEMENT = `${ODRL}Agreement` as const;
/** `odrl:Permission` — a permitted Rule. */
export const ODRL_PERMISSION_CLASS = `${ODRL}Permission` as const;
/** `odrl:Prohibition` — a prohibited Rule. */
export const ODRL_PROHIBITION_CLASS = `${ODRL}Prohibition` as const;
/** `odrl:Duty` — a duty/obligation Rule (a requirement of a permission). */
export const ODRL_DUTY_CLASS = `${ODRL}Duty` as const;
/** `odrl:Constraint` — a boolean condition refining a rule. */
export const ODRL_CONSTRAINT_CLASS = `${ODRL}Constraint` as const;
/** `odrl:Action` — the action concept class. */
export const ODRL_ACTION_CLASS = `${ODRL}Action` as const;

// --- ODRL policy / rule properties (standard) -----------------------------
/** `odrl:uid` — the policy's unique identifier (often the policy IRI itself). */
export const ODRL_UID = `${ODRL}uid` as const;
/** `odrl:profile` — the ODRL profile a policy conforms to. */
export const ODRL_PROFILE = `${ODRL}profile` as const;
/** `odrl:permission` — Policy → Permission rule. */
export const ODRL_PERMISSION = `${ODRL}permission` as const;
/** `odrl:prohibition` — Policy → Prohibition rule. */
export const ODRL_PROHIBITION = `${ODRL}prohibition` as const;
/** `odrl:obligation` — Policy → Duty (an obligation independent of a permission). */
export const ODRL_OBLIGATION = `${ODRL}obligation` as const;
/** `odrl:duty` — Permission → Duty (a duty that conditions a permission). */
export const ODRL_DUTY = `${ODRL}duty` as const;
/** `odrl:action` — Rule → action concept. */
export const ODRL_ACTION = `${ODRL}action` as const;
/** `odrl:target` — Rule → the Asset the rule governs. */
export const ODRL_TARGET = `${ODRL}target` as const;
/** `odrl:assigner` — Rule/Policy → the Party issuing the rule. */
export const ODRL_ASSIGNER = `${ODRL}assigner` as const;
/** `odrl:assignee` — Rule/Policy → the Party the rule is granted to. */
export const ODRL_ASSIGNEE = `${ODRL}assignee` as const;
/** `odrl:constraint` — Rule → Constraint (a refinement on the rule). */
export const ODRL_CONSTRAINT = `${ODRL}constraint` as const;
/** `odrl:conflict` — Policy → the conflict-resolution strategy. */
export const ODRL_CONFLICT = `${ODRL}conflict` as const;

// --- ODRL constraint properties (standard) --------------------------------
/** `odrl:leftOperand` — the constraint subject (e.g. `odrl:dateTime`). */
export const ODRL_LEFT_OPERAND = `${ODRL}leftOperand` as const;
/** `odrl:operator` — the constraint relational operator (e.g. `odrl:lteq`). */
export const ODRL_OPERATOR = `${ODRL}operator` as const;
/** `odrl:rightOperand` — the constraint object value. */
export const ODRL_RIGHT_OPERAND = `${ODRL}rightOperand` as const;

// --- ODRL conflict-resolution strategies (standard) -----------------------
/** `odrl:perm` — on conflict, the Permission overrides the Prohibition. */
export const ODRL_PERM = `${ODRL}perm` as const;
/** `odrl:prohibit` — on conflict, the Prohibition overrides the Permission. */
export const ODRL_PROHIBIT = `${ODRL}prohibit` as const;
/** `odrl:invalid` — on conflict, the whole Policy is void. */
export const ODRL_INVALID = `${ODRL}invalid` as const;

/** The closed set of ODRL conflict strategies. */
export const CONFLICT_STRATEGIES = ["perm", "prohibit", "invalid"] as const;
/** A conflict-resolution strategy short name. */
export type ConflictStrategy = (typeof CONFLICT_STRATEGIES)[number];
/** Map a conflict strategy short name to its full ODRL IRI. */
export const CONFLICT_IRI: Readonly<Record<ConflictStrategy, string>> = {
  perm: ODRL_PERM,
  prohibit: ODRL_PROHIBIT,
  invalid: ODRL_INVALID,
};
/** Reverse: ODRL conflict IRI → short strategy name. */
export const IRI_TO_CONFLICT: Readonly<Record<string, ConflictStrategy>> = Object.fromEntries(
  Object.entries(CONFLICT_IRI).map(([k, v]) => [v, k as ConflictStrategy]),
) as Readonly<Record<string, ConflictStrategy>>;

// --- ODRL action concepts (standard) --------------------------------------
// The common ODRL Vocabulary actions a usage-control policy over a Solid resource
// uses. The full ODRL action list is large; this is the closed working set the
// evaluator + the ACL-mode mapping recognise. Each is a real ODRL IRI.
/** `odrl:use` — the broad "use" action (the most common umbrella action). */
export const ODRL_USE = `${ODRL}use` as const;
/** `odrl:read` — read the target. */
export const ODRL_READ = `${ODRL}read` as const;
/** `odrl:write` — write/overwrite the target. */
export const ODRL_WRITE = `${ODRL}write` as const;
/** `odrl:modify` — modify the target. */
export const ODRL_MODIFY = `${ODRL}modify` as const;
/** `odrl:delete` — delete the target. */
export const ODRL_DELETE = `${ODRL}delete` as const;
/** `odrl:distribute` — distribute/share the target with others. */
export const ODRL_DISTRIBUTE = `${ODRL}distribute` as const;
/** `odrl:aggregate` — aggregate the target with other assets. */
export const ODRL_AGGREGATE = `${ODRL}aggregate` as const;
/** `odrl:index` — index the target. */
export const ODRL_INDEX = `${ODRL}index` as const;
/** `odrl:archive` — archive/store the target. */
export const ODRL_ARCHIVE = `${ODRL}archive` as const;
/** `odrl:attribute` — give attribution (a common duty action). */
export const ODRL_ATTRIBUTE = `${ODRL}attribute` as const;
/** `odrl:compensate` — pay/compensate (a common duty action). */
export const ODRL_COMPENSATE = `${ODRL}compensate` as const;
/** `odrl:inform` / `odrl:notify` — notify a party (a common duty action). */
export const ODRL_INFORM = `${ODRL}inform` as const;
/** `odrl:anonymize` — anonymise the target (a common duty action). */
export const ODRL_ANONYMIZE = `${ODRL}anonymize` as const;
/** `odrl:delete` is reused as a duty action (delete-after-use). */

// --- ODRL delegation action concepts (standard — the agent-delegation profile) ---
// The three standard ODRL 2.2 Vocabulary terms the agent-delegation profile
// (`docs/delegation-profile.md`) is built on. All three are REAL ODRL IRIs
// (https://www.w3.org/TR/odrl-vocab/ §4.4.22, §4.4.29, §3.12.2); nothing minted.
/**
 * `odrl:grantUse` — "To grant the use of the Asset to third parties." The vocab
 * note: "This action enables the assignee to create policies for the use of the
 * Asset for third parties. The nextPolicy is recommended to be agreed with the
 * third party. Use of temporal constraints is recommended." (ODRL Vocab §4.4.22.)
 * This is ODRL's native DELEGATION action: a permission on `grantUse` is what
 * authorises an agent to issue a downstream policy to a sub-agent.
 */
export const ODRL_GRANT_USE = `${ODRL}grantUse` as const;
/**
 * `odrl:nextPolicy` — "To grant the specified Policy to a third party for their
 * use of the Asset." (ODRL Vocab §4.4.29 — an ACTION concept in ODRL 2.2, not a
 * property.) Used as the action of a DUTY on a `grantUse` permission whose
 * `odrl:target` is the downstream Policy the delegate must issue — the mechanism
 * by which a delegator pins exactly what may be passed on.
 */
export const ODRL_NEXT_POLICY = `${ODRL}nextPolicy` as const;
/**
 * `odrl:transfer` — "To transfer the ownership of the Asset in perpetuity."
 * (ODRL Vocab §3.12.2.) Ownership transfer, NOT delegation-of-use; a top-level
 * action concept the vocabulary does NOT place under the `use` umbrella.
 */
export const ODRL_TRANSFER = `${ODRL}transfer` as const;

// --- ACL-mode action concepts (Solid-resource binding, NOT data-use actions) ---
// ODRL has NO native action faithful to Solid's `acl:Append` (a STRICT subclass of
// `acl:Write` — add-only, never modify/delete; WAC spec) or `acl:Control` (which
// governs the resource's ACL DOCUMENT, NOT data use; "Having acl:Control does not
// imply acl:Read or acl:Write to the resource itself" — WAC spec). Following the
// OAC profile's practice (https://w3id.org/oac — it does NOT mint per-mode ODRL
// actions, it uses the standard `acl:` mode IRIs as the `odrl:action` value), we
// expose `append`/`control` as DISTINCT action concepts backed by the standard
// `acl:Append`/`acl:Control` IRIs. Nothing is minted. Critically these do NOT
// collapse onto the data-use actions: `append` is NOT `modify`/`write`, and
// `control` is NOT `use` — see ACL_MODE_TO_ACTION + ACTION_IMPLIED_BY for why this
// is strictly safe (never broadens an Append/Control request into a wider grant).
/** `acl:Append` as an action concept — add-only access (a STRICT subclass of write). */
export const ACTION_APPEND_IRI = `${ACL}Append` as const;
/** `acl:Control` as an action concept — access to the ACL document, NOT data use. */
export const ACTION_CONTROL_IRI = `${ACL}Control` as const;

/**
 * The closed set of ODRL action short names the evaluator + builder understand.
 * A stable machine-readable enum independent of the (verbose) IRIs.
 *
 * `append` + `control` are the Solid-resource access concepts (see above): they are
 * NOT ODRL data-use actions and are deliberately narrow — see {@link ACTION_IMPLIED_BY}
 * ( `control` is NOT covered by the `use` umbrella) and {@link ACL_MODE_TO_ACTION}.
 */
export const ODRL_ACTIONS = [
  "use",
  "read",
  "write",
  "modify",
  "delete",
  "distribute",
  "aggregate",
  "index",
  "archive",
  "attribute",
  "compensate",
  "inform",
  "anonymize",
  "append",
  "control",
  "grantUse",
  "nextPolicy",
  "transfer",
] as const;
/** An ODRL action short name. */
export type OdrlActionName = (typeof ODRL_ACTIONS)[number];
/** Map an ODRL action short name to its full ODRL IRI. */
export const ACTION_IRI: Readonly<Record<OdrlActionName, string>> = {
  use: ODRL_USE,
  read: ODRL_READ,
  write: ODRL_WRITE,
  modify: ODRL_MODIFY,
  delete: ODRL_DELETE,
  distribute: ODRL_DISTRIBUTE,
  aggregate: ODRL_AGGREGATE,
  index: ODRL_INDEX,
  archive: ODRL_ARCHIVE,
  attribute: ODRL_ATTRIBUTE,
  compensate: ODRL_COMPENSATE,
  inform: ODRL_INFORM,
  anonymize: ODRL_ANONYMIZE,
  // Solid-resource access concepts — backed by the standard acl: mode IRIs (OAC
  // practice), NOT minted, and deliberately distinct from the ODRL data-use actions.
  append: ACTION_APPEND_IRI,
  control: ACTION_CONTROL_IRI,
  // Delegation concepts — standard ODRL 2.2 IRIs (see the constants above).
  grantUse: ODRL_GRANT_USE,
  nextPolicy: ODRL_NEXT_POLICY,
  transfer: ODRL_TRANSFER,
};
/** Reverse: ODRL action IRI → short action name (for round-trip read). */
export const IRI_TO_ACTION: Readonly<Record<string, OdrlActionName>> = Object.fromEntries(
  Object.entries(ACTION_IRI).map(([k, v]) => [v, k as OdrlActionName]),
) as Readonly<Record<string, OdrlActionName>>;
/** The set of valid ODRL action IRIs, for validation/round-trip. */
export const VALID_ACTION_IRIS: ReadonlySet<string> = new Set(Object.values(ACTION_IRI));

/**
 * Actions that are NOT covered by the `odrl:use` data-use umbrella. `control`
 * (= `acl:Control`) governs the resource's ACL DOCUMENT, not data use — the WAC
 * spec is explicit that "Having acl:Control does not imply acl:Read or acl:Write to
 * the resource itself". So a broad `odrl:use` (data-use) permission must NOT match a
 * `control` request — otherwise a "permit use" policy would silently grant the power
 * to rewrite the ACL. `control` is therefore implied ONLY by an explicit `control`
 * rule (fail-closed / never-broaden). All data-access actions (`read`/`write`/
 * `modify`/`append`/…) remain under the `use` umbrella as ODRL models them.
 */
/*
 * The DELEGATION actions are also excluded — a deliberate, deny-biased
 * **agent-delegation-profile RESTRICTION** of the core vocabulary hierarchy
 * (`docs/delegation-profile.md` §3.2). The ODRL 2.2 Vocabulary marks `grantUse`
 * and `nextPolicy` as "Included In: use", so under core semantics a bare
 * `odrl:use` permission would let its assignee RE-DELEGATE the asset to third
 * parties — a privilege escalation for usage control (every use-grantee could
 * mint downstream grants). This profile requires delegation authority to be
 * EXPLICIT: only a rule whose action is literally `grantUse` matches a
 * `grantUse` request (same for `nextPolicy`). `transfer` (ownership transfer)
 * is not under `use` even in the core vocabulary (it carries no `includedIn`)
 * and stays excluded here. Restricting matching is strictly safe: this
 * evaluator can only ever grant LESS than core-vocabulary semantics would.
 */
const NOT_UNDER_USE: ReadonlySet<OdrlActionName> = new Set<OdrlActionName>([
  "control",
  "grantUse",
  "nextPolicy",
  "transfer",
]);

/**
 * Extra (non-umbrella) implications from the ACL/WAC action hierarchy. Each entry
 * `requested → [implying…]` says "a rule on any of `implying` also covers a request
 * for `requested`". This is the SUBSUMPTION direction (a STRONGER grant covers a
 * WEAKER request) — strictly safe (it never lets a weaker grant cover a stronger
 * request):
 *  - `append ← write`: `acl:Append` is a STRICT SUBCLASS of `acl:Write` (WAC spec —
 *    "acl:Append is a subclass of acl:Write"; granting Write implicitly satisfies
 *    Append). So a `write` permission must also permit an `append` request. The
 *    reverse is NOT added (an `append` grant must never cover a `write`/`modify`
 *    request — that was the over-grant this whole change removes).
 */
const EXTRA_IMPLIED_BY: Partial<Record<OdrlActionName, readonly OdrlActionName[]>> = {
  append: ["write"],
};

/**
 * `odrl:use` is the broad umbrella DATA-USE action: an ODRL permission/prohibition
 * on `odrl:use` covers any more-specific data-use action. This map records, for a
 * requested concrete action, the set of policy action names that IMPLY it (the
 * requested action itself, plus `use` UNLESS the action is not a data-use action —
 * see {@link NOT_UNDER_USE}, plus any {@link EXTRA_IMPLIED_BY} subsumption). Used by
 * the evaluator to match a `use` rule against a concrete `read`/`write`/… request
 * (ODRL action-hierarchy semantics — the Vocabulary models `odrl:use` as the parent
 * via `skos:broader`).
 */
export const ACTION_IMPLIED_BY: Readonly<Record<OdrlActionName, ReadonlySet<OdrlActionName>>> =
  Object.fromEntries(
    ODRL_ACTIONS.map((a) => {
      const implied = new Set<OdrlActionName>([a]);
      // `use` is the umbrella over the data-use actions; it does not imply itself
      // via the umbrella (it is itself), and it does not cover non-data-use actions.
      if (a !== "use" && !NOT_UNDER_USE.has(a)) {
        implied.add("use");
      }
      // ACL/WAC subsumption: a stronger grant covers this weaker request.
      for (const stronger of EXTRA_IMPLIED_BY[a] ?? []) {
        implied.add(stronger);
      }
      return [a, implied];
    }),
  ) as unknown as Readonly<Record<OdrlActionName, ReadonlySet<OdrlActionName>>>;

// --- ACL / WAC modes (standard) — the Solid-resource binding ---------------
/** `acl:Read`. */
export const ACL_READ = `${ACL}Read` as const;
/** `acl:Write`. */
export const ACL_WRITE = `${ACL}Write` as const;
/** `acl:Append`. */
export const ACL_APPEND = `${ACL}Append` as const;
/** `acl:Control`. */
export const ACL_CONTROL = `${ACL}Control` as const;
/** An ACL mode short name. */
export const ACL_MODES = ["Read", "Write", "Append", "Control"] as const;
/** An ACL mode short name. */
export type AclMode = (typeof ACL_MODES)[number];

/**
 * Map a Solid WAC access mode to the ODRL action it corresponds to, so an ODRL
 * usage-control policy can be evaluated against a WAC-style request. This is the
 * roadmap's "an ODRL policy attaches to a Solid resource" binding (the OAC profile
 * derives WAC from ODRL — here we go the other direction for evaluation).
 *
 * STRICTLY-SAFE mapping (each mode → its FAITHFUL, non-broadening action):
 *  - `Read`    → `read`    (faithful)
 *  - `Write`   → `write`   (faithful)
 *  - `Append`  → `append`  — NOT `modify`. `acl:Append` is a STRICT subclass of
 *    `acl:Write` (add-only; never modify/delete — WAC spec). The previous
 *    `Append → modify` was an OVER-GRANT: it conflated add-only access with full
 *    data mutation, so an append-only intent compiled to `modify` and a `modify`
 *    rule wrongly matched an Append request. `append` is its own narrow action
 *    (backed by `acl:Append`); an Append request is covered by the `use` umbrella
 *    (it IS a data-access mode) and by a `write` rule (WAC: `acl:Append` is a
 *    subclass of `acl:Write`, so granting Write satisfies Append — see
 *    {@link ACTION_IMPLIED_BY}), but NEVER by a `modify` rule, and an `append` grant
 *    NEVER covers a `write`/`modify` request.
 *  - `Control` → `control` — NOT `use`. `acl:Control` governs the ACL DOCUMENT, not
 *    data use ("Having acl:Control does not imply acl:Read or acl:Write to the
 *    resource itself" — WAC spec). The previous `Control → use` was a serious
 *    OVER-GRANT: a Control request matched ANY data-use permission, and a Control
 *    grant compiled to the broad data-use umbrella. `control` is its own action
 *    (backed by `acl:Control`) and is deliberately OUTSIDE the `use` umbrella (see
 *    {@link ACTION_IMPLIED_BY} / {@link NOT_UNDER_USE}) — a "permit use" data policy
 *    can never grant ACL control.
 *
 * Net effect: every mode now maps to a STRICTLY NARROWER-or-equal action than
 * before — this mapping NEVER broadens an Append/Control request into a wider grant.
 */
export const ACL_MODE_TO_ACTION: Readonly<Record<AclMode, OdrlActionName>> = {
  Read: "read",
  Write: "write",
  Append: "append",
  Control: "control",
};

// --- ODRL constraint left-operands (standard) -----------------------------
/** `odrl:dateTime` — a temporal constraint (the request time). */
export const ODRL_DATETIME = `${ODRL}dateTime` as const;
/** `odrl:purpose` — the purpose-of-use constraint (DPV-valued). */
export const ODRL_PURPOSE = `${ODRL}purpose` as const;
/** `odrl:recipient` — the recipient party constraint. */
export const ODRL_RECIPIENT = `${ODRL}recipient` as const;
/** `odrl:count` — a use-count constraint. */
export const ODRL_COUNT = `${ODRL}count` as const;
/** `odrl:spatial` — a spatial/jurisdiction constraint. */
export const ODRL_SPATIAL = `${ODRL}spatial` as const;
/** `odrl:elapsedTime` — a duration constraint. */
export const ODRL_ELAPSED_TIME = `${ODRL}elapsedTime` as const;
/** `odrl:systemDevice` — the requesting device/system constraint. */
export const ODRL_SYSTEM_DEVICE = `${ODRL}systemDevice` as const;
/**
 * `odrld:delegationDepth` — MINTED (agent-delegation profile, see
 * `docs/delegation-profile.md` §4.1): the number of delegation hops remaining at
 * and below a `grantUse` permission. ODRL 2.2 has NO left-operand for bounding
 * re-delegation depth (its operand list — dateTime, count, recipient, … — is
 * about direct use, not chain shape), and `odrl:count` counts EXERCISES of an
 * action, not the depth of a downstream chain, so reusing it would be a semantic
 * pun. A `grantUse` permission constrains re-delegation with
 * `odrld:delegationDepth odrl:lteq N`; the chain evaluator supplies the actual
 * remaining depth as the request value (callers never assert it — see
 * `evaluateDelegated`). Absent the constraint, the profile default is depth 1
 * (delegate may NOT re-delegate) — fail-closed.
 */
export const ODRLD_DELEGATION_DEPTH = `${ODRLD}delegationDepth` as const;

/** The closed set of constraint left-operand short names the evaluator handles. */
export const LEFT_OPERANDS = [
  "dateTime",
  "purpose",
  "recipient",
  "count",
  "spatial",
  "elapsedTime",
  "systemDevice",
  "delegationDepth",
] as const;
/** A constraint left-operand short name. */
export type LeftOperandName = (typeof LEFT_OPERANDS)[number];
/** Map a left-operand short name to its full ODRL IRI. */
export const LEFT_OPERAND_IRI: Readonly<Record<LeftOperandName, string>> = {
  dateTime: ODRL_DATETIME,
  purpose: ODRL_PURPOSE,
  recipient: ODRL_RECIPIENT,
  count: ODRL_COUNT,
  spatial: ODRL_SPATIAL,
  elapsedTime: ODRL_ELAPSED_TIME,
  systemDevice: ODRL_SYSTEM_DEVICE,
  delegationDepth: ODRLD_DELEGATION_DEPTH,
};
/** Reverse: left-operand IRI → short name. */
export const IRI_TO_LEFT_OPERAND: Readonly<Record<string, LeftOperandName>> = Object.fromEntries(
  Object.entries(LEFT_OPERAND_IRI).map(([k, v]) => [v, k as LeftOperandName]),
) as Readonly<Record<string, LeftOperandName>>;

// --- ODRL constraint operators (standard) ---------------------------------
/** `odrl:eq` — equal to. */
export const ODRL_EQ = `${ODRL}eq` as const;
/** `odrl:neq` — not equal to. */
export const ODRL_NEQ = `${ODRL}neq` as const;
/** `odrl:gt` — greater than. */
export const ODRL_GT = `${ODRL}gt` as const;
/** `odrl:gteq` — greater than or equal. */
export const ODRL_GTEQ = `${ODRL}gteq` as const;
/** `odrl:lt` — less than. */
export const ODRL_LT = `${ODRL}lt` as const;
/** `odrl:lteq` — less than or equal. */
export const ODRL_LTEQ = `${ODRL}lteq` as const;
/** `odrl:isAnyOf` — the request value is one of a set. */
export const ODRL_IS_ANY_OF = `${ODRL}isAnyOf` as const;
/** `odrl:isAllOf` — the request value(s) cover a set. */
export const ODRL_IS_ALL_OF = `${ODRL}isAllOf` as const;
/** `odrl:isNoneOf` — the request value is none of a set. */
export const ODRL_IS_NONE_OF = `${ODRL}isNoneOf` as const;

/** The closed set of constraint operator short names the evaluator handles. */
export const OPERATORS = [
  "eq",
  "neq",
  "gt",
  "gteq",
  "lt",
  "lteq",
  "isAnyOf",
  "isAllOf",
  "isNoneOf",
] as const;
/** A constraint operator short name. */
export type OperatorName = (typeof OPERATORS)[number];
/** Map an operator short name to its full ODRL IRI. */
export const OPERATOR_IRI: Readonly<Record<OperatorName, string>> = {
  eq: ODRL_EQ,
  neq: ODRL_NEQ,
  gt: ODRL_GT,
  gteq: ODRL_GTEQ,
  lt: ODRL_LT,
  lteq: ODRL_LTEQ,
  isAnyOf: ODRL_IS_ANY_OF,
  isAllOf: ODRL_IS_ALL_OF,
  isNoneOf: ODRL_IS_NONE_OF,
};
/** Reverse: operator IRI → short name. */
export const IRI_TO_OPERATOR: Readonly<Record<string, OperatorName>> = Object.fromEntries(
  Object.entries(OPERATOR_IRI).map(([k, v]) => [v, k as OperatorName]),
) as Readonly<Record<string, OperatorName>>;

// --- Agent-delegation profile: chain-edge + revocation terms (minted) ------
// Minted `odrld:` terms for the two genuine ODRL 2.2 gaps the delegation profile
// hits beyond depth-bounding. Rationale per term in docs/delegation-profile.md §4.
/**
 * `odrld:delegatedUnder` — MINTED (delegation profile §4.2): Policy → Policy, "this
 * policy was issued under the authority of that policy" (the child self-declares
 * its UPSTREAM authority). ODRL's own `nextPolicy` points DOWNSTREAM from the
 * delegator's duty; a verifier holding only the leaf grant needs the explicit
 * reverse edge to assemble + check the chain. `prov:wasDerivedFrom` alone is too
 * loose (any derivation) for a fail-closed authority check, so this is declared a
 * subproperty of it: every `delegatedUnder` edge is still visible to generic
 * PROV consumers.
 */
export const ODRLD_DELEGATED_UNDER = `${ODRLD}delegatedUnder` as const;
/**
 * `odrld:Revocation` — MINTED (delegation profile §4.3): the class of a revocation
 * statement an assigner publishes to withdraw a previously issued delegation
 * policy. ODRL 2.2 has no revocation vocabulary at all (expiry is expressible via
 * `odrl:dateTime` constraints; withdrawal-before-expiry is not).
 */
export const ODRLD_REVOCATION_CLASS = `${ODRLD}Revocation` as const;
/** `odrld:revokedPolicy` — MINTED (with {@link ODRLD_REVOCATION_CLASS}): Revocation → the revoked Policy. */
export const ODRLD_REVOKED_POLICY = `${ODRLD}revokedPolicy` as const;

// --- PROV-O attribution terms (standard) — the delegation audit trail ------
/** `prov:wasAttributedTo` — Entity → Agent (each hop policy is attributed to its issuer). */
export const PROV_WAS_ATTRIBUTED_TO = `${PROV}wasAttributedTo` as const;
/** `prov:actedOnBehalfOf` — Agent → Agent (the delegate acts on behalf of the delegator). */
export const PROV_ACTED_ON_BEHALF_OF = `${PROV}actedOnBehalfOf` as const;
/** `prov:wasDerivedFrom` — Entity → Entity (the generic super-property of `odrld:delegatedUnder`). */
export const PROV_WAS_DERIVED_FROM = `${PROV}wasDerivedFrom` as const;

/**
 * A SELF-CONTAINED inline JSON-LD `@context` for an ODRL policy graph. Like M1/M2,
 * the emitted JSON-LD embeds this rather than a bare remote `@context` URL, so the
 * document parses with NO network (offline + deterministic) and carries no
 * SSRF / availability dependency on a remote context endpoint. The aliases match
 * the standard ODRL JSON-LD context term names. Object/IRI-valued terms carry
 * `"@type": "@id"` so a `{ "@id": … }` value parses as an IRI node.
 */
export const ODRL_INLINE_CONTEXT: Readonly<Record<string, unknown>> = {
  odrl: ODRL,
  acl: ACL,
  dpv: DPV,
  uid: { "@id": ODRL_UID, "@type": "@id" },
  profile: { "@id": ODRL_PROFILE, "@type": "@id" },
  permission: { "@id": ODRL_PERMISSION, "@type": "@id" },
  prohibition: { "@id": ODRL_PROHIBITION, "@type": "@id" },
  obligation: { "@id": ODRL_OBLIGATION, "@type": "@id" },
  duty: { "@id": ODRL_DUTY, "@type": "@id" },
  action: { "@id": ODRL_ACTION, "@type": "@id" },
  target: { "@id": ODRL_TARGET, "@type": "@id" },
  assigner: { "@id": ODRL_ASSIGNER, "@type": "@id" },
  assignee: { "@id": ODRL_ASSIGNEE, "@type": "@id" },
  constraint: { "@id": ODRL_CONSTRAINT, "@type": "@id" },
  conflict: { "@id": ODRL_CONFLICT, "@type": "@id" },
  leftOperand: { "@id": ODRL_LEFT_OPERAND, "@type": "@id" },
  operator: { "@id": ODRL_OPERATOR, "@type": "@id" },
  rightOperand: ODRL_RIGHT_OPERAND,
} as const;

/**
 * The delegation-profile EXTENSION of {@link ODRL_INLINE_CONTEXT}: added to the
 * emitted JSON-LD `@context` ONLY when the policy actually uses a profile term
 * (currently `delegatedUnder`), so a plain ODRL policy's JSON-LD projection is
 * byte-identical to what it was before the profile existed.
 */
export const ODRLD_INLINE_CONTEXT_EXTENSION: Readonly<Record<string, unknown>> = {
  odrld: ODRLD,
  delegatedUnder: { "@id": ODRLD_DELEGATED_UNDER, "@type": "@id" },
} as const;
