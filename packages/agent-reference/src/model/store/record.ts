// AUTHORED-BY Codex GPT-6.2 Sol
import type { Term } from "@jeswr/fetch-rdf";
import { isSafeAbsoluteIri, readLiteral } from "@jeswr/model-runtime";
import { RequiredAs, TermFrom } from "@rdfjs/wrapper";
import { DataFactory, type Store } from "n3";
import { digestBytes, digestOf } from "../../core/canonical.js";
import { assertJsonBounds, resolveLimits } from "../../core/limits.js";
import { type Json, type JsonObject, REASON_CODES } from "../../core/types.js";
import { entities } from "../../generated/model.js";
import { AWP, ODRL, PROV } from "../../profile/vocabulary.js";
import type { LedgerEntry, LedgerRangeEntry } from "../../store/ledger.js";
import { INBOUND_CHECKS, OUTBOUND_CHECKS } from "../../trace/types.js";
import { CoreNode, type Field, registerModel } from "../core-node.js";
import { IndexedStore } from "../indexed-store.js";
import { NamedValuesNode, readValue, scopedId, writeValue, XSD } from "../named-values.js";
import { RdfNode } from "../nodes.js";

const { literal, namedNode } = DataFactory;
const VC = "https://www.w3.org/2018/credentials#";
const RECORD = AWP + "record";
const RECORD_TYPE = AWP + "recordType";
const VALUES = AWP + "recordValues";
const FIELD_ORDER = AWP + "recordFieldOrder";
const REASON = AWP + "reason";
const EXPLANATION = AWP + "recordExplanation";
const CHECKS = AWP + "recordChecks";
const ORIGINAL_DIGESTS = AWP + "recordOriginalDigests";
const SUBJECT = AWP + "subject";
const TRANSFER_SUBJECT_TEXT = AWP + "transferSubjectText";
const ENTRY_TIME = PROV + "generatedAtTime";
const APPROVAL_JWS = AWP + "approvalJws";
const APPROVAL_JWS_DIGEST = AWP + "approvalJwsDigest";
const UNTYPED = AWP + "UntypedRecord";
const GENESIS_HASH = "sha-256:genesis";
const DIGEST = /^sha-256:[a-f0-9]{64}$/;

/** Durable records allow larger audit objects than wire messages. Depth matches readValue. */
export const STORE_LIMITS = resolveLimits({
  maxJsonDepth: 32,
  maxJsonNodes: 50_000,
  maxStringLength: 1_048_576,
  maxArrayLength: 8192,
});

const field = (kind: Field["kind"], property: string, optional = false): Field => ({
  kind,
  term: property.includes(":") ? property : AWP + property,
  optional,
});
const enumeration = (
  property: string,
  prefix: string,
  values: readonly string[],
  optional = false,
): Field => ({ ...field("enum", property, optional), prefix: AWP + prefix + "/", values });
const text = (property: string, optional = false) => field("text", property, optional);
const iri = (property: string, optional = false) => field("iri", property, optional);
const open = (property: string, optional = false) => field("open", property, optional);
const list = (property: string, optional = false) => field("strings", property, optional);
const at = field("time", "at");
// Successful checks also carry runtime explanations. The wire reason set is unchanged.
const gateReasons = [
  ...REASON_CODES,
  "approval-given",
  "authority-valid",
  "established-earlier",
  "evidence-complete",
  "fit-for-use",
  "intact",
  "minimal-disclosure",
  "no-action",
  "no-claims",
  "no-data",
  "no-personal-data",
  "no-principal",
  "recipient-established",
  "source-accepted",
  "terms-acceptable",
  "terms-allow",
  "within-limits",
  "within-mandate",
];
const reason = enumeration("reason", "reason", gateReasons, true);
const representationStatuses = new Map<string, readonly [string, string]>([
  ["actor", ["anonymous", AWP + "representation-status/anonymous"]],
  ["party", ["unknown", AWP + "representation-status/unknown"]],
]);
const standIn = text("recordStandIn", true);

interface PayloadSpec {
  readonly className: string;
  readonly fields: Readonly<Record<string, Field>>;
}

