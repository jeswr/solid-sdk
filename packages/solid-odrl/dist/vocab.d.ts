/** The canonical W3C ODRL 2.2 namespace (Information Model + Vocabulary). */
export declare const ODRL: "http://www.w3.org/ns/odrl/2/";
/** ACL / WAC namespace — the Solid grant modes an ODRL action can map onto. */
export declare const ACL: "http://www.w3.org/ns/auth/acl#";
/** Data Privacy Vocabulary namespace — the standard `purpose` left-operand values. */
export declare const DPV: "https://w3id.org/dpv#";
/** XSD namespace (datatypes for typed constraint right-operands). */
export declare const XSD: "http://www.w3.org/2001/XMLSchema#";
/** W3C PROV-O namespace — the attribution/delegation audit-trail terms. */
export declare const PROV: "http://www.w3.org/ns/prov#";
/**
 * The `@jeswr` ODRL **agent-delegation profile** term namespace. Terms are minted
 * here ONLY for genuine gaps in ODRL 2.2 (each is documented with its rationale in
 * `docs/delegation-profile.md` §4); everything the standard already provides
 * (`odrl:grantUse`, `odrl:nextPolicy`, `odrl:transfer`, Offer/Agreement,
 * assigner/assignee) is used verbatim at its canonical IRI.
 */
export declare const ODRLD: "https://w3id.org/jeswr/odrl-delegation#";
/**
 * The profile identifier a policy asserts via `odrl:profile` to opt in to the
 * agent-delegation profile semantics (`docs/delegation-profile.md`).
 */
