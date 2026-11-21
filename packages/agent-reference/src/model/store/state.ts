// AUTHORED-BY Codex GPT-6.2 Sol
import type { Term } from "@jeswr/fetch-rdf";
import { DataFactory, type Store } from "n3";
import { assertJsonBounds } from "../../core/limits.js";
import type { Agreement, Json } from "../../core/types.js";
import { entities } from "../../generated/model.js";
import { AWP } from "../../profile/vocabulary.js";
import type { RuntimeState } from "../../store/state.js";
import { decodeSnapshotEntry, readNQuads, writeNQuads } from "../../wire/store-quads.js";
import { makeNode } from "../core-node.js";
import { IndexedStore } from "../indexed-store.js";
import { AgreementNode } from "../message-nodes.js";
import { SCHEMA, scopedId, XSD } from "../named-values.js";
import {
  assertSameGraph,
  exact,
  field,
  graphContents,
  inGraph,
  link,
  StoreNode,
  storeModel,
} from "./common.js";
import { readMemoryFact, readPolicy, writeMemoryFact, writePolicy } from "./memory.js";
import { STORE_LIMITS } from "./record.js";

const ROOT = "urn:awp:state";
const SECTION = AWP + "section";
const ENTRY = AWP + "stateEntry";
const ENTRY_KEY = AWP + "entryKey";
const ENTRY_VALUE = AWP + "entryValue";
const POSITION = SCHEMA + "position";
const VERSION = AWP + "stateVersion";
const PRESENT = AWP + "sectionPresent";
const ITEM = AWP + "memoryItem";
const { literal, namedNode } = DataFactory;

export const GENERIC_SECTIONS = [
  "conversations",
  "seen",
  "outbox",
  "effects",
  "pending",
  "domain",
  "tasks",
  "transmissions",
  "generatedConversations",
  "notificationDuties",
  "duties",
  "pendingPodGrants",
  "emailChallenges",
  "paymentOrders",
  "paymentOrderKeys",
  "paymentReceipts",
  "paymentTotals",
  "paymentReleases",
] as const satisfies readonly (keyof RuntimeState)[];

const typedSections = {
  contextItems: "MemoryScope",
  knownIdentifiers: "KnownIdentifiers",
  statementRefusals: "StatementRefusal",
  relianceHolds: "RelianceHold",
  relianceBindings: "RelianceBinding",
  precedenceHolds: "PrecedenceHold",
  descriptionAddresses: "DescriptionAddress",
  trustPins: "TrustPin",
  trustHolds: "TrustHold",
  trustRefusals: "TrustRefusal",
  agreements: "Agreement",
  revokedMandates: "MandateRevocation",
  approvals: "ApprovalGrant",
  usedApprovals: "UsedApproval",
  organisationApprovals: "OrganisationApprovals",
  ledgerAuditHead: "RecordHead",
  authoredProofs: "AuthoredProof",
  auditApprovalProofs: "AuditApprovalProof",
  recordMessages: "RecordedMessage",
  paymentReservations: "PaymentReservation",
} as const satisfies Partial<Record<keyof RuntimeState, string>>;

type Section = Exclude<keyof RuntimeState, "version">;
const sections = [...Object.keys(typedSections), ...GENERIC_SECTIONS].sort() as Section[];
const arraySections: ReadonlySet<Section> = new Set([
  "descriptionAddresses",
  "trustPins",
  "revokedMandates",
]);
const singleSections: ReadonlySet<Section> = new Set(["ledgerAuditHead"]);
const optionalSections: ReadonlySet<Section> = new Set(["descriptionAddresses", "ledgerAuditHead"]);
const typed = (section: Section): string | undefined =>
  typedSections[section as keyof typeof typedSections];
const sectionIri = (section: Section) => ROOT + ":" + section;
const text = (term: string, optional = false) => field("text", term, optional);
const iri = (term: string, optional = false) => field("iri", term, optional);
const time = (term: string) => field("time", term);
const value = (term: string, optional = false) => field("value", term, optional);

