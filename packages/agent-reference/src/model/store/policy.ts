// AUTHORED-BY Codex GPT-6.2 Sol
// AUTHORED-BY Codex GPT-6
import type { Term } from "@jeswr/fetch-rdf";
import { isSafeAbsoluteIri } from "@jeswr/model-runtime";
import {
  IRI_TO_LEFT_OPERAND,
  IRI_TO_OPERATOR,
  type OdrlAction,
  type OdrlConstraint,
  type OdrlDuty,
  type OdrlPolicy,
  type OdrlRule,
  policyFromRdf,
  policyToRdf,
} from "@jeswr/solid-odrl";
import { DataFactory, type Store } from "n3";
import { digestBytes, digestOf } from "../../core/canonical.js";
import type { Json, JsonObject } from "../../core/types.js";
import type { LoadedMandate, OwnerMandate } from "../../mechanisms/mandate.js";
import { AWP, ODRL } from "../../profile/vocabulary.js";
import { writeNQuads } from "../../wire/store-quads.js";
import { copyData } from "../copy.js";
import { makeNode } from "../core-node.js";
import { EmbeddedCredentialNode } from "../evidence-item.js";
import { IndexedStore } from "../indexed-store.js";
import { SCHEMA, scopedId, XSD } from "../named-values.js";
import {
  assertSameGraph,
  field,
  graphContents,
  inGraph,
  link,
  RDF_TYPE,
  StoreNode,
  storeModel,
} from "./common.js";

const ODRL_ACTION = ODRL + "action";
const ODRL_CONSTRAINT = ODRL + "constraint";
const ODRL_DUTY = ODRL + "duty";
const ODRL_LEFT_OPERAND = ODRL + "leftOperand";
const ODRL_OBLIGATION = ODRL + "obligation";
const ODRL_OPERATOR = ODRL + "operator";
const ODRL_PERMISSION = ODRL + "permission";
const ODRL_PROHIBITION = ODRL + "prohibition";
const ODRL_UID = ODRL + "uid";
const PAY = AWP + "pay";
const FIELDS = AWP + "policyFields";
const PROFILE = AWP + "policyProfile";
const RIGHT = AWP + "policyRightOperand";
const DATATYPE = AWP + "policyOperandDatatype";
const NATIVE_ACTION = AWP + "policyActionSpelling";
const RULE_KIND = AWP + "policyRuleKind";
const NATIVE_ID = AWP + "recordIdentifier";
const APPROVALS = AWP + "policyApprovals";
const LIMIT = AWP + "policyLimit";
const POSITION = SCHEMA + "position";
const { namedNode, literal, quad } = DataFactory;
type NativeAction = OdrlAction | "pay";
type NativeRule = Omit<OdrlRule, "action" | "duties"> & {
  readonly action: NativeAction;
  readonly duties?: readonly NativeDuty[];
  readonly approvals?: Json;
  readonly limit?: Json;
};
type NativeDuty = Omit<OdrlDuty, "action"> & { readonly action: NativeAction };
export type NativePolicy = Omit<OdrlPolicy, "permissions" | "prohibitions" | "obligations"> & {
  readonly permissions?: readonly NativeRule[];
  readonly prohibitions?: readonly NativeRule[];
  readonly obligations?: readonly NativeDuty[];
};

const lowerAction = (action: NativeAction): OdrlAction =>
  action === "pay" ? (PAY as OdrlAction) : action;
const predicates = [
  ["permissions", ODRL_PERMISSION],
  ["prohibitions", ODRL_PROHIBITION],
  ["obligations", ODRL_OBLIGATION],
] as const;

/** The public ODRL writer accepts HTTP(S) and URNs for these fields. Store
 * projections may also carry clean absolute IRIs from other schemes, such as DIDs. */
function storeOnlyIri(iri: string): boolean {
  return !/^(https?|urn):/i.test(iri) && isSafeAbsoluteIri(iri);
}

function standardIri(iri: string | undefined): string | undefined {
  return iri !== undefined && storeOnlyIri(iri) ? undefined : iri;
}

function restoreIri(node: StoreNode, predicate: string, iri: string | undefined): void {
  if (iri !== undefined && storeOnlyIri(iri)) node.put(ODRL + predicate, namedNode(iri));
}