export declare const ODRLD_PROFILE_IRI: "https://w3id.org/jeswr/odrl-delegation";
/** RDF namespace. */
export declare const RDF: "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
/** RDFS namespace. */
export declare const RDFS: "http://www.w3.org/2000/01/rdf-schema#";
/** Dublin Core terms namespace. */
export declare const DCTERMS: "http://purl.org/dc/terms/";
/** `rdf:type`. */
export declare const RDF_TYPE: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
/** `odrl:Policy` — the policy class (a Set/Offer/Agreement is a subtype). */
export declare const ODRL_POLICY: "http://www.w3.org/ns/odrl/2/Policy";
/** `odrl:Set` — a Policy with no specific assigner/assignee implied. */
export declare const ODRL_SET: "http://www.w3.org/ns/odrl/2/Set";
/** `odrl:Offer` — a Policy proposed by an assigner (offered, not yet agreed). */
export declare const ODRL_OFFER: "http://www.w3.org/ns/odrl/2/Offer";
/** `odrl:Agreement` — a Policy agreed between an assigner and an assignee. */
export declare const ODRL_AGREEMENT: "http://www.w3.org/ns/odrl/2/Agreement";
/** `odrl:Permission` — a permitted Rule. */
export declare const ODRL_PERMISSION_CLASS: "http://www.w3.org/ns/odrl/2/Permission";
/** `odrl:Prohibition` — a prohibited Rule. */
export declare const ODRL_PROHIBITION_CLASS: "http://www.w3.org/ns/odrl/2/Prohibition";
/** `odrl:Duty` — a duty/obligation Rule (a requirement of a permission). */
export declare const ODRL_DUTY_CLASS: "http://www.w3.org/ns/odrl/2/Duty";
/** `odrl:Constraint` — a boolean condition refining a rule. */
export declare const ODRL_CONSTRAINT_CLASS: "http://www.w3.org/ns/odrl/2/Constraint";
/** `odrl:Action` — the action concept class. */
export declare const ODRL_ACTION_CLASS: "http://www.w3.org/ns/odrl/2/Action";
/** `odrl:uid` — the policy's unique identifier (often the policy IRI itself). */
export declare const ODRL_UID: "http://www.w3.org/ns/odrl/2/uid";
/** `odrl:profile` — the ODRL profile a policy conforms to. */
export declare const ODRL_PROFILE: "http://www.w3.org/ns/odrl/2/profile";
/** `odrl:permission` — Policy → Permission rule. */
export declare const ODRL_PERMISSION: "http://www.w3.org/ns/odrl/2/permission";
/** `odrl:prohibition` — Policy → Prohibition rule. */
export declare const ODRL_PROHIBITION: "http://www.w3.org/ns/odrl/2/prohibition";
/** `odrl:obligation` — Policy → Duty (an obligation independent of a permission). */
export declare const ODRL_OBLIGATION: "http://www.w3.org/ns/odrl/2/obligation";
/** `odrl:duty` — Permission → Duty (a duty that conditions a permission). */
export declare const ODRL_DUTY: "http://www.w3.org/ns/odrl/2/duty";
/** `odrl:action` — Rule → action concept. */
export declare const ODRL_ACTION: "http://www.w3.org/ns/odrl/2/action";
/** `odrl:target` — Rule → the Asset the rule governs. */
export declare const ODRL_TARGET: "http://www.w3.org/ns/odrl/2/target";
/** `odrl:assigner` — Rule/Policy → the Party issuing the rule. */
export declare const ODRL_ASSIGNER: "http://www.w3.org/ns/odrl/2/assigner";
/** `odrl:assignee` — Rule/Policy → the Party the rule is granted to. */
export declare const ODRL_ASSIGNEE: "http://www.w3.org/ns/odrl/2/assignee";
/** `odrl:constraint` — Rule → Constraint (a refinement on the rule). */
export declare const ODRL_CONSTRAINT: "http://www.w3.org/ns/odrl/2/constraint";
/** `odrl:conflict` — Policy → the conflict-resolution strategy. */
export declare const ODRL_CONFLICT: "http://www.w3.org/ns/odrl/2/conflict";
/** `odrl:leftOperand` — the constraint subject (e.g. `odrl:dateTime`). */
export declare const ODRL_LEFT_OPERAND: "http://www.w3.org/ns/odrl/2/leftOperand";
/** `odrl:operator` — the constraint relational operator (e.g. `odrl:lteq`). */
export declare const ODRL_OPERATOR: "http://www.w3.org/ns/odrl/2/operator";
/** `odrl:rightOperand` — the constraint object value. */
export declare const ODRL_RIGHT_OPERAND: "http://www.w3.org/ns/odrl/2/rightOperand";
/** `odrl:perm` — on conflict, the Permission overrides the Prohibition. */
export declare const ODRL_PERM: "http://www.w3.org/ns/odrl/2/perm";
/** `odrl:prohibit` — on conflict, the Prohibition overrides the Permission. */
export declare const ODRL_PROHIBIT: "http://www.w3.org/ns/odrl/2/prohibit";
/** `odrl:invalid` — on conflict, the whole Policy is void. */
export declare const ODRL_INVALID: "http://www.w3.org/ns/odrl/2/invalid";
/** The closed set of ODRL conflict strategies. */
export declare const CONFLICT_STRATEGIES: readonly ["perm", "prohibit", "invalid"];
/** A conflict-resolution strategy short name. */
export type ConflictStrategy = (typeof CONFLICT_STRATEGIES)[number];
/** Map a conflict strategy short name to its full ODRL IRI. */
export declare const CONFLICT_IRI: Readonly<Record<ConflictStrategy, string>>;
/** Reverse: ODRL conflict IRI → short strategy name. */
export declare const IRI_TO_CONFLICT: Readonly<Record<string, ConflictStrategy>>;
/** `odrl:use` — the broad "use" action (the most common umbrella action). */
export declare const ODRL_USE: "http://www.w3.org/ns/odrl/2/use";
/** `odrl:read` — read the target. */
export declare const ODRL_READ: "http://www.w3.org/ns/odrl/2/read";
/** `odrl:write` — write/overwrite the target. */
export declare const ODRL_WRITE: "http://www.w3.org/ns/odrl/2/write";
/** `odrl:modify` — modify the target. */
export declare const ODRL_MODIFY: "http://www.w3.org/ns/odrl/2/modify";
/** `odrl:delete` — delete the target. */
export declare const ODRL_DELETE: "http://www.w3.org/ns/odrl/2/delete";
/** `odrl:distribute` — distribute/share the target with others. */
export declare const ODRL_DISTRIBUTE: "http://www.w3.org/ns/odrl/2/distribute";
/** `odrl:aggregate` — aggregate the target with other assets. */
export declare const ODRL_AGGREGATE: "http://www.w3.org/ns/odrl/2/aggregate";
/** `odrl:index` — index the target. */
export declare const ODRL_INDEX: "http://www.w3.org/ns/odrl/2/index";
/** `odrl:archive` — archive/store the target. */
export declare const ODRL_ARCHIVE: "http://www.w3.org/ns/odrl/2/archive";
/** `odrl:attribute` — give attribution (a common duty action). */
export declare const ODRL_ATTRIBUTE: "http://www.w3.org/ns/odrl/2/attribute";
/** `odrl:compensate` — pay/compensate (a common duty action). */
export declare const ODRL_COMPENSATE: "http://www.w3.org/ns/odrl/2/compensate";
/** `odrl:inform` / `odrl:notify` — notify a party (a common duty action). */
export declare const ODRL_INFORM: "http://www.w3.org/ns/odrl/2/inform";
/** `odrl:anonymize` — anonymise the target (a common duty action). */
export declare const ODRL_ANONYMIZE: "http://www.w3.org/ns/odrl/2/anonymize";
/** `odrl:delete` is reused as a duty action (delete-after-use). */
/**
 * `odrl:grantUse` — "To grant the use of the Asset to third parties." The vocab
 * note: "This action enables the assignee to create policies for the use of the
 * Asset for third parties. The nextPolicy is recommended to be agreed with the
 * third party. Use of temporal constraints is recommended." (ODRL Vocab §4.4.22.)
 * This is ODRL's native DELEGATION action: a permission on `grantUse` is what
 * authorises an agent to issue a downstream policy to a sub-agent.
 */