storeModel("TrustHold", {
  digest: text("digest"),
  message: field("open", "trustMessage"),
  wire: field("open", "trustWire"),
  binding: text("recordBinding"),
  kid: text("kid"),
  party: iri("party"),
  purpose: iri("admittedPurpose"),
  expiresAt: time("effectiveUntil"),
});
storeModel("TrustRefusal", { value: field("boolean", "trustRefused") });
storeModel("ApprovalGrant", {
  id: iri("recordIdentifier"),
  decision: text("approvalDecisionName"),
  validUntil: time("effectiveUntil"),
  jws: exact("approvalJws", "approvalJwsDigest"),
  payment: field("open", "approvalPayment", true),
  releaseBinding: field("open", "recordApprovalBinding", true),
});
storeModel("UsedApproval", { value: field("boolean", "approvalUsed") }, "ApprovalGrant");
storeModel(
  "OrganisationApproval",
  {
    type: { kind: "constant", term: AWP + "recordType", constant: "OrganisationApproval" },
    id: iri("recordIdentifier"),
    signer: iri("approvalSigner"),
    actor: iri("actor"),
    actionDigest: text("actionDigest"),
    conversation: iri("conversation"),
    issuedAt: time("issuedAt"),
    validUntil: time("effectiveUntil"),
    kid: text("kid"),
    jws: exact("approvalJws", "approvalJwsDigest", true),
    releaseBinding: field("open", "recordApprovalBinding", true),
  },
  "ApprovalGrant",
);
storeModel("OrganisationApprovals", {
  items: link("nodes", "approvalItems", "OrganisationApproval"),
});
const head = {
  seq: field("integer", "sequence"),
  hash: text("entryHash"),
};
storeModel("RecordHead", head);
storeModel("AuthoredProof", {
  ...head,
  task: iri("memoryTask"),
  requestDigest: text("requestDigest"),
});
storeModel("RecordedMessage", {
  direction: text("recordDirection"),
  conversation: iri("conversation"),
  digest: text("digest"),
  jws: exact("recordJws", "recordJwsDigest"),
  credentialsAdmitted: field("boolean", "credentialsAdmitted", true),
});
storeModel(
  "AuditApprovalProof",
  {
    value: exact("approvalJws", "approvalJwsDigest"),
  },
  "AuthoredProof",
);

const wrappedScalars = new Set([
  "KnownIdentifiers",
  "StatementRefusal",
  "RelianceBinding",
  "TrustRefusal",
  "UsedApproval",
  "AuditApprovalProof",
  "DescriptionAddress",
]);

const generated = {
  TrustPin: ["kid", "party", "purpose", "expiresAt"],
  MandateRevocation: ["id", "version", "digest", "at"],
  PaymentReservation: ["digest", "period", "amountMinor"],
} as const;
type GeneratedName = keyof typeof generated;

function writeGenerated(name: GeneratedName, raw: Json, id: string, local: Store) {
  const entity = entities[name];
  const node = new StoreNode(id, local, name);
  const wrap = new entity.Wrapper(id, local, DataFactory) as unknown as Record<string, unknown> & {
    types: Set<string>;
  };
  wrap.types.add(entity.typeIri);
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new TypeError("Expected a flat store entry");
  for (const key of generated[name]) {
    const val = raw[key];
    const accessor = key === "id" ? "mandateId" : key;
    if (key === "expiresAt" || key === "at") {
      if (typeof val !== "string" || !Number.isFinite(Date.parse(val)))
        throw new TypeError("Invalid store timestamp");
      wrap[key] = new Date(val);
      node.put(
        key === "at" ? AWP + "at" : AWP + "effectiveUntil",
        literal(val, namedNode(XSD + "dateTime")),
      );
    } else {
      if (val === undefined) throw new TypeError("Missing generated store field");
      wrap[accessor] = val;
    }
  }
  if (Object.keys(raw).length !== generated[name].length)
    throw new TypeError("Unexpected generated field");
}

function readGenerated(name: GeneratedName, id: string, local: Store): Json {
  const entity = entities[name];
  const node = new StoreNode(id, local, name);
  if (!node.types.has(entity.typeIri)) throw new TypeError("Missing generated store class");
  const wrap = new entity.Wrapper(id, local, DataFactory) as unknown as Record<string, unknown>;
  return Object.fromEntries(
    generated[name].map((key) => [
      key,
      key === "expiresAt" || key === "at"
        ? wrap[key] instanceof Date
          ? node.term(key === "at" ? AWP + "at" : AWP + "effectiveUntil")?.value
          : undefined
        : wrap[key === "id" ? "mandateId" : key],
    ]),
  ) as Json;
}