function standardPolicy(policy: NativePolicy): OdrlPolicy {
  const subjects = new Set([policy.id]);
  let occurrence = 0;
  const lower = <T extends NativeDuty>(rule: T): Omit<T, "action"> & { action: OdrlAction } => {
    let id = rule.id;
    // Repeated native rule IDs still refer to distinct native list occurrences.
    if (id !== undefined) {
      while (subjects.has(id)) id = scopedId(policy.id, `rule-occurrence:${occurrence++}`);
      subjects.add(id);
    }
    return { ...rule, id, action: lowerAction(rule.action), target: standardIri(rule.target) };
  };
  const lowerRule = ({ duties, ...rule }: NativeRule): OdrlRule => ({
    ...lower(rule),
    assigner: standardIri(rule.assigner),
    assignee: standardIri(rule.assignee),
    ...(duties && { duties: duties.map(lower) }),
  });
  return {
    ...policy,
    assigner: standardIri(policy.assigner),
    assignee: standardIri(policy.assignee),
    profile:
      typeof policy.profile === "string"
        ? standardIri(policy.profile)
        : policy.profile?.filter((iri) => !storeOnlyIri(iri)),
    permissions: policy.permissions?.map(lowerRule),
    prohibitions: policy.prohibitions?.map(lowerRule),
    obligations: policy.obligations?.map(lower),
  };
}

const view = (id: string | Term, graph: Store) => new StoreNode(id, graph, "StoredPolicy");
function putPosition(node: StoreNode, index: number) {
  node.put(POSITION, literal(String(index), namedNode(XSD + "integer")));
}

function writeFields(node: StoreNode, value: object) {
  node.putValue(
    FIELDS,
    Object.keys(value).filter((key) => (value as Record<string, unknown>)[key] !== undefined),
  );
}
function selectFields(node: StoreNode, known: Record<string, unknown>): JsonObject {
  const fields = node.valueAt(FIELDS);
  if (
    !Array.isArray(fields) ||
    new Set(fields).size !== fields.length ||
    fields.some(
      (field) =>
        typeof field !== "string" || !Object.hasOwn(known, field) || known[field] === undefined,
    )
  )
    throw new TypeError("Invalid native ODRL field set");
  return Object.fromEntries(fields.map((field) => [field, known[field as string]])) as JsonObject;
}

function children(node: StoreNode, predicate: string) {
  return node.terms(predicate).map((term) => {
    if (term.termType !== "NamedNode") throw new TypeError("Expected a named ODRL child");
    return view(term, node.dataset);
  });
}
function ordered(node: StoreNode, predicate: string) {
  const nodes = children(node, predicate);
  const position = (child: StoreNode) => {
    const term = child.term(POSITION);
    if (
      term?.termType !== "Literal" ||
      term.datatype.value !== XSD + "integer" ||
      !/^\d+$/.test(term.value)
    )
      throw new TypeError("Invalid ODRL position");
    return Number(term.value);
  };
  const ordered = nodes
    .map((node) => ({ node, position: position(node) }))
    .sort((a, b) => a.position - b.position);
  if (ordered.some(({ position }, index) => position !== index))
    throw new TypeError("Invalid ODRL order");
  return ordered.map(({ node }) => node);
}
function augmentRules(
  nodes: StoreNode[],
  rules: readonly (NativeRule | NativeDuty)[],
  policy?: NativePolicy,
) {
  if (nodes.length !== rules.length) throw new TypeError("Ambiguous ODRL rule identities");
  for (const [index, rule] of rules.entries()) {
    const node = nodes[index]!;
    putPosition(node, index);
    writeFields(node, rule);
    restoreIri(node, "target", rule.target);
    if (rule.id !== undefined && rule.id !== node.id) node.put(NATIVE_ID, namedNode(rule.id));
    if (rule.action.startsWith(ODRL) || rule.action === PAY)
      node.put(NATIVE_ACTION, literal(rule.action));
    if ("type" in rule) {
      restoreIri(node, "assigner", rule.assigner ?? policy?.assigner);
      restoreIri(node, "assignee", rule.assignee ?? policy?.assignee);
      node.put(RULE_KIND, literal(rule.type));
      if (rule.approvals !== undefined) node.putValue(APPROVALS, rule.approvals);
      if (rule.limit !== undefined) node.putValue(LIMIT, rule.limit);
      if (rule.duties?.length) augmentRules(children(node, ODRL_DUTY), rule.duties);
    }
    const constraints = children(node, ODRL_CONSTRAINT);
    for (const [position, c] of (rule.constraints ?? []).entries()) {
      const child = constraints[position]!;
      putPosition(child, position);
      // ODRL graph values are unordered-set terms. Preserve operand order, presence
      // and type spelling independently of the evaluator's inferred RDF datatype.
      child.putValue(RIGHT, c.rightOperand as Json);
      if (c.datatype !== undefined) child.put(DATATYPE, literal(c.datatype));
    }
  }
}