const message: PayloadSpec = {
  className: "MessageRecord",
  fields: {
    id: iri("recordIdentifier"),
    kind: text("messageKind"),
    conversation: iri("conversation"),
    digest: text("digest"),
    from: iri(PROV + "wasAttributedTo", true),
    onBehalfOfClaim: iri(PROV + "actedOnBehalfOf", true),
    binding: text("recordBinding", true),
    approvalBinding: open("recordApprovalBinding", true),
    conditions: field("value", "recordConditions", true),
    at,
  },
};
const transfer: PayloadSpec = {
  className: "ItemTransferRecord",
  fields: {
    item: iri("transferItem"),
    digest: text("digest"),
    subject: iri("subject", true),
    to: open("transferRecipient", true),
    agreement: iri("transferAgreement", true),
    duties: field("value", "transferDuties", true),
    message: iri("transferMessage", true),
    at,
  },
};
const approval: PayloadSpec = {
  className: "ApprovalRecord",
  fields: {
    id: iri("recordIdentifier", true),
    actionDigest: text("actionDigest", true),
    conversation: iri("conversation", true),
    decision: enumeration(
      "approvalDecision",
      "approval-decision",
      ["approve", "deny", "decline"],
      true,
    ),
    issuer: iri(VC + "issuer", true),
    proofDigest: text("approvalProofDigest", true),
    jws: text(APPROVAL_JWS, true),
    at: field("time", "at", true),
  },
};

const payloads: Readonly<Record<string, PayloadSpec>> = {
  "gate-check": {
    className: "GateCheckRecord",
    fields: {
      agent: iri("recordAgent"),
      gate: text("recordGate"),
      check: enumeration("check", "check", [...INBOUND_CHECKS, ...OUTBOUND_CHECKS]),
      verdict: enumeration("verdict", "verdict", [
        "pass",
        "fail",
        "ask-more",
        "ask-principal",
        "not-applicable",
        "indeterminate",
      ]),
      reason,
      at,
      standIn,
    },
  },
  "gate-decision": {
    className: "GateDecisionRecord",
    fields: {
      agent: iri("recordAgent"),
      gate: text("recordGate"),
      outcome: enumeration("outcome", "gate-outcome", [
        "admit",
        "ask-more",
        "refuse",
        "go",
        "ask-principal",
        "stop",
      ]),
      reason,
      checks: list("recordChecks"),
      at,
    },
  },
  verification: {
    className: "VerificationResult",
    fields: {
      protectedObject: text("protectedObject"),
      property: text("property"),
      mechanism: text("mechanism"),
      verificationMaterial: text("verificationMaterial", true),
      attributedTo: iri(PROV + "wasAttributedTo", true),
      verifier: iri("verifier"),
      outcome: enumeration("outcome", "verification-outcome", [
        "valid",
        "invalid",
        "unsupported",
        "unknown-key",
        "not-applicable",
      ]),
      limitations: list("recordLimitations"),
      at,
    },
  },
  "representation-assessment": {
    className: "RepresentationAssessment",
    fields: {
      deciderRole: text("deciderRole", true),
      evaluator: iri("evaluator"),
      actor: iri("actor"),
      party: iri("party"),
      operation: iri("operation", true),
      statement: iri("statement", true),
      outcome: enumeration("outcome", "assessment-outcome", [
        "accepted",
        "not-accepted",
        "unresolved",
      ]),
      reason,
      at,
      standIn,
    },
  },
  "authorisation-decision": {
    className: "AuthorisationDecision",
    fields: {
      decider: iri("decider"),
      actionDigest: text("actionDigest"),
      action: open(ODRL + "action"),
      policy: open("policy"),
      outcome: enumeration("outcome", "authorisation-outcome", [
        "permit",
        "deny",
        "approval-required",
        "indeterminate",
        "ask-more",
      ]),
      basis: text("basis", true),
      approval: iri("approval", true),
      matchedRule: text("matchedRule", true),
      reason: text(EXPLANATION),
      at,
      standIn,
      originalDigests: list(ORIGINAL_DIGESTS, true),
    },
  },
  grant: {
    className: "GrantRecord",
    fields: {
      id: iri("recordIdentifier"),
      kind: enumeration("kind", "grant-kind", [
        "owner-mandate",
        "data-use",
        "access",
        "onward-use",
        "delegation",
      ]),
      grantor: iri("grantor"),
      grantee: iri("grantee"),
      digest: text("digest"),
      validUntil: field("time", VC + "validUntil", true),
      derivedFrom: iri(PROV + "wasDerivedFrom", true),
      at,
    },
  },
  "message-in": message,
  "message-out": message,
  "item-received": transfer,
  "item-released": transfer,
  "approval-requested": approval,
  approval,
  "ledger-checkpoint": {
    className: "RecordCheckpoint",
    fields: {
      prunedSegments: list("prunedSegments"),
      lastPrunedSeq: field("integer", "lastPrunedSeq"),
      lastPrunedHash: text("lastPrunedHash"),
      note: text("checkpointNote"),
    },
  },
};