function writePayload(section: Section, raw: Json, id: string, local: Store, policies: Store) {
  const name = typed(section);
  const envelope = new StoreNode(id, local, "StateEntry");
  if (!name) {
    envelope.putValue(ENTRY_VALUE, raw);
    return;
  }
  if ((name === "UsedApproval" || name === "TrustRefusal") && raw !== true)
    throw new TypeError("Expected a true state marker");
  const body = name === "Agreement" ? (raw as unknown as Agreement).id : scopedId(id, "payload");
  envelope.put(ENTRY_VALUE, namedNode(body));
  if (name === "Agreement") {
    AgreementNode.toNode(raw as unknown as Agreement, body, local);
  } else if (name === "MemoryScope") {
    if (!Array.isArray(raw)) throw new TypeError("Expected a context list");
    makeNode(name, {}, body, local);
    const scope = new StoreNode(body, local, name);
    for (const [position, item] of raw.entries()) {
      const child = scopedId(body, "item:" + position);
      writeMemoryFact(item as never, "MemoryItem", child, local, writePolicy(policies));
      new StoreNode(child, local, "MemoryItem").position = position;
      scope.add(ITEM, child);
    }
  } else if (name === "PrecedenceHold") {
    writeMemoryFact(raw as never, name, body, local, writePolicy(policies));
  } else if (Object.hasOwn(generated, name)) {
    writeGenerated(name as GeneratedName, raw, body, local);
  } else {
    const data = wrappedScalars.has(name)
      ? { value: raw }
      : name === "OrganisationApprovals"
        ? { items: raw }
        : raw;
    makeNode(name, data, body, local);
  }
}

function readPayload(
  section: Section,
  envelope: StoreNode,
  policy: ReturnType<typeof readPolicy>,
): Json {
  const name = typed(section);
  if (!name) {
    const raw = envelope.valueAt(ENTRY_VALUE);
    if (raw === undefined) throw new TypeError("Missing generic store entry");
    return raw;
  }
  const term = envelope.term(ENTRY_VALUE);
  if (term?.termType !== "NamedNode") throw new TypeError("Missing typed store entry");
  const local = envelope.dataset;
  const node = new StoreNode(term, local, name);
  if (name === "Agreement")
    return AgreementNode.fromNode(new AgreementNode(term, local)) as unknown as Json;
  if (name === "MemoryScope") {
    node.read();
    return ordered(node, ITEM).map(({ node }) => readMemoryFact(node, policy)) as unknown as Json;
  }
  if (name === "PrecedenceHold")
    return readMemoryFact(
      new StoreNode<import("../../gates/common.js").AdmittedFact>(term, local, name),
      policy,
    ) as unknown as Json;
  if (Object.hasOwn(generated, name)) return readGenerated(name as GeneratedName, node.id, local);
  const data = node.read() as { value: Json; items: Json };
  return wrappedScalars.has(name)
    ? data.value
    : name === "OrganisationApprovals"
      ? data.items
      : (data as Json);
}

function named(term: Term): string {
  if (term.termType !== "NamedNode") throw new TypeError("Expected a named snapshot node");
  return term.value;
}

function ordered(parent: StoreNode, predicate: string) {
  const children = parent
    .terms(predicate)
    .map((term) => {
      const node = new StoreNode<import("../../gates/common.js").ContextItem>(
        named(term),
        parent.dataset,
        "MemoryItem",
      );
      const value = node.term(POSITION);
      if (
        value?.termType !== "Literal" ||
        value.datatype.value !== XSD + "integer" ||
        !/^\d+$/.test(value.value)
      )
        throw new TypeError("Missing snapshot position");
      return { node, position: Number(value.value) };
    })
    .sort((a, b) => a.position - b.position);
  if (children.some(({ position }, index) => position !== index))
    throw new TypeError("Invalid snapshot order");
  return children;
}

