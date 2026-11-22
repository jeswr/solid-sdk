// AUTHORED-BY Codex GPT-6.2 Sol
// AUTHORED-BY Codex GPT-6
import type { Term } from "@jeswr/fetch-rdf";
import {
  IRI_TO_ACTION,
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
  readStoreText,
  StoreNode,
  storeIdentifier,
  storeModel,
  storeText,
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
const PAY = `${AWP}pay` as const;
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
  action === "pay" ? PAY : Object.hasOwn(IRI_TO_ACTION, action) ? IRI_TO_ACTION[action]! : action;
const predicates = [
  ["permissions", ODRL_PERMISSION],
  ["prohibitions", ODRL_PROHIBITION],
  ["obligations", ODRL_OBLIGATION],
] as const;

function writeIdentifier(node: StoreNode, predicate: string, value: string | undefined): void {
  if (value !== undefined) node.put(predicate, storeIdentifier(value));
}

function readIdentifier(node: StoreNode, predicate: string): string | undefined {
  const term = node.term(predicate);
  if (term !== undefined) return term.termType === "NamedNode" ? term.value : readStoreText(term);
}

export function policySubject(id: string): string {
  const term = storeIdentifier(id);
  return term.termType === "NamedNode" ? id : scopedId("urn:awp:policy", JSON.stringify(id));
}

type RuleOccurrence = { native: NativeRule | NativeDuty; position: number };
function standardPolicy(
  policy: NativePolicy,
  rootId: string,
  occurrences: Map<OdrlDuty, RuleOccurrence>,
): OdrlPolicy {
  const subjects = new Set([rootId]);
  let occurrence = 0;
  function lowerId(id: string | undefined): string | undefined {
    if (id !== undefined) {
      if (storeIdentifier(id).termType !== "NamedNode") id = undefined;
      while (id === undefined || subjects.has(id))
        id = scopedId(rootId, `rule-occurrence:${occurrence++}`);
      subjects.add(id);
    }
    return id;
  }
  // The local store writes parties, profiles and targets itself. Its lexical
  // values have already been admitted by the runtime.
  const lowerDuty = (native: NativeDuty, position: number): OdrlDuty => {
    const duty = {
      id: lowerId(native.id),
      action: lowerAction(native.action),
      constraints: native.constraints,
    };
    occurrences.set(duty, { native, position });
    return duty;
  };
  const lowerRule = (native: NativeRule, position: number): OdrlRule => {
    const rule = {
      id: lowerId(native.id),
      action: lowerAction(native.action),
      type: native.type,
      constraints: native.constraints,
      duties: native.duties?.map(lowerDuty),
    };
    occurrences.set(rule, { native, position });
    return rule;
  };
  return {
    ...policy,
    id: rootId,
    assigner: undefined,
    assignee: undefined,
    profile: undefined,
    permissions: policy.permissions?.map(lowerRule),
    prohibitions: policy.prohibitions?.map(lowerRule),
    obligations: policy.obligations?.map(lowerDuty),
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
function selectFields(
  node: StoreNode,
  known: Record<string, unknown>,
  ownerId = node.id,
): JsonObject {
  const fields = node.valueAt(FIELDS, ownerId);
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
function augmentRule(
  node: StoreNode,
  { native: rule, position }: RuleOccurrence,
  policy: NativePolicy,
) {
  putPosition(node, position);
  writeFields(node, rule);
  writeIdentifier(node, ODRL + "target", rule.target);
  if (rule.id !== node.id) writeIdentifier(node, NATIVE_ID, rule.id);
  if (
    rule.action.startsWith(ODRL) ||
    rule.action === PAY ||
    Object.hasOwn(IRI_TO_ACTION, rule.action)
  )
    node.put(NATIVE_ACTION, storeText(rule.action));
  if ("type" in rule) {
    writeIdentifier(node, ODRL + "assigner", rule.assigner ?? policy.assigner);
    writeIdentifier(node, ODRL + "assignee", rule.assignee ?? policy.assignee);
    node.put(RULE_KIND, literal(rule.type));
    if (rule.approvals !== undefined) node.putValue(APPROVALS, rule.approvals);
    if (rule.limit !== undefined) node.putValue(LIMIT, rule.limit);
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

export function policyDataset(policy: NativePolicy, location?: "memory"): IndexedStore {
  const rootId = policySubject(policy.id);
  const occurrences = new Map<OdrlDuty, RuleOccurrence>();
  const ruleNodes: Array<{ occurrence: RuleOccurrence; id: string; isBlank: boolean }> = [];
  const quads = policyToRdf(standardPolicy(policy, rootId, occurrences), {
    onRuleNode(rule, id, isBlank) {
      ruleNodes.push({ occurrence: occurrences.get(rule)!, id, isBlank });
    },
  });
  const blanks = new Map<string, string>();
  const used = new Set(ruleNodes.filter(({ isBlank }) => !isBlank).map(({ id }) => id));
  used.add(rootId);
  let blankIndex = 0;
  const replace = (term: Term): Term => {
    if (term.termType !== "BlankNode") return term;
    let id = blanks.get(term.value);
    if (id === undefined) {
      do {
        id = scopedId(rootId, "odrl:" + blankIndex++);
      } while (used.has(id));
      blanks.set(term.value, id);
    }
    return namedNode(id);
  };
  const graph = new IndexedStore();
  for (const { subject, predicate, object } of quads)
    graph.addQuad(quad(replace(subject) as never, predicate, replace(object) as never));
  const root = view(rootId, graph);
  root.types.add(ODRL + "Policy");
  writeFields(root, policy);
  if (rootId !== policy.id) root.put(NATIVE_ID, storeText(policy.id));
  writeIdentifier(root, ODRL + "assigner", policy.assigner);
  writeIdentifier(root, ODRL + "assignee", policy.assignee);
  if (typeof policy.profile === "string") writeIdentifier(root, ODRL + "profile", policy.profile);
  else if (policy.profile !== undefined) {
    root.putValue(PROFILE, policy.profile as Json);
    for (const iri of policy.profile) {
      if (storeIdentifier(iri).termType === "NamedNode") root.add(ODRL + "profile", iri);
    }
  }
  for (const { occurrence, id, isBlank } of ruleNodes)
    augmentRule(view(isBlank ? blanks.get(id)! : id, graph), occurrence, policy);
  if (location !== "memory") return inGraph(graph, rootId);

  // Several memory grants can share a native UID with different targets. The
  // projection subject also names its graph, while odrl:uid retains the native ID.
  const occurrence = namedNode(
    scopedId(rootId, "policy:" + digestBytes(writeNQuads(graph, Infinity))),
  );
  return new IndexedStore(
    [...graph].map(({ subject, predicate, object }) =>
      quad(subject.value === rootId ? occurrence : subject, predicate, object, occurrence),
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
    id: readIdentifier(node, NATIVE_ID) ?? projected.id,
    target: readIdentifier(node, ODRL + "target"),
    assigner: readIdentifier(node, ODRL + "assigner"),
    assignee: readIdentifier(node, ODRL + "assignee"),
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
  const projected = policyFromRdf(local, {
    allowedActionIris: local.getObjects(null, ODRL_ACTION, null).map((term) => term.value),
  });
  if (!projected || projected.id !== id) throw new TypeError("Expected a store ODRL policy");
  const root = view(id, local);
  const nativeId = root.term(ODRL_UID);
  if (nativeId?.termType !== "NamedNode") throw new TypeError("Expected a native ODRL UID");
  // The memory projection renames the policy subject after writing its values.
  // Its value IDs still use the original subject, which is retained as odrl:uid.
  const native: Record<string, unknown> = {
    ...projected,
    id: readIdentifier(root, NATIVE_ID) ?? nativeId.value,
    assigner: readIdentifier(root, ODRL + "assigner"),
    assignee: readIdentifier(root, ODRL + "assignee"),
    profile: root.valueAt(PROFILE, nativeId.value) ?? readIdentifier(root, ODRL + "profile"),
  };
  for (const [field, predicate] of predicates) {
    const rules = new Map(projected[field]?.map((rule) => [rule.id, rule]));
    native[field] = ordered(root, predicate).map((node) => {
      const rule = rules.get(node.id);
      if (!rule) throw new TypeError(`ODRL rule did not project at ${ODRL_ACTION}`);
      return decodeRule(node, rule);
    });
  }
  const decoded = selectFields(root, native, nativeId.value) as unknown as NativePolicy;
  const location = policySubject(decoded.id) === id ? undefined : "memory";
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
  root.put(AUTONOMOUS, namedNode(policySubject(mandate.autonomous.id)));
  root.put(WITH_APPROVAL, namedNode(policySubject(mandate.withApproval.id)));
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
