// AUTHORED-BY Codex GPT-6.2 Sol
// AUTHORED-BY Codex GPT-6
import type { Quad, Term } from "@jeswr/fetch-rdf";
import { DataFactory, type Store } from "n3";
import { digestBytes } from "../../core/canonical.js";
import { isIsoInstant } from "../../core/schema.js";
import type { Agreement, Json } from "../../core/types.js";
import { entities } from "../../generated/model.js";
import { AWP } from "../../profile/vocabulary.js";
import type { RuntimeState } from "../../store/state.js";
import {
  assertCanonicalSnapshotBlock,
  assertLocalSnapshotSize,
  decodeSnapshotEntry,
  readLocalStoreRdf,
  writeNQuads,
} from "../../wire/store-quads.js";
import { makeNode } from "../core-node.js";
import { IndexedStore } from "../indexed-store.js";
import { agreementSpec, operationRefSpec, participantRefSpec } from "../message-nodes.js";
import { SCHEMA, scopedId, XSD } from "../named-values.js";
import {
  assertSameGraph,
  exact,
  field,
  graphContents,
  hasUnpairedSurrogate,
  inGraph,
  instant,
  link,
  readStoreText,
  StoreNode,
  storeInstant,
  storeModel,
  storeText,
} from "./common.js";
import {
  InheritedTermsBudget,
  readMemoryFact,
  readPolicy,
  writeMemoryFact,
  writePolicy,
} from "./memory.js";

const ROOT = "urn:awp:state";
const SECTION = AWP + "section";
const ENTRY = AWP + "stateEntry";
const ENTRY_KEY = AWP + "entryKey";
const ENTRY_VALUE = AWP + "entryValue";
const POSITION = SCHEMA + "position";
const VERSION = AWP + "stateVersion";
const CONTENTS_DIGEST = `${AWP}snapshotContentsDigest`;
const PRESENT = AWP + "sectionPresent";
const ITEM = AWP + "memoryItem";
const INSTANT_LEXICAL = AWP + "instantLexical";
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
const entryId = (section: string, key: string) =>
  hasUnpairedSurrogate(key)
    ? scopedId(scopedId(section, "escaped-entry-key"), JSON.stringify(key))
    : scopedId(section, key);
const text = (term: string, optional = false) => field("text", term, optional);
const iri = (term: string, optional = false) => field("iri", term, optional);
const value = (term: string, optional = false) => field("value", term, optional);

storeModel("TrustHold", {
  digest: text("digest"),
  message: field("open", "trustMessage"),
  wire: field("open", "trustWire"),
  binding: text("recordBinding"),
  kid: text("kid"),
  party: iri("party"),
  purpose: iri("admittedPurpose"),
  expiresAt: instant("effectiveUntil"),
});
storeModel("TrustRefusal", { value: field("boolean", "trustRefused") });
storeModel("ApprovalGrant", {
  id: iri("recordIdentifier"),
  decision: text("approvalDecisionName"),
  validUntil: instant("effectiveUntil"),
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
    issuedAt: instant("issuedAt"),
    validUntil: instant("effectiveUntil"),
    kid: text("kid"),
    jws: exact("approvalJws", "approvalJwsDigest", true),
    releaseBinding: field("open", "recordApprovalBinding", true),
  },
  "ApprovalGrant",
);
storeModel("OrganisationApprovals", {
  items: link("nodes", "approvalItems", "OrganisationApproval"),
});
// Keep the Agreement protocol graph for normal data and use local literal escapes
// for native values that RDF cannot represent directly.
storeModel("StoreOperationRef", operationRefSpec.fields, operationRefSpec.type);
storeModel(
  "StoreParticipantRef",
  Object.fromEntries(
    Object.entries(participantRefSpec.fields).map(([key, field]) => [
      key,
      { ...field, lexical: true },
    ]),
  ),
  participantRefSpec.type,
);
storeModel(
  "StoreAgreement",
  {
    ...agreementSpec.fields,
    conversation: { ...agreementSpec.fields.conversation!, lexical: true },
    offer: { ...agreementSpec.fields.offer!, lexical: true },
    acceptance: { ...agreementSpec.fields.acceptance!, lexical: true },
    operation: { ...agreementSpec.fields.operation!, model: "StoreOperationRef" },
    offeror: { ...agreementSpec.fields.offeror!, model: "StoreParticipantRef" },
    acceptor: { ...agreementSpec.fields.acceptor!, model: "StoreParticipantRef" },
    terms: { ...agreementSpec.fields.terms!, protocolOpen: true },
    selection: { ...agreementSpec.fields.selection!, protocolOpen: true },
    formedAt: instant("formedAt"),
  },
  agreementSpec.type,
);
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
      const term = storeInstant(val, true);
      if (term.datatype.value === XSD + "dateTime") {
        node.put(key === "at" ? AWP + "at" : AWP + "effectiveUntil", term);
      } else {
        // Keep the generated date-time property queryable and retain the source lexeme.
        wrap[key] = new Date(val);
        node.put(INSTANT_LEXICAL, term);
      }
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
    generated[name].map((key) => {
      if (key !== "expiresAt" && key !== "at") return [key, wrap[key === "id" ? "mandateId" : key]];
      if (!(wrap[key] instanceof Date)) throw new TypeError("Missing generated store timestamp");
      const lexical = node.term(INSTANT_LEXICAL);
      return [
        key,
        lexical
          ? readStoreText(lexical)
          : node.term(key === "at" ? AWP + "at" : AWP + "effectiveUntil")?.value,
      ];
    }),
  ) as Json;
}