function header(): IndexedStore {
  const local = new IndexedStore();
  const root = new StoreNode(ROOT, local, "RuntimeSnapshot");
  root.types.add(AWP + "RuntimeSnapshot");
  root.put(VERSION, literal("2", namedNode(XSD + "integer")));
  for (const section of sections) root.add(SECTION, sectionIri(section));
  return local;
}
function sectionHeader(section: Section, present: boolean): string {
  const local = new IndexedStore();
  const root = new StoreNode(sectionIri(section), local, "StateSection");
  root.types.add(AWP + (typed(section) ? "TypedStateSection" : "StateSection"));
  root.put(PRESENT, literal(String(present), namedNode(XSD + "boolean")));
  return writeNQuads(inGraph(local, root.id));
}
function positionBlock(section: Section, id: string, position: number) {
  const local = new IndexedStore();
  const root = new StoreNode(sectionIri(section), local, "StateSection");
  root.add(ENTRY, id);
  new StoreNode(id, local, "StateEntry").position = position;
  return writeNQuads(inGraph(local, root.id));
}

type EntryMemo = {
  readonly native: string;
  readonly id: string;
  readonly bytes: string;
  readonly position: number;
  readonly location: string;
  readonly policies: ReadonlyMap<string, string>;
};

const SNAPSHOT_MAX_BYTES = 96 * 1024 * 1024;

/** Cache per entry, with positions separate from the payload. Cache only the most recent save. */
export class SnapshotMemo {
  private entries = new Map<Section, Map<string, EntryMemo>>();
  private readonly root = writeNQuads(header());
  private readonly present = new Map(
    sections.map((section) => [section, sectionHeader(section, true)]),
  );
  private readonly absent = new Map(
    [...optionalSections].map((section) => [section, sectionHeader(section, false)]),
  );
  encodedEntries = 0;

  write(state: RuntimeState): string {
    if (
      state.version !== 1 ||
      Object.keys(state).some((key) => key !== "version" && !sections.includes(key as Section))
    )
      throw new TypeError("Unsupported native snapshot section or version");
    const next = new Map<Section, Map<string, EntryMemo>>();
    const chunks = [this.root];
    const policies = new Map<string, string>();
    let encoded = 0;
    for (const section of sections) {
      const value = state[section];
      if (value === undefined) {
        const absent = this.absent.get(section);
        if (!absent) throw new TypeError(`Missing snapshot section ${section}`);
        chunks.push(absent);
        continue;
      }
      if (
        value === null ||
        typeof value !== "object" ||
        Array.isArray(value) !== arraySections.has(section)
      )
        throw new TypeError(`Invalid snapshot section ${section}`);
      chunks.push(this.present.get(section)!);
      const current = new Map<string, EntryMemo>();
      const prior = this.entries.get(section);
      next.set(section, current);
      const input = singleSections.has(section) ? [["", value] as const] : Object.entries(value);
      let position = 0;
      for (const [key, value] of input) {
        const native = JSON.stringify(value);
        if (native === undefined) {
          if (arraySections.has(section)) throw new TypeError("Undefined snapshot array member");
          continue;
        }
        const cached = prior?.get(key);
        const id = cached?.id ?? scopedId(sectionIri(section), key);
        const location =
          cached?.position === position ? cached.location : positionBlock(section, id, position);
        let row: EntryMemo;
        if (cached?.native === native) {
          row = cached.location === location ? cached : { ...cached, position, location };
        } else {
          const raw = decodeSnapshotEntry(native) as Json;
          assertJsonBounds(raw, STORE_LIMITS);
          const local = new IndexedStore();
          const policyDataset = new IndexedStore();
          const entry = new StoreNode(id, local, "StateEntry");
          entry.types.add(AWP + (typed(section) ? "TypedStateEntry" : "StateEntry"));
          entry.put(ENTRY_KEY, literal(key));
          writePayload(section, raw, id, local, policyDataset);
          row = {
            native,
            id,
            position,
            location,
            bytes: writeNQuads(inGraph(local, sectionIri(section))),
            policies: new Map(
              policyDataset
                .getGraphs(null, null, null)
                .map((graph) => [
                  graph.value,
                  writeNQuads(new IndexedStore(policyDataset.getQuads(null, null, null, graph))),
                ]),
            ),
          };
          encoded++;
        }
        for (const [id, bytes] of row.policies) {
          const previous = policies.get(id);
          if (previous !== undefined && previous !== bytes)
            throw new TypeError("Conflicting snapshot ODRL policy identity");
          policies.set(id, bytes);
        }
        current.set(key, row);
        chunks.push(row.location, row.bytes);
        position++;
      }
    }
    for (const id of [...policies.keys()].sort()) chunks.push(policies.get(id)!);
    const bytes = chunks.join("");
    if (Buffer.byteLength(bytes) > SNAPSHOT_MAX_BYTES)
      throw new RangeError("State snapshot exceeds its byte limit");
    this.entries = next;
    this.encodedEntries = encoded;
    return bytes;
  }
}

