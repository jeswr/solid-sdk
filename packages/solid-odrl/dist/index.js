// src/iri.ts
var IRIREF_FORBIDDEN = /[\u0000-\u0020<>"{}|^`\\]/g;
function escapeIri(value) {
  return value.replace(
    IRIREF_FORBIDDEN,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`
  );
}
var LEADING_TRAILING_C0 = /^[\u0000-\u0020]|[\u0000-\u0020]$/;
var ABSOLUTE_IRI_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
function safeHttpIri(value) {
  if (typeof value !== "string") return void 0;
  if (LEADING_TRAILING_C0.test(value)) return void 0;
  const escaped = escapeIri(value);
  let u;
  try {
    u = new URL(escaped);
  } catch {
    return void 0;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return void 0;
  return escaped;
}
function safeIri(value) {
  if (typeof value !== "string") return void 0;
  if (LEADING_TRAILING_C0.test(value)) return void 0;
  const escaped = escapeIri(value);
  if (!ABSOLUTE_IRI_SCHEME.test(escaped)) return void 0;
  return escaped;
}

// src/vocab.ts
var ODRL = "http://www.w3.org/ns/odrl/2/";
var ACL = "http://www.w3.org/ns/auth/acl#";
var DPV = "https://w3id.org/dpv#";
var XSD = "http://www.w3.org/2001/XMLSchema#";
var PROV = "http://www.w3.org/ns/prov#";
var ODRLD = "https://w3id.org/jeswr/odrl-delegation#";
var ODRLD_PROFILE_IRI = "https://w3id.org/jeswr/odrl-delegation";
var RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
var RDFS = "http://www.w3.org/2000/01/rdf-schema#";
var DCTERMS = "http://purl.org/dc/terms/";
var RDF_TYPE = `${RDF}type`;
var ODRL_POLICY = `${ODRL}Policy`;
var ODRL_SET = `${ODRL}Set`;
var ODRL_OFFER = `${ODRL}Offer`;
var ODRL_AGREEMENT = `${ODRL}Agreement`;
var ODRL_PERMISSION_CLASS = `${ODRL}Permission`;
var ODRL_PROHIBITION_CLASS = `${ODRL}Prohibition`;
var ODRL_DUTY_CLASS = `${ODRL}Duty`;
var ODRL_CONSTRAINT_CLASS = `${ODRL}Constraint`;
var ODRL_ACTION_CLASS = `${ODRL}Action`;
var ODRL_UID = `${ODRL}uid`;
var ODRL_PROFILE = `${ODRL}profile`;
var ODRL_PERMISSION = `${ODRL}permission`;
var ODRL_PROHIBITION = `${ODRL}prohibition`;
var ODRL_OBLIGATION = `${ODRL}obligation`;
var ODRL_DUTY = `${ODRL}duty`;
var ODRL_ACTION = `${ODRL}action`;
var ODRL_TARGET = `${ODRL}target`;
var ODRL_ASSIGNER = `${ODRL}assigner`;
var ODRL_ASSIGNEE = `${ODRL}assignee`;
var ODRL_CONSTRAINT = `${ODRL}constraint`;
var ODRL_CONFLICT = `${ODRL}conflict`;
var ODRL_LEFT_OPERAND = `${ODRL}leftOperand`;
var ODRL_OPERATOR = `${ODRL}operator`;
var ODRL_RIGHT_OPERAND = `${ODRL}rightOperand`;
var ODRL_PERM = `${ODRL}perm`;
var ODRL_PROHIBIT = `${ODRL}prohibit`;
var ODRL_INVALID = `${ODRL}invalid`;
var CONFLICT_STRATEGIES = ["perm", "prohibit", "invalid"];
var CONFLICT_IRI = {
  perm: ODRL_PERM,
  prohibit: ODRL_PROHIBIT,
  invalid: ODRL_INVALID
};
var IRI_TO_CONFLICT = Object.fromEntries(
  Object.entries(CONFLICT_IRI).map(([k, v]) => [v, k])
);
var ODRL_USE = `${ODRL}use`;
var ODRL_READ = `${ODRL}read`;
var ODRL_WRITE = `${ODRL}write`;
var ODRL_MODIFY = `${ODRL}modify`;
var ODRL_DELETE = `${ODRL}delete`;
var ODRL_DISTRIBUTE = `${ODRL}distribute`;
var ODRL_AGGREGATE = `${ODRL}aggregate`;
var ODRL_INDEX = `${ODRL}index`;
var ODRL_ARCHIVE = `${ODRL}archive`;
var ODRL_ATTRIBUTE = `${ODRL}attribute`;
var ODRL_COMPENSATE = `${ODRL}compensate`;
var ODRL_INFORM = `${ODRL}inform`;
var ODRL_ANONYMIZE = `${ODRL}anonymize`;
var ODRL_GRANT_USE = `${ODRL}grantUse`;
var ODRL_NEXT_POLICY = `${ODRL}nextPolicy`;
var ODRL_TRANSFER = `${ODRL}transfer`;
var ACTION_APPEND_IRI = `${ACL}Append`;
var ACTION_CONTROL_IRI = `${ACL}Control`;
var ODRL_ACTIONS = [
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
  "transfer"
];
var ACTION_IRI = {
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
  transfer: ODRL_TRANSFER
};
var IRI_TO_ACTION = Object.fromEntries(
  Object.entries(ACTION_IRI).map(([k, v]) => [v, k])
);
var VALID_ACTION_IRIS = new Set(Object.values(ACTION_IRI));
var NOT_UNDER_USE = /* @__PURE__ */ new Set([
  "control",
  "grantUse",
  "nextPolicy",
  "transfer"
]);
var EXTRA_IMPLIED_BY = {
  append: ["write"]
};
var ACTION_IMPLIED_BY = Object.fromEntries(
  ODRL_ACTIONS.map((a) => {
    const implied = /* @__PURE__ */ new Set([a]);
    if (a !== "use" && !NOT_UNDER_USE.has(a)) {
      implied.add("use");
    }
    for (const stronger of EXTRA_IMPLIED_BY[a] ?? []) {
      implied.add(stronger);
    }
    return [a, implied];
  })
);
var ACL_READ = `${ACL}Read`;
var ACL_WRITE = `${ACL}Write`;
var ACL_APPEND = `${ACL}Append`;
var ACL_CONTROL = `${ACL}Control`;
var ACL_MODES = ["Read", "Write", "Append", "Control"];
var ACL_MODE_TO_ACTION = {
  Read: "read",
  Write: "write",
  Append: "append",
  Control: "control"
};
var ODRL_DATETIME = `${ODRL}dateTime`;
var ODRL_PURPOSE = `${ODRL}purpose`;
var ODRL_RECIPIENT = `${ODRL}recipient`;
var ODRL_COUNT = `${ODRL}count`;
var ODRL_SPATIAL = `${ODRL}spatial`;
var ODRL_ELAPSED_TIME = `${ODRL}elapsedTime`;
var ODRL_SYSTEM_DEVICE = `${ODRL}systemDevice`;
var ODRLD_DELEGATION_DEPTH = `${ODRLD}delegationDepth`;
var LEFT_OPERANDS = [
  "dateTime",
  "purpose",
  "recipient",
  "count",
  "spatial",
  "elapsedTime",
  "systemDevice",
  "delegationDepth"
];
var LEFT_OPERAND_IRI = {
  dateTime: ODRL_DATETIME,
  purpose: ODRL_PURPOSE,
  recipient: ODRL_RECIPIENT,
  count: ODRL_COUNT,
  spatial: ODRL_SPATIAL,
  elapsedTime: ODRL_ELAPSED_TIME,
  systemDevice: ODRL_SYSTEM_DEVICE,
  delegationDepth: ODRLD_DELEGATION_DEPTH
};
var IRI_TO_LEFT_OPERAND = Object.fromEntries(
  Object.entries(LEFT_OPERAND_IRI).map(([k, v]) => [v, k])
);
var ODRL_EQ = `${ODRL}eq`;
var ODRL_NEQ = `${ODRL}neq`;
var ODRL_GT = `${ODRL}gt`;
var ODRL_GTEQ = `${ODRL}gteq`;
var ODRL_LT = `${ODRL}lt`;
var ODRL_LTEQ = `${ODRL}lteq`;
var ODRL_IS_ANY_OF = `${ODRL}isAnyOf`;
var ODRL_IS_ALL_OF = `${ODRL}isAllOf`;
var ODRL_IS_NONE_OF = `${ODRL}isNoneOf`;
var OPERATORS = [
  "eq",
  "neq",
  "gt",
  "gteq",
  "lt",
  "lteq",
  "isAnyOf",
  "isAllOf",
  "isNoneOf"
];
var OPERATOR_IRI = {
  eq: ODRL_EQ,
  neq: ODRL_NEQ,
  gt: ODRL_GT,
  gteq: ODRL_GTEQ,
  lt: ODRL_LT,
  lteq: ODRL_LTEQ,
  isAnyOf: ODRL_IS_ANY_OF,
  isAllOf: ODRL_IS_ALL_OF,
  isNoneOf: ODRL_IS_NONE_OF
};
var IRI_TO_OPERATOR = Object.fromEntries(
  Object.entries(OPERATOR_IRI).map(([k, v]) => [v, k])
);
var ODRLD_DELEGATED_UNDER = `${ODRLD}delegatedUnder`;
var ODRLD_REVOCATION_CLASS = `${ODRLD}Revocation`;
var ODRLD_REVOKED_POLICY = `${ODRLD}revokedPolicy`;
var PROV_WAS_ATTRIBUTED_TO = `${PROV}wasAttributedTo`;
var PROV_ACTED_ON_BEHALF_OF = `${PROV}actedOnBehalfOf`;
var PROV_WAS_DERIVED_FROM = `${PROV}wasDerivedFrom`;
var PROV_ACTIVITY = `${PROV}Activity`;
var PROV_ASSOCIATION = `${PROV}Association`;
var PROV_WAS_ASSOCIATED_WITH = `${PROV}wasAssociatedWith`;
var PROV_USED = `${PROV}used`;
var PROV_GENERATED = `${PROV}generated`;
var PROV_STARTED_AT_TIME = `${PROV}startedAtTime`;
var PROV_ENDED_AT_TIME = `${PROV}endedAtTime`;
var PROV_QUALIFIED_ASSOCIATION = `${PROV}qualifiedAssociation`;
var PROV_AGENT = `${PROV}agent`;
var PROV_HAD_PLAN = `${PROV}hadPlan`;
var PROV_WAS_GENERATED_BY = `${PROV}wasGeneratedBy`;
var XSD_DATETIME = `${XSD}dateTime`;
var PROV_INLINE_CONTEXT = {
  prov: PROV,
  xsd: XSD,
  wasAssociatedWith: { "@id": PROV_WAS_ASSOCIATED_WITH, "@type": "@id" },
  used: { "@id": PROV_USED, "@type": "@id" },
  generated: { "@id": PROV_GENERATED, "@type": "@id" },
  startedAtTime: { "@id": PROV_STARTED_AT_TIME, "@type": XSD_DATETIME },
  endedAtTime: { "@id": PROV_ENDED_AT_TIME, "@type": XSD_DATETIME },
  qualifiedAssociation: { "@id": PROV_QUALIFIED_ASSOCIATION, "@type": "@id" },
  agent: { "@id": PROV_AGENT, "@type": "@id" },
  hadPlan: { "@id": PROV_HAD_PLAN, "@type": "@id" },
  actedOnBehalfOf: { "@id": PROV_ACTED_ON_BEHALF_OF, "@type": "@id" },
  wasDerivedFrom: { "@id": PROV_WAS_DERIVED_FROM, "@type": "@id" },
  wasGeneratedBy: { "@id": PROV_WAS_GENERATED_BY, "@type": "@id" }
};
var ODRL_INLINE_CONTEXT = {
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
  rightOperand: ODRL_RIGHT_OPERAND
};
var ODRLD_INLINE_CONTEXT_EXTENSION = {
  odrld: ODRLD,
  delegatedUnder: { "@id": ODRLD_DELEGATED_UNDER, "@type": "@id" }
};

// src/wrappers.ts
import { escapeIri as escapeIri2 } from "@jeswr/rdf-serialize";
import {
  BlankNodeFrom,
  DatasetWrapper,
  LiteralFrom,
  NamedNodeFrom,
  SetFrom,
  TermAs,
  TermFrom,
  TermWrapper
} from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
function objectTerms(node, predicate) {
  return SetFrom.subjectPredicate(node, predicate, TermAs.instance(TermWrapper), TermFrom.instance);
}
var ConstraintNode = class extends TermWrapper {
  get leftOperands() {
    return objectTerms(this, ODRL_LEFT_OPERAND);
  }
  get operators() {
    return objectTerms(this, ODRL_OPERATOR);
  }
  get rightOperands() {
    return objectTerms(this, ODRL_RIGHT_OPERAND);
  }
};
var DutyNode = class extends TermWrapper {
  get actions() {
    return objectTerms(this, ODRL_ACTION);
  }
  get targets() {
    return objectTerms(this, ODRL_TARGET);
  }
  get constraints() {
    return SetFrom.subjectPredicate(
      this,
      ODRL_CONSTRAINT,
      TermAs.instance(ConstraintNode),
      TermFrom.instance
    );
  }
};
var RuleNode = class extends TermWrapper {
  get actions() {
    return objectTerms(this, ODRL_ACTION);
  }
  get targets() {
    return objectTerms(this, ODRL_TARGET);
  }
  get assignees() {
    return objectTerms(this, ODRL_ASSIGNEE);
  }
  get assigners() {
    return objectTerms(this, ODRL_ASSIGNER);
  }
  get constraints() {
    return SetFrom.subjectPredicate(
      this,
      ODRL_CONSTRAINT,
      TermAs.instance(ConstraintNode),
      TermFrom.instance
    );
  }
  get duties() {
    return SetFrom.subjectPredicate(this, ODRL_DUTY, TermAs.instance(DutyNode), TermFrom.instance);
  }
};
var PolicyNode = class extends TermWrapper {
  get types() {
    return objectTerms(this, RDF_TYPE);
  }
  get uids() {
    return objectTerms(this, ODRL_UID);
  }
  get profiles() {
    return objectTerms(this, ODRL_PROFILE);
  }
  get assigners() {
    return objectTerms(this, ODRL_ASSIGNER);
  }
  get assignees() {
    return objectTerms(this, ODRL_ASSIGNEE);
  }
  get conflicts() {
    return objectTerms(this, ODRL_CONFLICT);
  }
  /** Delegation profile: the `odrld:delegatedUnder` parent-policy edge(s). */
  get delegatedUnders() {
    return objectTerms(this, ODRLD_DELEGATED_UNDER);
  }
  get permissions() {
    return SetFrom.subjectPredicate(
      this,
      ODRL_PERMISSION,
      TermAs.instance(RuleNode),
      TermFrom.instance
    );
  }
  get prohibitions() {
    return SetFrom.subjectPredicate(
      this,
      ODRL_PROHIBITION,
      TermAs.instance(RuleNode),
      TermFrom.instance
    );
  }
  get obligations() {
    return SetFrom.subjectPredicate(
      this,
      ODRL_OBLIGATION,
      TermAs.instance(DutyNode),
      TermFrom.instance
    );
  }
};
var PolicyDataset = class extends DatasetWrapper {
  /** Every `odrl:Policy` (or Set/Offer/Agreement) subject in the dataset. */
  policies() {
    const seen = /* @__PURE__ */ new Map();
    for (const cls of [ODRL_POLICY, ODRL_SET, ODRL_OFFER, ODRL_AGREEMENT]) {
      for (const node of this.instancesOf(cls, PolicyNode)) {
        seen.set(node.value, node);
      }
    }
    return [...seen.values()];
  }
};
function wrapPolicy(dataset) {
  return new PolicyDataset(dataset, DataFactory);
}
function firstIri(terms) {
  for (const term of terms) {
    if (term.termType === "NamedNode") {
      return term.value;
    }
  }
  return void 0;
}
function allValues(terms) {
  const out = [];
  for (const term of terms) {
    if (term.termType === "Literal") {
      const dt = term.datatype?.value;
      out.push(
        dt !== void 0 ? { value: term.value, isIri: false, datatype: dt } : { value: term.value, isIri: false }
      );
    } else if (term.termType === "NamedNode") {
      out.push({ value: term.value, isIri: true });
    }
  }
  return out;
}
function iriRef(iri) {
  return { kind: "iri", value: iri };
}
function normalize(subject) {
  return typeof subject === "string" ? { kind: "iri", value: subject } : subject;
}
var GraphBuilder = class {
  store = new Store();
  factory = DataFactory;
  /**
   * Mint a `NamedNode` whose IRI value is INJECTION-SAFE. `n3.Writer` does NOT
   * escape IRIs — it emits whatever string a `NamedNode` carries verbatim inside
   * `<…>` — so an IRI value carrying a Turtle `IRIREF`-forbidden character (`>`,
   * a space, `<`, `"`, `{`, `}`, `|`, `^`, backtick, backslash, a C0 control)
   * would break out of the angle brackets and inject arbitrary triples into the
   * serialised document. Since an ODRL policy's party / target / policy IRIs can
   * originate from foreign input (a delegation chain assembled from other agents'
   * pods, a parsed-then-re-serialised policy), every IRI written here is
   * percent-escaped through the suite-canonical {@link escapeIri} FIRST — the
   * SOLE chokepoint every `NamedNodeFrom.string` call in this builder routes
   * through (subjects, predicates, object IRIs, and datatype IRIs alike), so a
   * forbidden octet can never reach the serialiser regardless of the call site.
   * Escaping is IDENTITY-PRESERVING (only forbidden bytes become `%XX`; a
   * well-formed IRI round-trips byte-for-byte) and does NOT affect evaluation,
   * which compares the raw string values — so a hostile IRI simply fails to
   * match a legitimate one (fail-closed) rather than laundering an injection
   * through the serialiser. (Explicit http(s)-contract fields — target/
   * assignee/assigner/profile — get an ADDITIONAL, stricter guard upstream in
   * policy.ts: `requireHttpIri` refuses to serialise rather than silently drop
   * an unsafe EXPLICIT value, since dropping would widen the policy to a
   * wildcard match — a privilege escalation. Escaping here is the universal
   * breakout guard; `requireHttpIri` is the additional fail-closed reject for
   * evaluation-critical fields.)
   */
  iriTerm(value) {
    return NamedNodeFrom.string(escapeIri2(value), this.factory);
  }
  /** Materialise a {@link NodeRef} to its RDF/JS term. */
  subjectTerm(ref) {
    return ref.kind === "iri" ? this.iriTerm(ref.value) : BlankNodeFrom.string(ref.value, this.factory);
  }
  /**
   * Add `(subject, predicate, object-IRI)`. Predicate and object IRI are passed
   * through {@link escapeIri} so no IRIREF-forbidden octet reaches the serialiser
   * regardless of the call site — the breakout-proof chokepoint for object IRIs.
   * (Trusted vocab constants contain no forbidden octet, so this is a no-op for
   * them; semantic http(s)-only validation lives at the call sites in policy.ts.)
   */
  addIri(subject, predicate, objectIri) {
    const s = this.subjectTerm(normalize(subject));
    const p = this.iriTerm(predicate);
    const o = this.iriTerm(objectIri);
    this.store.add(this.factory.quad(s, p, o));
  }
  /** Add `(subject, predicate, literal)` with an optional datatype IRI. */
  addLiteral(subject, predicate, value, datatypeIri) {
    const s = this.subjectTerm(normalize(subject));
    const p = this.iriTerm(predicate);
    const o = datatypeIri === void 0 ? LiteralFrom.string(value, this.factory) : this.factory.literal(value, this.iriTerm(datatypeIri));
    this.store.add(this.factory.quad(s, p, o));
  }
  /**
   * Mint a fresh blank node, link it `(subject, predicate, _:b)`, and return a
   * {@link NodeRef} to the new blank node (so subsequent writes target it
   * unambiguously as a blank, never as an IRI).
   */
  linkBlankNode(subject, predicate) {
    const s = this.subjectTerm(normalize(subject));
    const blank = BlankNodeFrom.string(void 0, this.factory);
    const p = this.iriTerm(predicate);
    this.store.add(this.factory.quad(s, p, blank));
    return { kind: "blank", value: blank.value };
  }
  /**
   * Link a CHILD node (a named IRI child if provided, else a fresh blank) from
   * `subject` via `predicate`, and return its {@link NodeRef}. Used for rule/duty/
   * constraint nodes which may carry their own IRI or be anonymous.
   */
  linkChild(subject, predicate, childIri) {
    if (childIri !== void 0) {
      this.addIri(subject, predicate, childIri);
      return iriRef(childIri);
    }
    return this.linkBlankNode(subject, predicate);
  }
  /** The underlying store (a DatasetCore). */
  dataset() {
    return this.store;
  }
  /** The accumulated quads. */
  quads() {
    return [...this.store];
  }
};

// src/action-provenance.ts
function asArray(v) {
  if (v === void 0) {
    return [];
  }
  return typeof v === "string" ? [v] : v;
}
function actionProvenance(input) {
  const b = new GraphBuilder();
  const act = iriRef(input.activity);
  b.addIri(act, RDF_TYPE, PROV_ACTIVITY);
  b.addIri(act, PROV_WAS_ASSOCIATED_WITH, input.agent);
  const used = asArray(input.used);
  for (const u of used) {
    b.addIri(act, PROV_USED, u);
  }
  const generated = asArray(input.generated);
  for (const g of generated) {
    b.addIri(act, PROV_GENERATED, g);
  }
  b.addLiteral(act, PROV_STARTED_AT_TIME, input.started.toISOString(), XSD_DATETIME);
  if (input.ended !== void 0) {
    b.addLiteral(act, PROV_ENDED_AT_TIME, input.ended.toISOString(), XSD_DATETIME);
  }
  const assoc = b.linkBlankNode(act, PROV_QUALIFIED_ASSOCIATION);
  b.addIri(assoc, RDF_TYPE, PROV_ASSOCIATION);
  b.addIri(assoc, PROV_AGENT, input.agent);
  b.addIri(assoc, PROV_HAD_PLAN, input.plan);
  if (input.onBehalfOf !== void 0) {
    b.addIri(iriRef(input.agent), PROV_ACTED_ON_BEHALF_OF, input.onBehalfOf);
  }
  for (const g of generated) {
    const artifact = iriRef(g);
    for (const u of used) {
      b.addIri(artifact, PROV_WAS_DERIVED_FROM, u);
    }
    b.addIri(artifact, PROV_WAS_GENERATED_BY, input.activity);
  }
  return b.quads();
}
function actionProvenanceJsonLd(input) {
  const act = escapeIri(input.activity);
  const agent = escapeIri(input.agent);
  const plan = escapeIri(input.plan);
  const used = asArray(input.used).map(escapeIri);
  const generated = asArray(input.generated).map(escapeIri);
  const assocId = "_:association";
  const activityNode = {
    "@id": act,
    "@type": "prov:Activity",
    wasAssociatedWith: { "@id": agent },
    startedAtTime: input.started.toISOString(),
    qualifiedAssociation: { "@id": assocId }
  };
  if (used.length > 0) {
    activityNode.used = used.map((u) => ({ "@id": u }));
  }
  if (generated.length > 0) {
    activityNode.generated = generated.map((g) => ({ "@id": g }));
  }
  if (input.ended !== void 0) {
    activityNode.endedAtTime = input.ended.toISOString();
  }
  const associationNode = {
    "@id": assocId,
    "@type": "prov:Association",
    agent: { "@id": agent },
    hadPlan: { "@id": plan }
  };
  const graph = [activityNode, associationNode];
  if (input.onBehalfOf !== void 0) {
    graph.push({
      "@id": agent,
      actedOnBehalfOf: { "@id": escapeIri(input.onBehalfOf) }
    });
  }
  for (const g of generated) {
    graph.push({
      "@id": g,
      ...used.length > 0 ? { wasDerivedFrom: used.map((u) => ({ "@id": u })) } : {},
      wasGeneratedBy: { "@id": act }
    });
  }
  return { "@context": PROV_INLINE_CONTEXT, "@graph": graph };
}

// src/compose.ts
var A2A_ACTION_TO_ODRL = {
  read: "read",
  create: "write",
  update: "modify",
  // `append` is add-only — a STRICT subclass of write (WAC `acl:Append`). Mapping it
  // to `modify` was an OVER-GRANT (an append-only intent compiled to full data
  // mutation). Map to the narrow `append` action instead — never broadens. See
  // ACL_MODE_TO_ACTION in vocab.ts for the same tightening on the WAC side.
  append: "append",
  delete: "delete",
  list: "read",
  // `grant` CHANGES ACCESS CONTROL (grants a recipient access to the resource) — it
  // is an ACL-document operation, exactly what `acl:Control` governs. Mapping it to
  // the broad data-use `use` was an OVER-GRANT (a "permit use" data policy would
  // authorize granting access to others). Map to the narrow `control` action — which
  // is OUTSIDE the `use` umbrella (vocab.ts) — so only an explicit `control` policy
  // can authorize a grant. (Same class of over-grant as the WAC `Control` fix.)
  grant: "control",
  // `subscribe` is a read-class data operation (notifications require Read on the
  // resource), not an ACL operation — it stays under the data-use umbrella.
  subscribe: "use",
  query: "read"
};
function requestContextFromA2AIntent(intent, attributes) {
  const action = A2A_ACTION_TO_ODRL[intent.action] ?? "use";
  const mergedAttributes = {
    ...attributes ?? {}
  };
  if (intent.recipient !== void 0 && mergedAttributes.recipient === void 0) {
    mergedAttributes.recipient = intent.recipient;
  }
  return {
    action,
    ...intent.target !== void 0 && { target: intent.target },
    ...intent.agent !== void 0 && { agent: intent.agent },
    ...Object.keys(mergedAttributes).length > 0 && { attributes: mergedAttributes }
  };
}
function requestContextFromWac(agent, mode, target, attributes) {
  return {
    action: ACL_MODE_TO_ACTION[mode],
    target,
    ...agent !== void 0 && { agent },
    ...attributes !== void 0 && { attributes }
  };
}

// src/evaluate.ts
function evaluate(policy, request, options = {}) {
  const now = options.now ?? /* @__PURE__ */ new Date();
  const effectiveProhibitions = (policy.prohibitions ?? []).map((r) => effectiveRule(r, policy));
  const matchedPermissionRules = matchingPermissions(policy, request, { now });
  const matchedProhibitionRules = effectiveProhibitions.filter((r) => ruleMatches(r, request, now));
  const matchedPermissions = matchedPermissionRules.map((r) => toDecisionRule(r, "permission"));
  const matchedProhibitions = matchedProhibitionRules.map((r) => toDecisionRule(r, "prohibition"));
  const hasPermit = matchedPermissions.length > 0;
  const hasProhibit = matchedProhibitions.length > 0;
  const conflict = hasPermit && hasProhibit;
  const duties = collectDuties(policy, matchedPermissionRules, request, now);
  if (!hasPermit && !hasProhibit) {
    return result(
      "notApplicable",
      "No permission or prohibition matches the request.",
      matchedPermissions,
      matchedProhibitions,
      [],
      false
    );
  }
  if (conflict) {
    const strategy = policy.conflict ?? "prohibit";
    if (strategy === "perm") {
      return decidePermit(
        matchedPermissions,
        matchedProhibitions,
        duties,
        options,
        "Conflict resolved by odrl:perm \u2014 permission overrides prohibition.",
        true
      );
    }
    if (strategy === "invalid") {
      return result(
        "deny",
        "Conflict resolved by odrl:invalid \u2014 the policy is void; denying (fail-closed).",
        matchedPermissions,
        matchedProhibitions,
        [],
        true
      );
    }
    return result(
      "deny",
      "Conflict resolved by odrl:prohibit \u2014 prohibition overrides permission.",
      matchedPermissions,
      matchedProhibitions,
      [],
      true
    );
  }
  if (hasProhibit) {
    return result(
      "deny",
      "A prohibition matches the request.",
      matchedPermissions,
      matchedProhibitions,
      [],
      false
    );
  }
  return decidePermit(
    matchedPermissions,
    matchedProhibitions,
    duties,
    options,
    "A permission matches the request.",
    false
  );
}
function matchingPermissions(policy, request, options = {}) {
  const now = options.now ?? /* @__PURE__ */ new Date();
  return (policy.permissions ?? []).map((r) => effectiveRule(r, policy)).filter((r) => ruleMatches(r, request, now));
}
function decidePermit(perms, prohibits, duties, options, reason, conflict) {
  if (options.requireDuties) {
    const outstanding = duties.filter((d) => !d.fulfilled);
    if (outstanding.length > 0) {
      const names = outstanding.map((d) => d.action).join(", ");
      return result(
        "deny",
        `${reason} But requireDuties is set and these duties are unfulfilled: ${names}.`,
        perms,
        prohibits,
        duties,
        conflict
      );
    }
  }
  return result("permit", reason, perms, prohibits, duties, conflict);
}
function result(decision, reason, matchedPermissions, matchedProhibitions, duties, conflict) {
  return { decision, reason, matchedPermissions, matchedProhibitions, duties, conflict };
}
function effectiveRule(rule, policy) {
  const assignee = rule.assignee ?? policy.assignee;
  const assigner = rule.assigner ?? policy.assigner;
  if (assignee === rule.assignee && assigner === rule.assigner) {
    return rule;
  }
  return {
    ...rule,
    ...assignee !== void 0 && { assignee },
    ...assigner !== void 0 && { assigner }
  };
}
function toDecisionRule(rule, type) {
  return {
    type,
    action: rule.action,
    ...rule.target !== void 0 && { target: rule.target },
    ...rule.assignee !== void 0 && { assignee: rule.assignee },
    ...rule.id !== void 0 && { id: rule.id }
  };
}
function ruleMatches(rule, request, now) {
  if (!actionApplies(rule.action, request.action)) {
    return false;
  }
  if (rule.target !== void 0 && rule.target !== request.target) {
    return false;
  }
  if (rule.assignee !== void 0 && rule.assignee !== request.agent) {
    return false;
  }
  for (const c of rule.constraints ?? []) {
    if (!constraintSatisfied(c, request, now)) {
      return false;
    }
  }
  return true;
}
function actionApplies(ruleAction, requested) {
  return ACTION_IMPLIED_BY[requested].has(ruleAction);
}
function collectDuties(policy, matchedPermissionRules, request, now) {
  const out = [];
  for (const rule of matchedPermissionRules) {
    for (const duty of rule.duties ?? []) {
      out.push(toActiveDuty(duty, request, now));
    }
  }
  for (const duty of policy.obligations ?? []) {
    out.push(toActiveDuty(duty, request, now));
  }
  return out;
}
function toActiveDuty(duty, request, now) {
  const constraintsOk = (duty.constraints ?? []).every((c) => constraintSatisfied(c, request, now));
  const key = `fulfilled:${duty.action}`;
  const asserted = request.attributes?.[key];
  const dischargedAsserted = asserted === true || asserted === "true" || asserted === 1;
  return {
    action: duty.action,
    ...duty.target !== void 0 && { target: duty.target },
    ...duty.id !== void 0 && { id: duty.id },
    fulfilled: constraintsOk && dischargedAsserted
  };
}
function constraintSatisfied(c, request, now) {
  const supplied = requestValueFor(c, request, now);
  if (supplied === void 0) {
    return false;
  }
  return compare(supplied, c, c.operator);
}
function requestValueFor(c, request, now) {
  const fromAttrs = request.attributes?.[c.leftOperand];
  if (fromAttrs !== void 0) {
    if (typeof fromAttrs === "boolean") {
      return void 0;
    }
    return fromAttrs;
  }
  if (c.leftOperand === "dateTime") {
    return now.toISOString();
  }
  return void 0;
}
function compare(requestValue, c, operator) {
  const rights = Array.isArray(c.rightOperand) ? c.rightOperand : [c.rightOperand];
  const scalar = Array.isArray(requestValue) ? requestValue[0] : requestValue;
  const right0 = rights[0];
  switch (operator) {
    case "eq":
      return scalarsEqual(scalar, right0, c);
    case "neq":
      return !scalarsEqual(scalar, right0, c);
    case "gt":
      return numericOrTemporalCompare(scalar, right0, c) > 0;
    case "gteq":
      return numericOrTemporalCompare(scalar, right0, c) >= 0;
    case "lt":
      return numericOrTemporalCompare(scalar, right0, c) < 0;
    case "lteq":
      return numericOrTemporalCompare(scalar, right0, c) <= 0;
    case "isAnyOf":
      return asArray2(requestValue).some((rv) => rights.some((r) => scalarsEqual(rv, r, c)));
    case "isNoneOf":
      return asArray2(requestValue).every((rv) => rights.every((r) => !scalarsEqual(rv, r, c)));
    case "isAllOf": {
      const rvSet = asArray2(requestValue);
      return rights.every((r) => rvSet.some((rv) => scalarsEqual(rv, r, c)));
    }
    default:
      return false;
  }
}
function asArray2(v) {
  return Array.isArray(v) ? v : [v];
}
function scalarsEqual(a, b, c) {
  const cmp = tryNumericOrTemporal(a, b, c);
  if (cmp !== void 0) {
    return cmp === 0;
  }
  return String(a) === String(b);
}
function cmp3(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
function numericOrTemporalCompare(a, b, c) {
  const typed = tryNumericOrTemporal(a, b, c);
  if (typed !== void 0) {
    return typed;
  }
  return cmp3(String(a), String(b));
}
function tryNumericOrTemporal(a, b, c) {
  const isTemporal = c.leftOperand === "dateTime" || c.datatype === `${XSD}dateTime` || c.datatype === `${XSD}date`;
  if (isTemporal) {
    const ta = Date.parse(String(a));
    const tb = Date.parse(String(b));
    return Number.isNaN(ta) || Number.isNaN(tb) ? void 0 : cmp3(ta, tb);
  }
  if (!isFiniteNumber(a) || !isFiniteNumber(b)) {
    return void 0;
  }
  return cmp3(Number(a), Number(b));
}
function isFiniteNumber(v) {
  if (typeof v === "number") {
    return Number.isFinite(v);
  }
  const s = v.trim();
  if (s === "") {
    return false;
  }
  return Number.isFinite(Number(s));
}

// src/delegation.ts
var DEFAULT_MAX_CHAIN_LENGTH = 8;
function evaluateDelegated(chain, request, options = {}) {
  const now = options.now ?? /* @__PURE__ */ new Date();
  const maxLen = options.maxChainLength ?? DEFAULT_MAX_CHAIN_LENGTH;
  const hops = [];
  if (chain.length === 0) {
    return denied("Empty delegation chain \u2014 nothing grants the request.", hops);
  }
  if (!Number.isInteger(maxLen) || maxLen < 1) {
    return denied(`Invalid maxChainLength ${String(maxLen)} \u2014 must be a positive integer.`, hops);
  }
  if (chain.length > maxLen) {
    return denied(
      `Chain length ${chain.length} exceeds the maximum ${maxLen} (maxChainLength).`,
      hops
    );
  }
  const req = stripDelegationDepth(request);
  const seen = /* @__PURE__ */ new Set();
  for (const [i, policy] of chain.entries()) {
    if (policy.id === void 0 || policy.id === "") {
      return denied(`Hop ${i} has no policy id \u2014 the chain edge cannot be verified.`, hops);
    }
    if (seen.has(policy.id)) {
      return denied(`Cyclic chain: policy <${policy.id}> appears more than once.`, hops);
    }
    seen.add(policy.id);
  }
  const revoked = new Set(
    typeof options.revoked === "string" ? [options.revoked] : options.revoked ?? []
  );
  for (const [i, policy] of chain.entries()) {
    if (revoked.has(policy.id)) {
      return denied(`Hop ${i} (<${policy.id}>) has been revoked.`, hops);
    }
  }
  const strictProhibitions = chain.length > 1;
  const aggregateDuties = [];
  for (let i = 1; i < chain.length; i++) {
    const parent = chain[i - 1];
    const child = chain[i];
    const remainingDepth = chain.length - i;
    const edge = checkDelegationEdge(parent, child, remainingDepth, req, now);
    if (!edge.ok) {
      hops.push({ index: i, policyId: child.id, ok: false, reason: edge.reason });
      return denied(`Hop ${i} (<${child.id}>): ${edge.reason}`, hops);
    }
    hops.push({ index: i, policyId: child.id, ok: true, reason: "ok" });
    aggregateDuties.push(...edge.duties);
  }
  for (let i = 0; i < chain.length - 1; i++) {
    const ancestor = chain[i];
    const delegator = chain[i + 1].assigner;
    const scope = evaluate(ancestor, { ...req, agent: delegator }, { now });
    if (scope.decision !== "permit" || scope.matchedProhibitions.length > 0) {
      return denied(
        `Hop ${i} (<${ancestor.id}>) does not cleanly grant the requested capability to its delegate <${delegator}> (${scope.decision}${scope.matchedProhibitions.length > 0 ? ", with a matched prohibition" : ""}: ${scope.reason}) \u2014 a delegate cannot receive more than the delegator holds.`,
        hops
      );
    }
    const direct = evaluate(ancestor, req, { now });
    if (direct.decision === "deny" || direct.matchedProhibitions.length > 0) {
      return denied(
        `Hop ${i} (<${ancestor.id}>) prohibits the request directly (${direct.reason}).`,
        hops
      );
    }
    aggregateDuties.push(...scope.duties);
  }
  const leafPolicy = chain[chain.length - 1];
  const leaf = evaluate(leafPolicy, req, { now });
  if (leaf.decision !== "permit" || strictProhibitions && leaf.matchedProhibitions.length > 0) {
    return {
      ...denied(
        leaf.decision !== "permit" ? `Leaf policy <${leafPolicy.id}> does not permit: ${leaf.reason}` : `Leaf policy <${leafPolicy.id}> permits only via its odrl:perm conflict strategy over a matched prohibition \u2014 prohibitions are strict in a delegation chain.`,
        hops
      ),
      leaf
    };
  }
  if (chain.length > 1 && req.agent !== leafPolicy.assignee) {
    return {
      ...denied(
        `Leaf policy <${leafPolicy.id}> permits the request, but its actual actor <${req.agent ?? "(none)"}> is not the hop's declared delegate <${leafPolicy.assignee ?? "(none)"}> \u2014 a delegated hop must not grant to a party other than its odrl:assignee (identity-composition guard).`,
        hops
      ),
      leaf
    };
  }
  aggregateDuties.push(...leaf.duties);
  const duties = dedupeDuties(aggregateDuties);
  if (options.requireDuties) {
    const outstanding = duties.filter((d) => !d.fulfilled);
    if (outstanding.length > 0) {
      const names = outstanding.map((d) => d.action).join(", ");
      return {
        ...denied(
          `Chain permits, but requireDuties is set and these chain duties are unfulfilled: ${names}.`,
          hops
        ),
        leaf,
        duties
      };
    }
  }
  return {
    decision: "permit",
    reason: chain.length === 1 ? "The policy permits the request (single-policy chain)." : `Every hop of the ${chain.length - 1}-hop delegation chain is valid and the request is within the chain intersection.`,
    hops,
    leaf,
    duties
  };
}
function edgeFailure(reason) {
  return { ok: false, reason };
}
function checkDelegationEdge(parent, child, remainingDepth, req, now) {
  if (child.type !== "Agreement") {
    return edgeFailure(`a delegated hop must be an odrl:Agreement (got ${child.type ?? "Set"}).`);
  }
  if (child.assigner === void 0 || child.assignee === void 0) {
    return edgeFailure(
      "a delegated hop must name both assigner (the delegator) and assignee (the delegate)."
    );
  }
  if (child.delegatedUnder !== parent.id) {
    return edgeFailure(
      `the hop must declare odrld:delegatedUnder <${parent.id}> (got ${child.delegatedUnder === void 0 ? "none" : `<${child.delegatedUnder}>`}).`
    );
  }
  const authRequest = {
    agent: child.assigner,
    action: "grantUse",
    ...req.target !== void 0 && { target: req.target },
    attributes: { ...req.attributes ?? {}, delegationDepth: remainingDepth }
  };
  const auth = evaluate(parent, authRequest, { now });
  if (auth.decision !== "permit" || auth.matchedProhibitions.length > 0) {
    return edgeFailure(
      `the parent policy does not cleanly authorise delegation by <${child.assigner}> (${auth.decision}${auth.matchedProhibitions.length > 0 ? ", with a matched prohibition" : ""}: ${auth.reason}).`
    );
  }
  const candidates = matchingPermissions(parent, authRequest, { now }).filter(
    (r) => r.action === "grantUse" && r.assignee === child.assigner
  );
  if (candidates.length === 0) {
    return edgeFailure(
      `the parent policy has no grantUse permission explicitly naming <${child.assigner}> as assignee (an assignee-free grantUse does not authorise delegation).`
    );
  }
  const authorizing = [];
  const failures = [];
  for (const rule of candidates) {
    const failure = checkGrantUseRule(rule, child, remainingDepth);
    if (failure === void 0) {
      authorizing.push(rule);
    } else {
      failures.push(failure);
    }
  }
  if (authorizing.length === 0) {
    return edgeFailure(failures.join(" / "));
  }
  const dutySource = {
    id: parent.id,
    permissions: authorizing,
    ...parent.obligations !== void 0 && { obligations: parent.obligations }
  };
  const edgeDuties = evaluate(dutySource, authRequest, { now }).duties;
  return {
    ok: true,
    duties: edgeDuties.filter((d) => d.action !== "nextPolicy")
  };
}
function checkGrantUseRule(rule, child, remainingDepth) {
  const hasDepthConstraint = (rule.constraints ?? []).some(
    (c) => c.leftOperand === "delegationDepth"
  );
  if (!hasDepthConstraint && remainingDepth > 1) {
    return `grantUse permission carries no delegationDepth constraint, so its budget is the profile default of 1 hop \u2014 ${remainingDepth} remaining hops exceed it`;
  }
  for (const duty of rule.duties ?? []) {
    if (duty.action !== "nextPolicy") {
      continue;
    }
    if (duty.target === void 0) {
      return "grantUse permission carries a nextPolicy duty with no target policy (malformed)";
    }
    if (duty.target !== child.id) {
      return `grantUse permission mandates nextPolicy <${duty.target}> but the delegated hop is <${child.id}>`;
    }
  }
  return void 0;
}
function denied(reason, hops) {
  return { decision: "deny", reason, hops, duties: [] };
}
function stripDelegationDepth(request) {
  if (request.attributes === void 0 || !("delegationDepth" in request.attributes)) {
    return request;
  }
  const { delegationDepth: _reserved, ...rest } = request.attributes;
  const { attributes: _dropped, ...requestWithout } = request;
  return Object.keys(rest).length > 0 ? { ...requestWithout, attributes: rest } : requestWithout;
}
function dedupeDuties(duties) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const d of duties) {
    const key = `${d.action}\0${d.target ?? ""}\0${d.id ?? ""}\0${d.fulfilled}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(d);
    }
  }
  return out;
}
function delegationProvenance(chain) {
  const b = new GraphBuilder();
  for (const [i, policy] of chain.entries()) {
    if (policy.id === void 0 || policy.id === "") {
      continue;
    }
    const subject = iriRef(policy.id);
    if (policy.assigner !== void 0) {
      b.addIri(subject, PROV_WAS_ATTRIBUTED_TO, policy.assigner);
    }
    if (i > 0) {
      const parent = chain[i - 1];
      if (parent.id !== void 0 && parent.id !== "") {
        b.addIri(subject, ODRLD_DELEGATED_UNDER, parent.id);
        b.addIri(subject, PROV_WAS_DERIVED_FROM, parent.id);
      }
      if (policy.assignee !== void 0 && policy.assigner !== void 0) {
        b.addIri(iriRef(policy.assignee), PROV_ACTED_ON_BEHALF_OF, policy.assigner);
      }
    }
  }
  return b.quads();
}

// node_modules/@jeswr/fetch-rdf/dist/parse.js
import contentType from "content-type";
import { Store as Store2, StreamParser } from "n3";
import { JsonLdParser } from "jsonld-streaming-parser";

// node_modules/@jeswr/fetch-rdf/dist/errors.js
var RdfFetchError = class extends Error {
  /** The original cause, if any (e.g. a network error or parser exception). */
  cause;
  /** HTTP status code from a non-2xx response, if applicable. */
  status;
  /** The final request URL (after redirects), if known. */
  url;
  /** Raw `Content-Type` header from the response, if known. */
  contentType;
  constructor(message, options = {}) {
    super(message);
    this.name = "RdfFetchError";
    if (options.cause !== void 0)
      this.cause = options.cause;
    if (options.status !== void 0)
      this.status = options.status;
    if (options.url !== void 0)
      this.url = options.url;
    if (options.contentType !== void 0)
      this.contentType = options.contentType;
  }
};

// node_modules/@jeswr/fetch-rdf/dist/parse.js
var SUPPORTED_RDF_MEDIA_TYPES = [
  "text/turtle",
  "application/n-triples",
  "application/n-quads",
  "application/trig",
  "application/ld+json"
];
var N3_FAMILY = /* @__PURE__ */ new Set([
  "text/turtle",
  "application/n-triples",
  "application/n-quads",
  "application/trig"
]);
var JSON_LD_FAMILY = /* @__PURE__ */ new Set([
  "application/ld+json"
]);
async function parseRdf(body, contentTypeHeader, options = {}) {
  const rawHeader = contentTypeHeader ?? "text/turtle";
  let mediaType;
  try {
    mediaType = contentType.parse(rawHeader).type;
  } catch (cause) {
    throw new RdfFetchError(`Invalid Content-Type header: "${rawHeader}".`, { cause, contentType: rawHeader });
  }
  const baseIRI = options.baseIRI;
  let parser;
  if (N3_FAMILY.has(mediaType)) {
    parser = new StreamParser({
      format: mediaType,
      ...baseIRI !== void 0 && { baseIRI }
    });
  } else if (JSON_LD_FAMILY.has(mediaType)) {
    parser = new JsonLdParser({
      ...baseIRI !== void 0 && { baseIRI }
    });
  } else {
    throw new RdfFetchError(`Unsupported RDF media type: "${mediaType}". Supported: ${SUPPORTED_RDF_MEDIA_TYPES.join(", ")}.`, { contentType: rawHeader, ...baseIRI !== void 0 && { url: baseIRI } });
  }
  const storePromise = collectIntoStore(parser);
  try {
    await pumpBody(parser, body);
    return await storePromise;
  } catch (cause) {
    if (cause instanceof RdfFetchError)
      throw cause;
    throw new RdfFetchError(`Failed to parse ${mediaType} body${baseIRI ? ` at ${baseIRI}` : ""}.`, { cause, contentType: rawHeader, ...baseIRI !== void 0 && { url: baseIRI } });
  }
}
function collectIntoStore(parser) {
  return new Promise((resolve, reject) => {
    const store = new Store2();
    parser.on("data", (quad) => {
      store.addQuad(quad);
    });
    parser.on("error", reject);
    parser.on("end", () => {
      resolve(store);
    });
  });
}
async function pumpBody(parser, body) {
  if (typeof body === "string") {
    parser.end(body);
    return;
  }
  let parserError = null;
  const onParserError = (err) => {
    parserError = err;
  };
  parser.on("error", onParserError);
  const reader = body.getReader();
  try {
    const decoder = new TextDecoder();
    for (; ; ) {
      if (parserError)
        throw parserError;
      const { done, value } = await reader.read();
      if (done)
        break;
      if (value === void 0)
        continue;
      const text = decoder.decode(value, { stream: true });
      if (text.length === 0)
        continue;
      if (!parser.write(text))
        await waitForDrain(parser);
    }
    if (parserError)
      throw parserError;
    const tail = decoder.decode();
    if (tail.length > 0)
      parser.write(tail);
    parser.end();
  } catch (err) {
    parser.destroy(err instanceof Error ? err : new Error(String(err)));
    try {
      await reader.cancel();
    } catch {
    }
    throw err;
  } finally {
    parser.off("error", onParserError);
    reader.releaseLock();
  }
}
function waitForDrain(parser) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      parser.off("drain", onDrain);
      parser.off("error", onError);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onError = (err) => {
      cleanup();
      reject(err);
    };
    parser.once("drain", onDrain);
    parser.once("error", onError);
  });
}

// src/serialize.ts
import { legacySerialize } from "@jeswr/rdf-serialize";
var PREFIXES = {
  odrl: ODRL,
  acl: ACL,
  dpv: DPV,
  xsd: XSD,
  dcterms: DCTERMS,
  rdf: RDF,
  rdfs: RDFS
};
function serialize(quads, format = "text/turtle") {
  return legacySerialize(quads, format, PREFIXES);
}

// src/policy.ts
function policyTypeIri(type) {
  switch (type) {
    case "Offer":
      return ODRL_OFFER;
    case "Agreement":
      return ODRL_AGREEMENT;
    default:
      return ODRL_SET;
  }
}
function policyTypeOf(iri) {
  if (iri === ODRL_OFFER) return "Offer";
  if (iri === ODRL_AGREEMENT) return "Agreement";
  if (iri === ODRL_SET) return "Set";
  return void 0;
}
function inferDatatype(c, value) {
  if (c.datatype !== void 0) {
    return c.datatype;
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? `${XSD}integer` : `${XSD}decimal`;
  }
  if (c.leftOperand === "dateTime") {
    return `${XSD}dateTime`;
  }
  return void 0;
}
function writeConstraint(b, parent, c) {
  const node = b.linkBlankNode(parent, ODRL_CONSTRAINT);
  b.addIri(node, ODRL_LEFT_OPERAND, LEFT_OPERAND_IRI[c.leftOperand]);
  b.addIri(node, ODRL_OPERATOR, OPERATOR_IRI[c.operator]);
  const rights = Array.isArray(c.rightOperand) ? c.rightOperand : [c.rightOperand];
  for (const r of rights) {
    const safe = iriOperand(r, c.leftOperand);
    if (safe !== void 0) {
      b.addIri(node, ODRL_RIGHT_OPERAND, safe);
    } else {
      const dt = inferDatatype(c, r);
      b.addLiteral(node, ODRL_RIGHT_OPERAND, String(r), dt);
    }
  }
}
function iriOperand(r, left) {
  if (typeof r !== "string" || !isIriValued(left)) {
    return void 0;
  }
  const safe = safeIri(r);
  if (safe === void 0) {
    return void 0;
  }
  if (safe !== r) {
    const shown = r.length > 200 ? `${r.slice(0, 200)}\u2026` : r;
    throw new OdrlSerializationError(
      `Refusing to serialise policy: an IRI-valued constraint right-operand (${left}) contains characters that require escaping, got ${JSON.stringify(shown)}. An evaluation-critical IRI operand must be a clean absolute IRI so the constraint decides identically in-memory and after a serialise\u2192parse round-trip; silently escaping it would WIDEN a neq/isNoneOf constraint (fail-closed).`
    );
  }
  return safe;
}
function isIriValued(left) {
  return left === "recipient" || left === "purpose" || left === "spatial" || left === "systemDevice";
}
var OdrlSerializationError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "OdrlSerializationError";
  }
};
function requireHttpIri(value, field) {
  if (value === void 0) {
    return void 0;
  }
  const shown = value.length > 200 ? `${value.slice(0, 200)}\u2026` : value;
  const safe = safeHttpIri(value);
  if (safe === void 0) {
    throw new OdrlSerializationError(
      `Refusing to serialise policy: ${field} must be an http(s) IRI, got ${JSON.stringify(shown)}. Dropping it would widen the policy to a wildcard (fail-closed).`
    );
  }
  if (safe !== value) {
    throw new OdrlSerializationError(
      `Refusing to serialise policy: ${field} contains characters that require escaping, got ${JSON.stringify(
        shown
      )}. An evaluation-critical IRI (target/assignee/assigner/profile) must be a clean absolute http(s) IRI so it evaluates identically in-memory and after a serialise\u2192parse round-trip.`
    );
  }
  return safe;
}
function writeDuty(b, parent, predicate, duty) {
  const node = b.linkChild(parent, predicate, duty.id);
  b.addIri(node, ODRL_ACTION, ACTION_IRI[duty.action]);
  const dutyTarget = requireHttpIri(duty.target, "duty.target");
  if (dutyTarget !== void 0) {
    b.addIri(node, ODRL_TARGET, dutyTarget);
  }
  for (const c of duty.constraints ?? []) {
    writeConstraint(b, node, c);
  }
}
function writeRule(b, policy, rule, inheritedAssigner, inheritedAssignee) {
  const predicate = rule.type === "prohibition" ? ODRL_PROHIBITION : ODRL_PERMISSION;
  const node = b.linkChild(policy, predicate, rule.id);
  b.addIri(node, ODRL_ACTION, ACTION_IRI[rule.action]);
  const target = requireHttpIri(rule.target, "rule.target");
  if (target !== void 0) {
    b.addIri(node, ODRL_TARGET, target);
  }
  const assignee = requireHttpIri(rule.assignee ?? inheritedAssignee, "rule.assignee");
  if (assignee !== void 0) {
    b.addIri(node, ODRL_ASSIGNEE, assignee);
  }
  const assigner = requireHttpIri(rule.assigner ?? inheritedAssigner, "rule.assigner");
  if (assigner !== void 0) {
    b.addIri(node, ODRL_ASSIGNER, assigner);
  }
  for (const c of rule.constraints ?? []) {
    writeConstraint(b, node, c);
  }
  if (rule.type === "permission") {
    for (const duty of rule.duties ?? []) {
      writeDuty(b, node, ODRL_DUTY, duty);
    }
  }
}
function policyToRdf(policy) {
  const b = new GraphBuilder();
  const subject = iriRef(policy.id);
  b.addIri(subject, RDF_TYPE, policyTypeIri(policy.type));
  b.addIri(subject, ODRL_UID, policy.id);
  for (const p of toArray(policy.profile)) {
    const safeProfile = requireHttpIri(p, "policy.profile");
    if (safeProfile !== void 0) {
      b.addIri(subject, ODRL_PROFILE, safeProfile);
    }
  }
  const policyAssigner = requireHttpIri(policy.assigner, "policy.assigner");
  if (policyAssigner !== void 0) {
    b.addIri(subject, ODRL_ASSIGNER, policyAssigner);
  }
  const policyAssignee = requireHttpIri(policy.assignee, "policy.assignee");
  if (policyAssignee !== void 0) {
    b.addIri(subject, ODRL_ASSIGNEE, policyAssignee);
  }
  if (policy.conflict !== void 0) {
    b.addIri(subject, ODRL_CONFLICT, CONFLICT_IRI[policy.conflict]);
  }
  if (policy.delegatedUnder !== void 0) {
    b.addIri(subject, ODRLD_DELEGATED_UNDER, policy.delegatedUnder);
  }
  for (const rule of policy.permissions ?? []) {
    writeRule(b, subject, { ...rule, type: "permission" }, policy.assigner, policy.assignee);
  }
  for (const rule of policy.prohibitions ?? []) {
    writeRule(b, subject, { ...rule, type: "prohibition" }, policy.assigner, policy.assignee);
  }
  for (const duty of policy.obligations ?? []) {
    writeDuty(b, subject, ODRL_OBLIGATION, duty);
  }
  return b.quads();
}
function toArray(v) {
  if (v === void 0) return [];
  return Array.isArray(v) ? v : [v];
}
function policyToTurtle(policy, format) {
  return serialize(policyToRdf(policy), format);
}
function policyToJsonLd(policy) {
  const id = escapeIri(policy.id);
  const context = policy.delegatedUnder !== void 0 ? { ...ODRL_INLINE_CONTEXT, ...ODRLD_INLINE_CONTEXT_EXTENSION } : ODRL_INLINE_CONTEXT;
  const doc = {
    "@context": context,
    "@id": id,
    "@type": `odrl:${policy.type ?? "Set"}`,
    uid: { "@id": id }
  };
  const profiles = toArray(policy.profile);
  const emittedProfiles = profiles.map((p) => requireHttpIri(p, "policy.profile")).filter((p) => p !== void 0);
  if (emittedProfiles.length > 0) {
    doc.profile = emittedProfiles.map((p) => ({ "@id": p }));
  }
  const jsonAssigner = requireHttpIri(policy.assigner, "policy.assigner");
  if (jsonAssigner !== void 0) doc.assigner = { "@id": jsonAssigner };
  const jsonAssignee = requireHttpIri(policy.assignee, "policy.assignee");
  if (jsonAssignee !== void 0) doc.assignee = { "@id": jsonAssignee };
  if (policy.conflict !== void 0) doc.conflict = { "@id": CONFLICT_IRI[policy.conflict] };
  if (policy.delegatedUnder !== void 0)
    doc.delegatedUnder = { "@id": escapeIri(policy.delegatedUnder) };
  if (policy.permissions && policy.permissions.length > 0) {
    doc.permission = policy.permissions.map((r) => ruleJsonLd(r, policy));
  }
  if (policy.prohibitions && policy.prohibitions.length > 0) {
    doc.prohibition = policy.prohibitions.map((r) => ruleJsonLd(r, policy));
  }
  if (policy.obligations && policy.obligations.length > 0) {
    doc.obligation = policy.obligations.map((d) => dutyJsonLd(d));
  }
  return doc;
}
function ruleJsonLd(rule, policy) {
  const node = {};
  if (rule.id !== void 0) node["@id"] = escapeIri(rule.id);
  node.action = { "@id": ACTION_IRI[rule.action] };
  const target = requireHttpIri(rule.target, "rule.target");
  if (target !== void 0) node.target = { "@id": target };
  const assignee = requireHttpIri(rule.assignee ?? policy.assignee, "rule.assignee");
  if (assignee !== void 0) node.assignee = { "@id": assignee };
  const assigner = requireHttpIri(rule.assigner ?? policy.assigner, "rule.assigner");
  if (assigner !== void 0) node.assigner = { "@id": assigner };
  if (rule.constraints && rule.constraints.length > 0) {
    node.constraint = rule.constraints.map((c) => constraintJsonLd(c));
  }
  if (rule.type === "permission" && rule.duties && rule.duties.length > 0) {
    node.duty = rule.duties.map((d) => dutyJsonLd(d));
  }
  return node;
}
function dutyJsonLd(duty) {
  const node = {};
  if (duty.id !== void 0) node["@id"] = escapeIri(duty.id);
  node.action = { "@id": ACTION_IRI[duty.action] };
  const target = requireHttpIri(duty.target, "duty.target");
  if (target !== void 0) node.target = { "@id": target };
  if (duty.constraints && duty.constraints.length > 0) {
    node.constraint = duty.constraints.map((c) => constraintJsonLd(c));
  }
  return node;
}
function constraintJsonLd(c) {
  const node = {
    leftOperand: { "@id": LEFT_OPERAND_IRI[c.leftOperand] },
    operator: { "@id": OPERATOR_IRI[c.operator] }
  };
  const rights = Array.isArray(c.rightOperand) ? c.rightOperand : [c.rightOperand];
  const emitted = rights.map((r) => {
    const safe = iriOperand(r, c.leftOperand);
    if (safe !== void 0) {
      return { "@id": safe };
    }
    const dt = inferDatatype(c, r);
    return dt !== void 0 ? { "@value": String(r), "@type": dt } : String(r);
  });
  node.rightOperand = emitted.length === 1 ? emitted[0] : emitted;
  return node;
}
function policyFromRdf(dataset) {
  for (const node of wrapPolicy(dataset).policies()) {
    const policy = projectPolicy(node);
    if (policy !== void 0) {
      return policy;
    }
  }
  return void 0;
}
async function parsePolicy(input, contentType2 = "text/turtle", baseIRI) {
  const dataset = typeof input === "string" ? await parseRdf(input, contentType2, baseIRI ? { baseIRI } : {}) : input;
  return policyFromRdf(dataset);
}
function firstPolicyType(types) {
  for (const t of types) {
    if (t.termType === "NamedNode") {
      const pt = policyTypeOf(t.value);
      if (pt !== void 0) {
        return pt;
      }
    }
  }
  return void 0;
}
function profileField(profiles) {
  if (profiles.length === 0) {
    return {};
  }
  return { profile: profiles.length === 1 ? profiles[0] : profiles };
}
function projectPolicy(node) {
  const type = firstPolicyType(node.types);
  const profiles = [...node.profiles].filter((t) => t.termType === "NamedNode").map((t) => t.value);
  const assigner = firstIri(node.assigners);
  const assignee = firstIri(node.assignees);
  const conflictIri = firstIri(node.conflicts);
  const conflict = conflictIri !== void 0 ? IRI_TO_CONFLICT[conflictIri] : void 0;
  const delegatedUnder = firstIri(node.delegatedUnders);
  const permissions = [...node.permissions].map((r) => projectRule(r, "permission")).filter((r) => r !== void 0);
  const prohibitions = [...node.prohibitions].map((r) => projectRule(r, "prohibition")).filter((r) => r !== void 0);
  const obligations = [...node.obligations].map((d) => projectDuty(d)).filter((d) => d !== void 0);
  return {
    id: node.value,
    ...type !== void 0 && { type },
    ...profileField(profiles),
    ...assigner !== void 0 && { assigner },
    ...assignee !== void 0 && { assignee },
    ...conflict !== void 0 && { conflict },
    ...delegatedUnder !== void 0 && { delegatedUnder },
    ...permissions.length > 0 && { permissions },
    ...prohibitions.length > 0 && { prohibitions },
    ...obligations.length > 0 && { obligations }
  };
}
function projectRule(node, type) {
  const action = actionOf(node.actions);
  if (action === void 0) {
    return void 0;
  }
  const target = firstIri(node.targets);
  const assignee = firstIri(node.assignees);
  const assigner = firstIri(node.assigners);
  const constraints = [...node.constraints].map((c) => projectConstraint(c)).filter((c) => c !== void 0);
  const duties = type === "permission" ? [...node.duties].map((d) => projectDuty(d)).filter((d) => d !== void 0) : [];
  const id = node.termType === "NamedNode" ? node.value : void 0;
  return {
    type,
    action,
    ...id !== void 0 && { id },
    ...target !== void 0 && { target },
    ...assignee !== void 0 && { assignee },
    ...assigner !== void 0 && { assigner },
    ...constraints.length > 0 && { constraints },
    ...duties.length > 0 && { duties }
  };
}
function projectDuty(node) {
  const action = actionOf(node.actions);
  if (action === void 0) {
    return void 0;
  }
  const target = firstIri(node.targets);
  const constraints = [...node.constraints].map((c) => projectConstraint(c)).filter((c) => c !== void 0);
  const id = node.termType === "NamedNode" ? node.value : void 0;
  return {
    action,
    ...id !== void 0 && { id },
    ...target !== void 0 && { target },
    ...constraints.length > 0 && { constraints }
  };
}
function projectConstraint(node) {
  const leftIri = firstIri(node.leftOperands);
  const opIri = firstIri(node.operators);
  if (leftIri === void 0 || opIri === void 0) {
    return void 0;
  }
  const left = IRI_TO_LEFT_OPERAND[leftIri];
  const op = IRI_TO_OPERATOR[opIri];
  if (left === void 0 || op === void 0) {
    return void 0;
  }
  const values = allValues(node.rightOperands);
  if (values.length === 0) {
    return void 0;
  }
  const coerced = values.map((v) => coerceValue(v.value, v.datatype, v.isIri));
  const rightOperand = coerced.length === 1 ? coerced[0] : coerced;
  const dt = values[0]?.datatype;
  return {
    leftOperand: left,
    operator: op,
    rightOperand,
    ...dt !== void 0 && !values[0]?.isIri && { datatype: dt }
  };
}
function coerceValue(value, datatype, isIri) {
  if (isIri) {
    return value;
  }
  if (datatype === `${XSD}integer` || datatype === `${XSD}decimal` || datatype === `${XSD}double` || datatype === `${XSD}float` || datatype === `${XSD}long` || datatype === `${XSD}int`) {
    const n = Number(value);
    return Number.isNaN(n) ? value : n;
  }
  return value;
}
function actionOf(actions) {
  for (const a of actions) {
    if (a.termType === "NamedNode") {
      const name = IRI_TO_ACTION[a.value];
      if (name !== void 0) {
        return name;
      }
    }
  }
  return void 0;
}
export {
  A2A_ACTION_TO_ODRL,
  ACL,
  ACL_MODES,
  ACL_MODE_TO_ACTION,
  ACTION_IRI,
  CONFLICT_IRI,
  CONFLICT_STRATEGIES,
  DEFAULT_MAX_CHAIN_LENGTH,
  DPV,
  IRI_TO_ACTION,
  IRI_TO_LEFT_OPERAND,
  IRI_TO_OPERATOR,
  LEFT_OPERANDS,
  LEFT_OPERAND_IRI,
  ODRL,
  ODRLD,
  ODRLD_DELEGATED_UNDER,
  ODRLD_DELEGATION_DEPTH,
  ODRLD_INLINE_CONTEXT_EXTENSION,
  ODRLD_PROFILE_IRI,
  ODRLD_REVOCATION_CLASS,
  ODRLD_REVOKED_POLICY,
  ODRL_ACTIONS,
  ODRL_GRANT_USE,
  ODRL_INLINE_CONTEXT,
  ODRL_NEXT_POLICY,
  ODRL_TRANSFER,
  OPERATORS,
  OPERATOR_IRI,
  OdrlSerializationError,
  PROV,
  PROV_ACTED_ON_BEHALF_OF,
  PROV_ACTIVITY,
  PROV_AGENT,
  PROV_ASSOCIATION,
  PROV_ENDED_AT_TIME,
  PROV_GENERATED,
  PROV_HAD_PLAN,
  PROV_INLINE_CONTEXT,
  PROV_QUALIFIED_ASSOCIATION,
  PROV_STARTED_AT_TIME,
  PROV_USED,
  PROV_WAS_ASSOCIATED_WITH,
  PROV_WAS_ATTRIBUTED_TO,
  PROV_WAS_DERIVED_FROM,
  PROV_WAS_GENERATED_BY,
  VALID_ACTION_IRIS,
  XSD_DATETIME,
  actionProvenance,
  actionProvenanceJsonLd,
  constraintSatisfied,
  delegationProvenance,
  escapeIri,
  evaluate,
  evaluateDelegated,
  matchingPermissions,
  parsePolicy,
  policyFromRdf,
  policyToJsonLd,
  policyToRdf,
  policyToTurtle,
  requestContextFromA2AIntent,
  requestContextFromWac,
  safeHttpIri,
  safeIri,
  serialize
};
//# sourceMappingURL=index.js.map