export const REQUIRED_TYPED_RECORDS: ReadonlyMap<string, string> = new Map(
  Object.entries(payloads).map(([type, spec]) => [type, AWP + spec.className]),
);

function setTerm(node: RdfNode, predicate: string, value: Term): void {
  RequiredAs.object(node, predicate, value, TermFrom.itself);
}

class RecordPayloadNode extends CoreNode<LedgerEntry["record"]> {
  readonly modelName: string;

  constructor(term: string | Term, dataset: Store, modelName: string) {
    super(term, dataset);
    this.modelName = modelName;
  }

  override getField(name: string): unknown {
    if (this.spec.fields[name]?.term === EXPLANATION && this.one(REASON)) {
      const iri = this.iri(REASON);
      const code = iri?.slice(reason.prefix!.length);
      if (!code || !iri?.startsWith(reason.prefix!) || !gateReasons.includes(code))
        throw new TypeError("Unknown authorisation reason");
      return code;
    }
    if (this.spec.fields[name]?.term === SUBJECT && this.one(TRANSFER_SUBJECT_TEXT))
      return this.text(TRANSFER_SUBJECT_TEXT);
    const value = super.getField(name);
    const status =
      this.modelName === "store/representation-assessment" && representationStatuses.get(name);
    return status && value === status[1] ? status[0] : value;
  }

  override setField(name: string, value: unknown): void {
    const descriptor = this.spec.fields[name];
    const status =
      this.modelName === "store/representation-assessment" && representationStatuses.get(name);
    if (status && value === status[0]) {
      super.setField(name, status[1]);
    } else if (
      descriptor?.term === EXPLANATION &&
      typeof value === "string" &&
      gateReasons.includes(value)
    ) {
      this.setIri(REASON, reason.prefix! + value);
    } else if (
      descriptor?.term === SUBJECT &&
      typeof value === "string" &&
      !isSafeAbsoluteIri(value)
    ) {
      this.setText(TRANSFER_SUBJECT_TEXT, value);
    } else if (descriptor?.term === APPROVAL_JWS && typeof value === "string") {
      super.setField(name, value);
      this.setText(APPROVAL_JWS_DIGEST, digestBytes(value));
    } else if (value !== undefined && descriptor?.kind === "open") {
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new TypeError("Expected a named object");
      this.setValues(descriptor.term, value as JsonObject);
    } else if (value !== undefined && descriptor?.kind === "strings") {
      if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
        throw new TypeError("Expected an ordered list of strings");
      if (
        (descriptor.term === CHECKS || descriptor.term === ORIGINAL_DIGESTS) &&
        value.some((item) => !DIGEST.test(item))
      )
        throw new TypeError("Expected gate check digests");
      this.setStrings(descriptor.term, value);
    } else if (value !== undefined && descriptor?.kind === "value") {
      this.setValue(descriptor.term, value as Json);
    } else {
      super.setField(name, value);
    }
  }

  private setStrings(predicate: string, values: string[]): void {
    const node = NamedValuesNode.from(
      values,
      scopedId(this.id, predicate),
      this.dataset,
      STORE_LIMITS,
    );
    for (const entry of node.entries) entry.domainValue = literal(entry.domainValue.value);
    this.setNode(predicate, node);
  }