export function policyDataset(policy: NativePolicy, location?: "memory"): IndexedStore {
  const blanks = new Map<string, string>();
  const replace = (term: Term): Term => {
    if (term.termType !== "BlankNode") return term;
    if (!blanks.has(term.value)) blanks.set(term.value, scopedId(policy.id, "odrl:" + blanks.size));
    return namedNode(blanks.get(term.value)!);
  };
  const graph = new IndexedStore();
  for (const { subject, predicate, object } of policyToRdf(standardPolicy(policy)))
    graph.addQuad(quad(replace(subject) as never, predicate, replace(object) as never));
  const root = view(policy.id, graph);
  root.types.add(ODRL + "Policy");
  writeFields(root, policy);
  restoreIri(root, "assigner", policy.assigner);
  restoreIri(root, "assignee", policy.assignee);
  if (typeof policy.profile === "string") restoreIri(root, "profile", policy.profile);
  else if (policy.profile !== undefined) {
    root.putValue(PROFILE, policy.profile as Json);
    for (const iri of policy.profile) if (storeOnlyIri(iri)) root.add(ODRL + "profile", iri);
  }
  for (const [field, predicate] of predicates)
    augmentRules(children(root, predicate), policy[field] ?? [], policy);
  if (location !== "memory") return inGraph(graph, policy.id);

  // Several memory grants can share a native UID with different targets. The
  // projection subject also names its graph, while odrl:uid retains the native ID.
  const occurrence = namedNode(scopedId(policy.id, "policy:" + digestBytes(writeNQuads(graph))));
  return new IndexedStore(
    [...graph].map(({ subject, predicate, object }) =>
      quad(subject.value === policy.id ? occurrence : subject, predicate, object, occurrence),
    ),
  );
}

function decodeConstraint(node: StoreNode): OdrlConstraint {
  const leftOperand = IRI_TO_LEFT_OPERAND[node.term(ODRL_LEFT_OPERAND)?.value ?? ""];
  const operator = IRI_TO_OPERATOR[node.term(ODRL_OPERATOR)?.value ?? ""];
  const rightOperand = node.valueAt(RIGHT);
  const datatype = node.term(DATATYPE)?.value;
  if (!leftOperand || !operator || rightOperand === undefined)
    throw new TypeError("Invalid ODRL constraint");
  return {
    leftOperand,
    operator,
    rightOperand,
    ...(datatype !== undefined && { datatype }),
  } as OdrlConstraint;
}
function decodeRule(node: StoreNode, projected: OdrlRule | OdrlDuty): NativeRule | NativeDuty {
  const action =
    node.term(NATIVE_ACTION)?.value ?? (projected.action === PAY ? "pay" : projected.action);
  const constraints = ordered(node, ODRL_CONSTRAINT).map(decodeConstraint);
  const duties = ordered(node, ODRL_DUTY).map((duty) => {
    const found = ("duties" in projected ? projected.duties : undefined)?.find(
      ({ id }) => id === duty.id,
    );
    if (!found) throw new TypeError("ODRL duty did not project");
    return decodeRule(duty, found);
  });
  return selectFields(node, {
    ...projected,
    id: node.term(NATIVE_ID)?.value ?? projected.id,
    action,
    type: node.term(RULE_KIND)?.value,
    constraints,
    duties,
    approvals: node.valueAt(APPROVALS),
    limit: node.valueAt(LIMIT),
  }) as unknown as NativeRule | NativeDuty;
}
export function policyFromStore(dataset: Store, id: string): NativePolicy {
  const local = graphContents(dataset, id);
  const projected = policyFromRdf(local, { allowedActionIris: [PAY] });
  if (!projected || projected.id !== id) throw new TypeError("Expected a store ODRL policy");
  const root = view(id, local);
  const nativeId = root.term(ODRL_UID);
  if (nativeId?.termType !== "NamedNode") throw new TypeError("Expected a native ODRL UID");
  const native: Record<string, unknown> = {
    ...projected,
    id: nativeId.value,
    profile: root.valueAt(PROFILE) ?? projected.profile,
  };
  for (const [field, predicate] of predicates) {
    const rules = new Map(projected[field]?.map((rule) => [rule.id, rule]));
    native[field] = ordered(root, predicate).map((node) => {
      const rule = rules.get(node.id);
      if (!rule) throw new TypeError(`ODRL rule did not project at ${ODRL_ACTION}`);
      return decodeRule(node, rule);
    });
  }
  const decoded = selectFields(root, native) as unknown as NativePolicy;
  const location = decoded.id === id ? undefined : "memory";
  assertSameGraph(local, graphContents(policyDataset(decoded, location), id));
  return decoded;
}