export function stateDataset(state: RuntimeState): IndexedStore {
  return readNQuads(new SnapshotMemo().write(state), SNAPSHOT_MAX_BYTES);
}

export class UnsupportedSnapshotVersion extends Error {}
export function stateFromRdf(dataset: Store): RuntimeState {
  const decoded = decodeState(dataset);
  assertSameGraph(dataset, stateDataset(decoded));
  return decoded;
}

function decodeState(dataset: Store): RuntimeState {
  const root = new StoreNode(
    ROOT,
    new IndexedStore(dataset.getQuads(null, null, null, DataFactory.defaultGraph())),
    "RuntimeSnapshot",
  );
  const version = root.term(VERSION);
  if (
    !root.types.has(AWP + "RuntimeSnapshot") ||
    version?.termType !== "Literal" ||
    version.datatype.value !== XSD + "integer"
  )
    throw new TypeError("Missing snapshot header");
  if (version.value !== "2")
    throw new UnsupportedSnapshotVersion(`unsupported state version ${version.value}`);
  const declared = new Set(root.terms(SECTION).map(named));
  if (
    declared.size !== sections.length ||
    sections.some((section) => !declared.has(sectionIri(section)))
  )
    throw new TypeError("Missing or unknown snapshot section header");

  const policy = readPolicy(dataset);
  const result: Partial<Record<keyof RuntimeState, unknown>> = { version: 1 };
  for (const section of sections) {
    const id = sectionIri(section);
    const node = new StoreNode(id, graphContents(dataset, id), "StateSection");
    const present = node.term(PRESENT);
    if (
      present?.termType !== "Literal" ||
      present.datatype.value !== XSD + "boolean" ||
      !node.types.has(AWP + (typed(section) ? "TypedStateSection" : "StateSection"))
    )
      throw new TypeError("Invalid snapshot section header");
    const entries = ordered(node, ENTRY);
    if (present.value === "false" && optionalSections.has(section) && entries.length === 0)
      continue;
    if (present.value !== "true") throw new TypeError("Invalid snapshot section presence");
    const pairs = entries.map(({ node, position }) => {
      const key = node.term(ENTRY_KEY);
      if (
        key?.termType !== "Literal" ||
        key.datatype.value !== XSD + "string" ||
        scopedId(id, key.value) !== node.id ||
        (arraySections.has(section) && key.value !== String(position))
      )
        throw new TypeError("Invalid snapshot entry key");
      return [key.value, readPayload(section, node, policy)] as const;
    });
    if (new Set(pairs.map(([key]) => key)).size !== pairs.length)
      throw new TypeError("Duplicate snapshot key");
    if (singleSections.has(section)) {
      if (pairs.length !== 1 || pairs[0]?.[0] !== "")
        throw new TypeError("Invalid singleton section");
      result[section] = pairs[0][1];
    } else if (arraySections.has(section)) {
      result[section] = pairs.map(([, value]) => value);
    } else {
      result[section] = Object.fromEntries(pairs);
    }
  }
  return result as unknown as RuntimeState;
}

export function readStateSnapshot(text: string): RuntimeState {
  try {
    return stateFromRdf(readNQuads(text, SNAPSHOT_MAX_BYTES));
  } catch (cause) {
    if (cause instanceof UnsupportedSnapshotVersion) throw cause;
    throw new Error("state snapshot is malformed", { cause });
  }
}

/** The memory check decodes its own encoder output; the file reader also verifies the full graph. */
export function decodeSnapshotForRoundTrip(text: string): RuntimeState {
  return decodeState(readNQuads(text, SNAPSHOT_MAX_BYTES));
}