  private setValue(predicate: string, value: Json): void {
    setTerm(
      this,
      predicate,
      writeValue(value, scopedId(this.id, predicate), this.dataset, STORE_LIMITS),
    );
  }

  setValues(predicate: string, value: JsonObject): void {
    this.setNode(
      predicate,
      NamedValuesNode.from(value, scopedId(this.id, predicate), this.dataset, STORE_LIMITS),
    );
  }

  values(predicate: string): JsonObject {
    const term = this.one(predicate);
    if (!term) throw new TypeError("Missing record values");
    const value = readValue(term, this.dataset);
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new TypeError("Expected a named object");
    return value;
  }

  writeOrder(source: LedgerEntry["record"], nativeOrder: LedgerEntry["record"]): void {
    const expected = Object.keys(nativeOrder);
    const actual = Object.keys(source);
    if (actual.some((key, position) => key !== expected[position]))
      this.setStrings(FIELD_ORDER, actual);
  }

  readOrdered(): LedgerEntry["record"] {
    const result = this.toObject();
    const order = this.one(FIELD_ORDER);
    if (!order) return result;
    const keys = Object.keys(result);
    const ordered = readValue(order, this.dataset);
    if (
      !Array.isArray(ordered) ||
      new Set(ordered).size !== keys.length ||
      ordered.length !== keys.length ||
      ordered.some((key) => typeof key !== "string" || !Object.hasOwn(result, key))
    )
      throw new TypeError("Invalid record field order");
    return Object.fromEntries(
      ordered.map((key) => [key, result[key as string]]),
    ) as LedgerEntry["record"];
  }
}

registerModel(
  "store/untyped",
  {
    type: UNTYPED,
    fields: { values: open("recordValues") },
  },
  class extends RecordPayloadNode {
    constructor(term: string | Term, dataset: Store) {
      super(term, dataset, "store/untyped");
    }
  },
);

for (const [type, spec] of Object.entries(payloads)) {
  const model = "store/" + type;
  registerModel(
    model,
    {
      type: AWP + spec.className,
      fields: { type: { kind: "constant", term: RECORD_TYPE, constant: type }, ...spec.fields },
    },
    class extends RecordPayloadNode {
      constructor(term: string | Term, dataset: Store) {
        super(term, dataset, model);
      }
    },
  );
}

class RecordHeaderNode extends RdfNode {
  get at(): string {
    const time = this.one(ENTRY_TIME);
    if (!time || time.termType !== "Literal" || time.datatype.value !== XSD + "dateTime")
      throw new TypeError("Expected the entry timestamp");
    readLiteral(time);
    return time.value;
  }
  set at(value: string) {
    setTerm(this, ENTRY_TIME, literal(value, namedNode(XSD + "dateTime")));
    // Validate without canonicalizing the timestamp spelling committed by the seal.
    void this.at;
  }
  get payload(): string | undefined {
    return this.iri(RECORD);
  }
}

export function recordGraphIri(hash: string): string {
  if (!DIGEST.test(hash)) throw new TypeError("Invalid entry hash");
  return "urn:awp:record:" + hash.slice("sha-256:".length);
}

function header(entry: LedgerRangeEntry, dataset: Store): RecordHeaderNode {
  const node = new RecordHeaderNode(recordGraphIri(entry.hash), dataset);
  const entity = entry.record === null ? entities.WithheldRecordEntry : entities.RecordEntry;
  const wrapper = new entity.Wrapper(node.id, dataset, DataFactory);
  wrapper.types.add(entity.typeIri);
  if (!Number.isSafeInteger(entry.seq) || entry.seq < 1)
    throw new TypeError("Invalid entry sequence");
  wrapper.sequence = entry.seq;
  wrapper.previousEntryHash = entry.prev;
  if (entry.prev !== GENESIS_HASH) wrapper.previousEntry = recordGraphIri(entry.prev);
  wrapper.entryHash = entry.hash;
  if (entry.recordDigest !== undefined) {
    if (!DIGEST.test(entry.recordDigest)) throw new TypeError("Invalid record digest");
    wrapper.recordDigest = entry.recordDigest;
  }
  node.at = entry.at;
  return node;
}