const CREDENTIAL = AWP + "mandateCredential";
const CREDENTIAL_DIGEST = AWP + "mandateCredentialDigest";
const AUTONOMOUS = AWP + "autonomousPolicy";
const WITH_APPROVAL = AWP + "withApprovalPolicy";
const MANDATE_CLASS = AWP + "StoredMandate";
const MANDATE_GRAPH = "urn:awp:state:mandate";
const standingTerm = AWP + "standingRules";
const dutyTerm = AWP + "dutyRules";
storeModel("StandingRule", {
  id: field("id", "recordIdentifier"),
  when: field("open", "standingWhen"),
  allows: field("open", "standingAllows"),
  duties: field("value", "standingDuties"),
  expires: field("time", "effectiveUntil"),
});
storeModel("DutyRule", {
  kind: field("text", "dutyKind"),
  items: field("strings", "dutyItems", true),
  by: field("time", "effectiveUntil", true),
  on: field("text", "dutyOn", true),
  parties: field("strings", "dutyParties", true),
  withinSeconds: field("value", "dutyWithinSeconds", true),
  event: field("text", "dutyEvent", true),
});
storeModel("StoredMandate", {
  standing: link("nodes", standingTerm, "StandingRule", true),
  duties: link("nodes", dutyTerm, "DutyRule", true),
});

const mandates = new WeakMap<LoadedMandate, IndexedStore>();
export function mandateDataset(loaded: LoadedMandate): IndexedStore {
  const cached = mandates.get(loaded);
  if (cached) return cached;
  if (!loaded.credential) throw new TypeError("A store mandate needs its verified credential");
  const { mandate, credential } = loaded;
  const result = new IndexedStore([...credential.dataset]);
  const local = new IndexedStore();
  const root = makeNode(
    "StoredMandate",
    {
      standing: mandate.standing,
      duties: mandate.duties,
    },
    mandate.id,
    local,
  ) as StoreNode;
  root.put(CREDENTIAL, namedNode(credential.id));
  root.put(CREDENTIAL_DIGEST, literal(digestBytes(credential.originalJws)));
  root.put(AUTONOMOUS, namedNode(mandate.autonomous.id));
  root.put(WITH_APPROVAL, namedNode(mandate.withApproval.id));
  result.addQuads([...inGraph(local, MANDATE_GRAPH)]);
  result.addQuads([...policyDataset(mandate.autonomous)]);
  result.addQuads([...policyDataset(mandate.withApproval)]);
  mandates.set(loaded, result);
  return result;
}

/** Recover a projection and bind it to the loaded, verified credential. */
export function mandateFromStore(dataset: Store, loaded: LoadedMandate): OwnerMandate {
  const local = graphContents(dataset, MANDATE_GRAPH);
  const root = new StoreNode<Pick<OwnerMandate, "standing" | "duties">>(
    loaded.mandate.id,
    local,
    "StoredMandate",
  );
  if (
    !local
      .getSubjects(namedNode(RDF_TYPE), namedNode(MANDATE_CLASS), null)
      .some((term) => term.value === root.id)
  )
    throw new TypeError("Missing stored mandate");
  const credentialId = root.term(CREDENTIAL)?.value;
  if (!credentialId || !loaded.credential) throw new TypeError("Missing mandate credential");
  const credential = new EmbeddedCredentialNode(credentialId, dataset);
  if (
    credential.originalJws !== loaded.credential.originalJws ||
    root.term(CREDENTIAL_DIGEST)?.value !== digestBytes(credential.originalJws)
  )
    throw new TypeError("Mandate credential bytes differ");
  // The authority verifier has already lifted the credential into a native
  // mandate. An authorization-server token carries a grant rather than an
  // OwnerMandate payload, so use the verified lift for its non-policy fields.
  const { standing, duties, autonomous, withApproval, ...base } = copyData(loaded.mandate);
  const decoded = {
    ...base,
    ...root.read(),
    autonomous: policyFromStore(dataset, root.term(AUTONOMOUS)!.value),
    withApproval: policyFromStore(dataset, root.term(WITH_APPROVAL)!.value),
  } as OwnerMandate;
  if (digestOf(decoded) !== loaded.digest)
    throw new TypeError("Store mandate differs from its credential");
  assertSameGraph(dataset, mandateDataset(loaded));
  return decoded;
}