export declare const ODRL_GRANT_USE: "http://www.w3.org/ns/odrl/2/grantUse";
/**
 * `odrl:nextPolicy` — "To grant the specified Policy to a third party for their
 * use of the Asset." (ODRL Vocab §4.4.29 — an ACTION concept in ODRL 2.2, not a
 * property.) Used as the action of a DUTY on a `grantUse` permission whose
 * `odrl:target` is the downstream Policy the delegate must issue — the mechanism
 * by which a delegator pins exactly what may be passed on.
 */
export declare const ODRL_NEXT_POLICY: "http://www.w3.org/ns/odrl/2/nextPolicy";
/**
 * `odrl:transfer` — "To transfer the ownership of the Asset in perpetuity."
 * (ODRL Vocab §3.12.2.) Ownership transfer, NOT delegation-of-use; a top-level
 * action concept the vocabulary does NOT place under the `use` umbrella.
 */
export declare const ODRL_TRANSFER: "http://www.w3.org/ns/odrl/2/transfer";
/** `acl:Append` as an action concept — add-only access (a STRICT subclass of write). */
export declare const ACTION_APPEND_IRI: "http://www.w3.org/ns/auth/acl#Append";
/** `acl:Control` as an action concept — access to the ACL document, NOT data use. */
export declare const ACTION_CONTROL_IRI: "http://www.w3.org/ns/auth/acl#Control";
/**
 * The closed set of ODRL action short names the evaluator + builder understand.
 * A stable machine-readable enum independent of the (verbose) IRIs.
 *
 * `append` + `control` are the Solid-resource access concepts (see above): they are
 * NOT ODRL data-use actions and are deliberately narrow — see {@link ACTION_IMPLIED_BY}
 * ( `control` is NOT covered by the `use` umbrella) and {@link ACL_MODE_TO_ACTION}.
 */