function writePayload(
  section: Section,
  raw: Json,
  id: string,
  local: Store,
  policies: Store,
  budget: InheritedTermsBudget,
) {
  const name = typed(section);
  const envelope = new StoreNode(id, local, "StateEntry");
  if (!name) {
    envelope.putValue(ENTRY_VALUE, raw);
    return;
  }
  if ((name === "UsedApproval" || name === "TrustRefusal") && raw !== true)
    throw new TypeError("Expected a true state marker");
  if (name === "Agreement") {
    const agreement = raw as unknown as Agreement;
    if (hasUnpairedSurrogate(agreement.id) || hasUnpairedSurrogate(agreement.operation.id)) {
      envelope.putValue(ENTRY_VALUE, raw);
    } else {
      envelope.put(ENTRY_VALUE, namedNode(agreement.id));
      makeNode("StoreAgreement", agreement, agreement.id, local);
    }
    return;
  }
  const body = scopedId(id, "payload");
  envelope.put(ENTRY_VALUE, namedNode(body));
  if (name === "MemoryScope") {
    if (!Array.isArray(raw)) throw new TypeError("Expected a context list");
    makeNode(name, {}, body, local);
    const scope = new StoreNode(body, local, name);
    const policy = writePolicy(policies);
    for (const [position, item] of raw.entries()) {
      const child = scopedId(body, "item:" + position);
      writeMemoryFact(item as never, "MemoryItem", child, local, policy, budget);
      new StoreNode(child, local, "MemoryItem").position = position;
      scope.add(ITEM, child);
    }
  } else if (name === "PrecedenceHold") {
    writeMemoryFact(raw as never, name, body, local, writePolicy(policies), budget);
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
  budget: InheritedTermsBudget,
): Json {
  const name = typed(section);
  if (!name) {
    const raw = envelope.valueAt(ENTRY_VALUE);
    if (raw === undefined) throw new TypeError("Missing generic store entry");
    return raw;
  }
  const term = envelope.term(ENTRY_VALUE);
  if (name === "Agreement" && term?.termType === "Literal") return envelope.valueAt(ENTRY_VALUE)!;
  if (term?.termType !== "NamedNode") throw new TypeError("Missing typed store entry");
  const local = envelope.dataset;
  const node = new StoreNode(term, local, name);
  if (name === "Agreement") return new StoreNode<Json>(term, local, "StoreAgreement").read();
  if (
    (name === "MemoryScope" || name === "PrecedenceHold") &&
    node.id !== scopedId(envelope.id, "payload")
  )
    throw new TypeError("Invalid scoped memory payload");
  if (name === "MemoryScope") {
    node.read();
    return ordered(node, ITEM).map(({ node: item, position }) => {
      if (item.id !== scopedId(node.id, "item:" + position))
        throw new TypeError("Invalid scoped memory item");
      return readMemoryFact(item, policy, budget);
    }) as unknown as Json;
  }
  if (name === "PrecedenceHold")
    return readMemoryFact(
      new StoreNode<import("../../gates/common.js").AdmittedFact>(term, local, name),
      policy,
      budget,
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
type LayoutBlock = { readonly bytes: string; verify(): void };

function assertBlockBoundary(bytes: string): void {
  if (!bytes.startsWith("<") || !bytes.endsWith(" .\n"))
    throw new TypeError("Unterminated or invalid snapshot block");
}

function layoutBlock(dataset: Store): LayoutBlock {
  let pending = [...dataset];
  const bytes = writeNQuads(dataset);
  return {
    bytes,
    verify() {
      if (!pending.length) return;
      assertBlockBoundary(bytes);
      const actual = readLocalStoreRdf(bytes, "application/n-quads");
      if (actual.size !== pending.length || pending.some((quad) => !actual.has(quad)))
        throw new TypeError("Invalid snapshot layout block");
      assertCanonicalSnapshotBlock(bytes, actual);
      pending = [];
    },
  };
}

function contentsHeader(body: string): LayoutBlock {
  const local = new IndexedStore();
  const root = new StoreNode(ROOT, local, "RuntimeSnapshot");
  root.put(CONTENTS_DIGEST, literal(digestBytes(body)));
  return layoutBlock(local);
}

function sectionHeader(section: Section, present: boolean): LayoutBlock {
  const local = new IndexedStore();
  const root = new StoreNode(sectionIri(section), local, "StateSection");
  root.types.add(AWP + (typed(section) ? "TypedStateSection" : "StateSection"));
  root.put(PRESENT, literal(String(present), namedNode(XSD + "boolean")));
  return layoutBlock(inGraph(local, root.id));
}
function positionBlock(section: Section, id: string, position: number) {
  const local = new IndexedStore();
  const root = new StoreNode(sectionIri(section), local, "StateSection");
  root.add(ENTRY, id);
  new StoreNode(id, local, "StateEntry").position = position;
  return layoutBlock(inGraph(local, root.id));
}

type EntryPayload = {
  readonly native: string;
  readonly id: string;
  readonly bytes: string;
  readonly policies: ReadonlyMap<string, string>;
  readonly inheritedReferences: number;
  authored?: readonly Quad[];
};

type EntryMemo = {
  readonly payload: EntryPayload;
  readonly position: number;
  readonly location: LayoutBlock;
};

function encodeEntry(
  section: Section,
  key: string,
  id: string,
  raw: Json,
  budget: InheritedTermsBudget,
  retainQuads = false,
) {
  const local = new IndexedStore();
  const policies = new IndexedStore();
  const entry = new StoreNode(id, local, "StateEntry");
  entry.types.add(AWP + (typed(section) ? "TypedStateEntry" : "StateEntry"));
  entry.put(ENTRY_KEY, storeText(key));
  const usedBefore = budget.used;
  writePayload(section, raw, id, local, policies, budget);
  const graph = inGraph(local, sectionIri(section));
  const authored = retainQuads ? [...graph, ...policies] : undefined;
  return {
    bytes: writeNQuads(graph, Infinity),
    authored,
    inheritedReferences: budget.used - usedBefore,
    policies: new Map(
      policies
        .getGraphs(null, null, null)
        .map((graph) => [
          graph.value,
          writeNQuads(new IndexedStore(policies.getQuads(null, null, null, graph)), Infinity),
        ]),
    ),
  };
}

type VerifiedEntry = {
  readonly value: Json;
  readonly subjects: ReadonlySet<string>;
  readonly links: ReadonlySet<string>;
};

function verifyEntry(section: Section, key: string, row: EntryPayload): VerifiedEntry {
  assertBlockBoundary(row.bytes);
  for (const bytes of row.policies.values()) assertBlockBoundary(bytes);
  const dataset = readLocalStoreRdf(
    row.bytes + [...row.policies.values()].join(""),
    "application/n-quads",
  );
  const local = graphContents(dataset, sectionIri(section));
  const budget = new InheritedTermsBudget();
  const value = readPayload(
    section,
    new StoreNode(row.id, local, "StateEntry"),
    readPolicy(dataset),
    budget,
  );
  if (budget.used !== row.inheritedReferences)
    throw new TypeError(`Inconsistent inherited item reference count in ${section}`);
  if (row.authored && JSON.stringify(value) === row.native) {
    // Exact JSON includes nested field order. The same input would produce the
    // same canonical graph, so verify the RDF bytes against the original quads.
    if (dataset.size !== row.authored.length || row.authored.some((quad) => !dataset.has(quad)))
      throw new TypeError(`Inconsistent snapshot entry in ${section}`);
  } else {
    // Typed wrappers can change property order. Recheck their canonical form.
    const canonical = encodeEntry(section, key, row.id, value, new InheritedTermsBudget());
    if (
      canonical.bytes !== row.bytes ||
      canonical.policies.size !== row.policies.size ||
      [...canonical.policies].some(([id, bytes]) => row.policies.get(id) !== bytes)
    )
      throw new TypeError(`Noncanonical snapshot entry in ${section}`);
  }
  // Canonical blocks contain one complete statement per line and no comments.
  // Their exact bytes are also the input to the snapshot contents digest.
  for (const [graph, bytes] of [[sectionIri(section), row.bytes] as const, ...row.policies]) {
    assertCanonicalSnapshotBlock(
      bytes,
      new IndexedStore(dataset.getQuads(null, null, null, namedNode(graph))),
    );
  }
  row.authored = undefined;
  const subjects = new Set<string>();
  const links = new Set<string>();
  for (const { subject, object } of local) {
    subjects.add(subject.value);
    if (object.termType === "NamedNode") links.add(object.value);
  }
  return { value, subjects, links };
}

function sectionValue(section: Section, pairs: ReadonlyArray<readonly [string, Json]>): unknown {
  if (singleSections.has(section)) {
    if (pairs.length !== 1 || pairs[0]?.[0] !== "")
      throw new TypeError("Invalid singleton section");
    return pairs[0][1];
  }
  if (arraySections.has(section)) return pairs.map(([, value]) => value);
  return Object.fromEntries(pairs);
}

/** Cache per entry, with positions separate from the payload. Cache only the most recent save. */
export class SnapshotMemo {
  private entries = new Map<Section, Map<string, EntryMemo>>();
  private output?: { readonly bytes: string; readonly contents: LayoutBlock };
  private readonly verified = new WeakMap<EntryPayload, VerifiedEntry>();
  private readonly root = layoutBlock(header());
  private readonly present = new Map(
    sections.map((section) => [section, sectionHeader(section, true)]),
  );
  private readonly absent = new Map(
    [...optionalSections].map((section) => [section, sectionHeader(section, false)]),
  );
  encodedEntries = 0;

  constructor(private readonly retainQuads = true) {}

  write(state: RuntimeState): string {
    if (
      state.version !== 1 ||
      Object.keys(state).some((key) => key !== "version" && !sections.includes(key as Section))
    )
      throw new TypeError("Unsupported native snapshot section or version");
    const next = new Map<Section, Map<string, EntryMemo>>();
    const chunks: string[] = [];
    const policies = new Map<string, string>();
    const budget = new InheritedTermsBudget();
    let encoded = 0;
    for (const section of sections) {
      const value = state[section];
      if (value === undefined) {
        const absent = this.absent.get(section);
        if (!absent) throw new TypeError(`Missing snapshot section ${section}`);
        chunks.push(absent.bytes);
        continue;
      }
      if (
        value === null ||
        typeof value !== "object" ||
        Array.isArray(value) !== arraySections.has(section)
      )
        throw new TypeError(`Invalid snapshot section ${section}`);
      const heading = this.present.get(section)!;
      chunks.push(heading.bytes);
      const current = new Map<string, EntryMemo>();
      const prior = this.entries.get(section);
      next.set(section, current);
      const input = singleSections.has(section) ? [["", value] as const] : Object.entries(value);
      if (
        Array.isArray(value) &&
        (input.length !== value.length || input.some(([key], index) => key !== String(index)))
      )
        throw new TypeError(`Sparse snapshot array in ${section}`);
      let position = 0;
      for (const [key, value] of input) {
        const native = JSON.stringify(value);
        if (native === undefined) {
          if (arraySections.has(section)) throw new TypeError("Undefined snapshot array member");
          continue;
        }
        const cached = prior?.get(key);
        const id = cached?.payload.id ?? entryId(sectionIri(section), key);
        const location =
          cached?.position === position ? cached.location : positionBlock(section, id, position);
        let payload = cached?.payload;
        if (payload?.native !== native) {
          const raw = decodeSnapshotEntry(native) as Json;
          payload = {
            native,
            id,
            ...encodeEntry(section, key, id, raw, budget, this.retainQuads),
          };
          encoded++;
        } else {
          budget.consume(payload.inheritedReferences);
        }
        for (const [id, bytes] of payload.policies) {
          const previous = policies.get(id);
          if (previous !== undefined && previous !== bytes)
            throw new TypeError("Conflicting snapshot ODRL policy identity");
          policies.set(id, bytes);
        }
        current.set(key, { payload, position, location });
        chunks.push(location.bytes, payload.bytes);
        position++;
      }
    }
    for (const id of [...policies.keys()].sort()) chunks.push(policies.get(id)!);
    const body = chunks.join("");
    const contents = contentsHeader(body);
    const bytes = this.root.bytes + contents.bytes + body;
    assertLocalSnapshotSize(bytes);
    this.entries = next;
    this.output = { bytes, contents };
    this.encodedEntries = encoded;
    return bytes;
  }

  /** Decode the assembled output, reusing validation only for identical entry bytes. */
  decode(bytes: string): RuntimeState {
    if (bytes !== this.output?.bytes) return readStateSnapshot(bytes);
    this.root.verify();
    this.output.contents.verify();
    const result: Partial<Record<keyof RuntimeState, unknown>> = { version: 1 };
    for (const section of sections) {
      const entries = this.entries.get(section);
      (entries ? this.present.get(section)! : this.absent.get(section)!).verify();
      if (!entries) continue;

      const id = sectionIri(section);
      const subjects = new Map<string, VerifiedEntry>();
      const pairs: Array<readonly [string, Json]> = [];
      const checked: VerifiedEntry[] = [];
      for (const [key, row] of entries) {
        row.location.verify();
        let entry = this.verified.get(row.payload);
        if (!entry) {
          entry = verifyEntry(section, key, row.payload);
          this.verified.set(row.payload, entry);
        }
        checked.push(entry);
        pairs.push([key, entry.value]);
        for (const subject of entry.subjects) {
          if (subjects.has(subject) || subject === id) return readStateSnapshot(bytes);
          subjects.set(subject, entry);
        }
      }
      // A named link can acquire a meaning from another entry in the same
      // section graph. Resolve such links against the complete snapshot.
      for (const entry of checked) {
        for (const link of entry.links) {
          const owner = subjects.get(link);
          if (link === id || (owner && owner !== entry)) return readStateSnapshot(bytes);
        }
      }
      result[section] = sectionValue(section, pairs);
    }
    return result as unknown as RuntimeState;
  }
}

export function stateDataset(state: RuntimeState): Store {
  return readLocalStoreRdf(new SnapshotMemo(false).write(state), "application/n-quads");
}

export class UnsupportedSnapshotVersion extends Error {}
export function stateFromRdf(dataset: Store): RuntimeState {
  const digest = readSnapshotHeader(dataset);
  const decoded = decodeState(dataset);
  const canonical = stateDataset(decoded);
  if (!canonical.has(DataFactory.quad(namedNode(ROOT), namedNode(CONTENTS_DIGEST), digest)))
    throw new TypeError("Snapshot contents digest mismatch");
  // Earlier v2 writers tagged Agreement timestamps with xsd:dateTime even when
  // the runtime admitted a shorter lexical form. Compare those using today's term.
  const formedAt = namedNode(AWP + "formedAt");
  const agreementGraph = namedNode(sectionIri("agreements"));
  let normalized: Store | undefined;
  for (const quad of dataset.getQuads(null, formedAt, null, agreementGraph)) {
    const term = quad.object;
    if (
      term.termType !== "Literal" ||
      term.datatype.value !== XSD + "dateTime" ||
      !isIsoInstant(term.value)
    )
      continue;
    const expected = storeInstant(term.value, true);
    if (term.equals(expected)) continue;
    // A competing literal is rejected by the singleton field reader above.
    normalized ??= new IndexedStore([...dataset]);
    normalized.removeQuad(quad);
    normalized.addQuad(quad.subject, formedAt, expected, agreementGraph);
  }
  assertSameGraph(normalized ?? dataset, canonical);
  return decoded;
}

function readSnapshotHeader(dataset: Store): ReturnType<typeof literal> {
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
  const digest = root.term(CONTENTS_DIGEST);
  if (digest === undefined) throw new TypeError("Missing snapshot contents digest");
  if (
    digest.termType !== "Literal" ||
    digest.datatype.value !== XSD + "string" ||
    !/^sha-256:[0-9a-f]{64}$/.test(digest.value)
  )
    throw new TypeError("Invalid snapshot contents digest");
  return literal(digest.value);
}

function sectionPresent(node: StoreNode, section: Section): boolean {
  const present = node.term(PRESENT);
  if (
    present?.termType !== "Literal" ||
    present.datatype.value !== XSD + "boolean" ||
    !node.types.has(AWP + (typed(section) ? "TypedStateSection" : "StateSection"))
  )
    throw new TypeError("Invalid snapshot section header");
  if (present.value === "true") return true;
  if (present.value === "false" && optionalSections.has(section)) return false;
  throw new TypeError("Invalid snapshot section presence");
}

function decodeState(dataset: Store): RuntimeState {
  const policy = readPolicy(dataset);
  const budget = new InheritedTermsBudget();
  const result: Partial<Record<keyof RuntimeState, unknown>> = { version: 1 };
  for (const section of sections) {
    const id = sectionIri(section);
    const node = new StoreNode(id, graphContents(dataset, id), "StateSection");
    const present = sectionPresent(node, section);
    const entries = ordered(node, ENTRY);
    if (!present) {
      if (entries.length !== 0)
        throw new TypeError("Unexpected entries in absent snapshot section");
      continue;
    }
    const pairs = entries.map(({ node, position }) => {
      const term = node.term(ENTRY_KEY);
      if (term === undefined) throw new TypeError("Missing snapshot entry key");
      const key = readStoreText(term);
      if (entryId(id, key) !== node.id || (arraySections.has(section) && key !== String(position)))
        throw new TypeError("Invalid snapshot entry key");
      return [key, readPayload(section, node, policy, budget)] as const;
    });
    if (new Set(pairs.map(([key]) => key)).size !== pairs.length)
      throw new TypeError("Duplicate snapshot key");
    result[section] = sectionValue(section, pairs);
  }
  return result as unknown as RuntimeState;
}

export function readStateSnapshot(text: string): RuntimeState {
  try {
    return stateFromRdf(readLocalStoreRdf(text, "application/n-quads"));
  } catch (cause) {
    if (cause instanceof UnsupportedSnapshotVersion) throw cause;
    const detail = cause instanceof Error ? `: ${cause.message}` : "";
    throw new Error(`state snapshot is malformed${detail}`, { cause });
  }
}