function recordPayload(record: LedgerEntry["record"], id: string): RecordPayloadNode {
  assertJsonBounds(record, STORE_LIMITS);
  if (typeof record.type !== "string") throw new TypeError("Expected a record type");
  if (REQUIRED_TYPED_RECORDS.has(record.type)) {
    const node = new RecordPayloadNode(id, new IndexedStore(), "store/" + record.type);
    try {
      node.types.add(REQUIRED_TYPED_RECORDS.get(record.type)!);
      node.writeObject(record);
      const decoded = node.toObject();
      if (digestOf(decoded) === digestOf(record)) {
        node.writeOrder(record, decoded);
        return node;
      }
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
    }
  }
  const node = new RecordPayloadNode(id, new IndexedStore(), "store/untyped");
  node.types.add(UNTYPED);
  node.setField("values", record);
  return node;
}

function namedEntry(dataset: Store, name: string): IndexedStore {
  const graph = namedNode(name);
  return new IndexedStore(
    [...dataset].map(({ subject, predicate, object }) =>
      DataFactory.quad(subject, predicate, object, graph),
    ),
  );
}

export function recordEntryDataset(entry: LedgerEntry): IndexedStore {
  const dataset = new IndexedStore();
  const root = header(entry, dataset);
  const wrapper = new entities.RecordEntry.Wrapper(root.id, dataset, DataFactory);
  wrapper.recordType = entry.record.type;
  const payload = recordPayload(entry.record, scopedId(root.id, "record"));
  for (const quad of payload.dataset) dataset.addQuad(quad);
  wrapper.record = payload.id;
  return namedEntry(dataset, root.id);
}

export function rangeEntryDataset(entry: LedgerRangeEntry): IndexedStore {
  if (entry.record !== null) return recordEntryDataset(entry);
  const dataset = new IndexedStore();
  const root = header(entry, dataset);
  return namedEntry(dataset, root.id);
}

/** Decode one complete named graph. Compare against the encoder to reject ignored facts,
 * wrong datatypes, unexpected nodes, and noncanonical list or link structure.
 * Seal verification remains the caller's responsibility.
 */
export function recordEntryFrom(dataset: Store, graph: string): LedgerRangeEntry {
  const selected = new IndexedStore(dataset.getQuads(null, null, null, graph));
  // Wrapper type sets operate in the default graph. Read only the selected entry.
  const local = new IndexedStore(
    [...selected].map(({ subject, predicate, object }) =>
      DataFactory.quad(subject, predicate, object),
    ),
  );
  const root = new RecordHeaderNode(graph, local);
  const withheld = root.types.has(entities.WithheldRecordEntry.typeIri);
  const entity = withheld ? entities.WithheldRecordEntry : entities.RecordEntry;
  const wrapper = new entity.Wrapper(graph, local, DataFactory);
  const { sequence, previousEntryHash, entryHash, recordDigest } = wrapper;
  if (
    sequence === undefined ||
    previousEntryHash === undefined ||
    entryHash === undefined ||
    recordGraphIri(entryHash) !== graph
  )
    throw new TypeError("Malformed record entry header");
  let record: LedgerRangeEntry["record"] = null;
  if (!withheld) {
    const { recordType } = new entities.RecordEntry.Wrapper(graph, local, DataFactory);
    const id = root.payload;
    if (recordType === undefined || id !== scopedId(graph, "record"))
      throw new TypeError("Missing record payload");
    const type = new RdfNode(id, local).types.has(UNTYPED) ? "untyped" : recordType;
    const payload = new RecordPayloadNode(id, local, "store/" + type);
    record =
      type === "untyped"
        ? (payload.values(VALUES) as LedgerEntry["record"])
        : payload.readOrdered();
    if (record.type !== recordType) throw new TypeError("Record type mismatch");
  }
  const entry = {
    seq: sequence,
    at: root.at,
    prev: previousEntryHash,
    hash: entryHash,
    record,
    ...(recordDigest === undefined ? {} : { recordDigest }),
  } as LedgerRangeEntry;
  const canonical = rangeEntryDataset(entry);
  if (selected.size !== canonical.size || [...canonical].some((quad) => !selected.has(quad)))
    throw new TypeError("Malformed record entry graph");
  return entry;
}