export declare const ODRL_ACTIONS: readonly ["use", "read", "write", "modify", "delete", "distribute", "aggregate", "index", "archive", "attribute", "compensate", "inform", "anonymize", "append", "control", "grantUse", "nextPolicy", "transfer"];
/** An ODRL action short name. */
export type OdrlActionName = (typeof ODRL_ACTIONS)[number];
/** Map an ODRL action short name to its full ODRL IRI. */
export declare const ACTION_IRI: Readonly<Record<OdrlActionName, string>>;
/** Reverse: ODRL action IRI → short action name (for round-trip read). */
export declare const IRI_TO_ACTION: Readonly<Record<string, OdrlActionName>>;
/** The set of valid ODRL action IRIs, for validation/round-trip. */
export declare const VALID_ACTION_IRIS: ReadonlySet<string>;
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
export declare const ACTION_IMPLIED_BY: Readonly<Record<OdrlActionName, ReadonlySet<OdrlActionName>>>;
/** `acl:Read`. */
export declare const ACL_READ: "http://www.w3.org/ns/auth/acl#Read";
/** `acl:Write`. */
export declare const ACL_WRITE: "http://www.w3.org/ns/auth/acl#Write";
/** `acl:Append`. */
export declare const ACL_APPEND: "http://www.w3.org/ns/auth/acl#Append";
/** `acl:Control`. */
export declare const ACL_CONTROL: "http://www.w3.org/ns/auth/acl#Control";
/** An ACL mode short name. */
export declare const ACL_MODES: readonly ["Read", "Write", "Append", "Control"];
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
export declare const ACL_MODE_TO_ACTION: Readonly<Record<AclMode, OdrlActionName>>;
/** `odrl:dateTime` — a temporal constraint (the request time). */
export declare const ODRL_DATETIME: "http://www.w3.org/ns/odrl/2/dateTime";
/** `odrl:purpose` — the purpose-of-use constraint (DPV-valued). */
export declare const ODRL_PURPOSE: "http://www.w3.org/ns/odrl/2/purpose";
/** `odrl:recipient` — the recipient party constraint. */
export declare const ODRL_RECIPIENT: "http://www.w3.org/ns/odrl/2/recipient";
/** `odrl:count` — a use-count constraint. */
export declare const ODRL_COUNT: "http://www.w3.org/ns/odrl/2/count";
/** `odrl:spatial` — a spatial/jurisdiction constraint. */
export declare const ODRL_SPATIAL: "http://www.w3.org/ns/odrl/2/spatial";
/** `odrl:elapsedTime` — a duration constraint. */
export declare const ODRL_ELAPSED_TIME: "http://www.w3.org/ns/odrl/2/elapsedTime";
/** `odrl:systemDevice` — the requesting device/system constraint. */
export declare const ODRL_SYSTEM_DEVICE: "http://www.w3.org/ns/odrl/2/systemDevice";
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
export declare const ODRLD_DELEGATION_DEPTH: "https://w3id.org/jeswr/odrl-delegation#delegationDepth";
/** The closed set of constraint left-operand short names the evaluator handles. */
export declare const LEFT_OPERANDS: readonly ["dateTime", "purpose", "recipient", "count", "spatial", "elapsedTime", "systemDevice", "delegationDepth"];
/** A constraint left-operand short name. */
export type LeftOperandName = (typeof LEFT_OPERANDS)[number];
/** Map a left-operand short name to its full ODRL IRI. */
export declare const LEFT_OPERAND_IRI: Readonly<Record<LeftOperandName, string>>;
/** Reverse: left-operand IRI → short name. */
export declare const IRI_TO_LEFT_OPERAND: Readonly<Record<string, LeftOperandName>>;
/** `odrl:eq` — equal to. */
export declare const ODRL_EQ: "http://www.w3.org/ns/odrl/2/eq";
/** `odrl:neq` — not equal to. */
export declare const ODRL_NEQ: "http://www.w3.org/ns/odrl/2/neq";
/** `odrl:gt` — greater than. */
export declare const ODRL_GT: "http://www.w3.org/ns/odrl/2/gt";
/** `odrl:gteq` — greater than or equal. */
export declare const ODRL_GTEQ: "http://www.w3.org/ns/odrl/2/gteq";
/** `odrl:lt` — less than. */
export declare const ODRL_LT: "http://www.w3.org/ns/odrl/2/lt";
/** `odrl:lteq` — less than or equal. */
export declare const ODRL_LTEQ: "http://www.w3.org/ns/odrl/2/lteq";
/** `odrl:isAnyOf` — the request value is one of a set. */
export declare const ODRL_IS_ANY_OF: "http://www.w3.org/ns/odrl/2/isAnyOf";
/** `odrl:isAllOf` — the request value(s) cover a set. */
export declare const ODRL_IS_ALL_OF: "http://www.w3.org/ns/odrl/2/isAllOf";
/** `odrl:isNoneOf` — the request value is none of a set. */
export declare const ODRL_IS_NONE_OF: "http://www.w3.org/ns/odrl/2/isNoneOf";
/** The closed set of constraint operator short names the evaluator handles. */
export declare const OPERATORS: readonly ["eq", "neq", "gt", "gteq", "lt", "lteq", "isAnyOf", "isAllOf", "isNoneOf"];
/** A constraint operator short name. */
export type OperatorName = (typeof OPERATORS)[number];
/** Map an operator short name to its full ODRL IRI. */
export declare const OPERATOR_IRI: Readonly<Record<OperatorName, string>>;
/** Reverse: operator IRI → short name. */
export declare const IRI_TO_OPERATOR: Readonly<Record<string, OperatorName>>;
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
export declare const ODRLD_DELEGATED_UNDER: "https://w3id.org/jeswr/odrl-delegation#delegatedUnder";
/**
 * `odrld:Revocation` — MINTED (delegation profile §4.3): the class of a revocation
 * statement an assigner publishes to withdraw a previously issued delegation
 * policy. ODRL 2.2 has no revocation vocabulary at all (expiry is expressible via
 * `odrl:dateTime` constraints; withdrawal-before-expiry is not).
 */
export declare const ODRLD_REVOCATION_CLASS: "https://w3id.org/jeswr/odrl-delegation#Revocation";
/** `odrld:revokedPolicy` — MINTED (with {@link ODRLD_REVOCATION_CLASS}): Revocation → the revoked Policy. */
export declare const ODRLD_REVOKED_POLICY: "https://w3id.org/jeswr/odrl-delegation#revokedPolicy";
/** `prov:wasAttributedTo` — Entity → Agent (each hop policy is attributed to its issuer). */
export declare const PROV_WAS_ATTRIBUTED_TO: "http://www.w3.org/ns/prov#wasAttributedTo";
/** `prov:actedOnBehalfOf` — Agent → Agent (the delegate acts on behalf of the delegator). */
export declare const PROV_ACTED_ON_BEHALF_OF: "http://www.w3.org/ns/prov#actedOnBehalfOf";
/** `prov:wasDerivedFrom` — Entity → Entity (the generic super-property of `odrld:delegatedUnder`). */
export declare const PROV_WAS_DERIVED_FROM: "http://www.w3.org/ns/prov#wasDerivedFrom";
/** `prov:Activity` — the class of a performed action. */
export declare const PROV_ACTIVITY: "http://www.w3.org/ns/prov#Activity";
/** `prov:Association` — the class of a `qualifiedAssociation` blank node. */
export declare const PROV_ASSOCIATION: "http://www.w3.org/ns/prov#Association";
/** `prov:wasAssociatedWith` — Activity → Agent (who carried out the activity). */
export declare const PROV_WAS_ASSOCIATED_WITH: "http://www.w3.org/ns/prov#wasAssociatedWith";
/** `prov:used` — Activity → Entity (a resource the activity consumed). */
export declare const PROV_USED: "http://www.w3.org/ns/prov#used";
/** `prov:generated` — Activity → Entity (an artifact the activity produced). */
export declare const PROV_GENERATED: "http://www.w3.org/ns/prov#generated";
/** `prov:startedAtTime` — Activity → xsd:dateTime. */
export declare const PROV_STARTED_AT_TIME: "http://www.w3.org/ns/prov#startedAtTime";
/** `prov:endedAtTime` — Activity → xsd:dateTime. */
export declare const PROV_ENDED_AT_TIME: "http://www.w3.org/ns/prov#endedAtTime";
/** `prov:qualifiedAssociation` — Activity → Association (the reified agent+plan link). */
export declare const PROV_QUALIFIED_ASSOCIATION: "http://www.w3.org/ns/prov#qualifiedAssociation";
/** `prov:agent` — Association → Agent (used inside the reified Association node). */
export declare const PROV_AGENT: "http://www.w3.org/ns/prov#agent";
/** `prov:hadPlan` — Association → Entity (the authorizing plan — the leaf Agreement). */
export declare const PROV_HAD_PLAN: "http://www.w3.org/ns/prov#hadPlan";
/** `prov:wasGeneratedBy` — Entity → Activity (inverse of `generated`, on the artifact). */
export declare const PROV_WAS_GENERATED_BY: "http://www.w3.org/ns/prov#wasGeneratedBy";
/** `xsd:dateTime` — the datatype for `startedAtTime`/`endedAtTime` literals. */
export declare const XSD_DATETIME: "http://www.w3.org/2001/XMLSchema#dateTime";
/**
 * A SELF-CONTAINED inline JSON-LD `@context` for a per-action PROV bundle
 * ({@link actionProvenanceJsonLd} — same "no network dependency" rationale as
 * {@link ODRL_INLINE_CONTEXT}). IRI-valued terms carry `"@type": "@id"`.
 */
export declare const PROV_INLINE_CONTEXT: Readonly<Record<string, unknown>>;
/**
 * A SELF-CONTAINED inline JSON-LD `@context` for an ODRL policy graph. Like M1/M2,
 * the emitted JSON-LD embeds this rather than a bare remote `@context` URL, so the
 * document parses with NO network (offline + deterministic) and carries no
 * SSRF / availability dependency on a remote context endpoint. The aliases match
 * the standard ODRL JSON-LD context term names. Object/IRI-valued terms carry
 * `"@type": "@id"` so a `{ "@id": … }` value parses as an IRI node.
 */
export declare const ODRL_INLINE_CONTEXT: Readonly<Record<string, unknown>>;
/**
 * The delegation-profile EXTENSION of {@link ODRL_INLINE_CONTEXT}: added to the
 * emitted JSON-LD `@context` ONLY when the policy actually uses a profile term
 * (currently `delegatedUnder`), so a plain ODRL policy's JSON-LD projection is
 * byte-identical to what it was before the profile existed.
 */
export declare const ODRLD_INLINE_CONTEXT_EXTENSION: Readonly<Record<string, unknown>>;
//# sourceMappingURL=vocab.d.ts.map