// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { parseRdf } from "@jeswr/fetch-rdf";
import { serialize } from "@jeswr/rdf-serialize";
import type { DatasetCore } from "@rdfjs/types";
import { DataFactory, Store } from "n3";
import { canonicalJson, derivedUrn, isIri } from "../core/canonical.js";
import { assertJsonBounds, parseBoundedJson } from "../core/limits.js";
import { type PodRecord, podRecordSchema, type RecordType } from "../records.js";
import { AGENT, AS, agent, DCT, DPV, PROV, RDF, SCHEMA, SEC } from "../vocab.js";
import { RdfResource, type ScalarKind } from "./resource.js";

type Fields = Readonly<Record<string, Field>>;
interface Field {
  readonly predicate: string;
  readonly kind: ScalarKind | "object" | "sequence" | "concept";
  readonly fields?: Fields;
  readonly itemKind?: ScalarKind;
}
const f = (name: string, kind: Field["kind"] = "string", predicate = agent(name)): Field => ({
  predicate,
  kind,
});
const object = (name: string, fields: Fields): Field => ({
  predicate: agent(name),
  kind: "object",
  fields,
});
const sequence = (name: string, itemKind: ScalarKind): Field => ({
  predicate: agent(name),
  kind: "sequence",
  itemKind,
});
const time = (name: string, predicate = agent(name)) => f(name, "dateTime", predicate);
const ref = (name: string, predicate = agent(name)) => f(name, "iri", predicate);
const proof = f("proof", "json", `${SEC}proof`);

/** One mapping per graph family; names in this table are the public record fields. */
export const RECORD_MAPPINGS: Readonly<
  Record<RecordType, { readonly classIri: string; readonly fields: Fields }>
> = {
  account: {
    classIri: agent("Account"),
    fields: {
      channel: f("channel"),
      provider: f("provider"),
      organisation: f("organisation"),
      label: f("label", "string", `${SCHEMA}name`),
      channelHandleHash: f("channelHandle"),
      bindingState: f("bindingState"),
      credentialRef: f("credentialRef"),
      inventory: object("inventory", {
        channelHandles: sequence("channelHandles", "string"),
        credentialRefs: sequence("credentialRefs", "string"),
        setupStatus: f("setupStatus"),
        observedAt: f("observedAt"),
        lastTested: f("lastTested"),
        evidence: sequence("historicEvidence", "json"),
        identityConflicts: sequence("identityConflict", "json"),
      }),
      restrictions: object("restrictions", {
        read: f("read", "boolean"),
        triage: f("triage", "boolean"),
        draft: f("draft", "boolean"),
        send: f("send", "boolean"),
      }),
    },
  },
  "channel-capability": {
    classIri: agent("ChannelCapability"),
    fields: {
      channel: f("channel"),
      binding: f("binding"),
      carriage: f("carriage"),
      structuredPayload: f("structuredPayload", "boolean"),
      endToEndEncrypted: f("endToEndEncrypted", "boolean"),
      deliveryReceipts: f("deliveryReceipts", "boolean"),
      historyWindow: f("historyWindow", "duration"),
      maxMessageBytes: f("maxMessageBytes", "integer"),
      sendSupported: f("sendSupported", "boolean"),
      costPerMessage: f("costPerMessage", "decimal"),
      rateLimit: object("rateLimit", {
        perRecipient: f("perRecipient", "integer"),
        perDay: f("perDay", "integer"),
      }),
      credentialState: f("credentialState"),
      lastIngest: time("lastIngest"),
    },
  },
  "inbound-message": {
    classIri: agent("InboundMessage"),
    fields: {
      channel: f("channel"),
      binding: f("binding"),
      wasDerivedFrom: ref("wasDerivedFrom", `${PROV}wasDerivedFrom`),
      rawSha256: f("rawSha256"),
      rawByteLength: f("rawByteLength", "integer"),
      text: f("text", "string", `${SCHEMA}text`),
      subject: f("subject", "string", `${DCT}subject`),
      channelHandleHash: f("channelHandle"),
      identityStatus: f("identityStatus"),
      receivedAt: time("receivedAt", `${PROV}generatedAtTime`),
      structuredPart: sequence("structuredPart", "json"),
    },
  },
  "conversation-turn": {
    classIri: `${AS}Note`,
    fields: {
      conversation: ref("conversation", `${DCT}isPartOf`),
      attributedTo: ref("attributedTo", `${AS}attributedTo`),
      role: f("role"),
      text: f("text", "string", `${AS}content`),
      createdAt: time("createdAt", `${AS}published`),
      refersToProposal: sequence("refersToProposal", "iri"),
    },
  },
  "action-proposal": {
    classIri: agent("ActionProposal"),
    fields: {
      intent: object("intent", {
        operation: ref("operation"),
        operationVersion: f("operationVersion"),
        action: f("action"),
        target: ref("target"),
        binding: f("binding"),
        recipientHash: f("recipientHash"),
        termsDigest: f("termsDigest"),
        amount: object("amount", {
          value: f("value", "decimal", `${SCHEMA}value`),
          currency: f("currency", "string", `${SCHEMA}currency`),
        }),
        purpose: ref("purpose", `${DPV}hasPurpose`),
        parameters: f("parameters", "json"),
        conversation: ref("conversation"),
      }),
      renderedPreview: f("renderedPreview"),
      wasGeneratedBy: ref("wasGeneratedBy", `${PROV}wasGeneratedBy`),
      createdAt: time("createdAt", `${DCT}created`),
      validUntil: time("validUntil"),
      state: f("state"),
    },
  },
  approval: {
    classIri: agent("Approval"),
    fields: {
      approves: ref("approves"),
      termsDigest: f("termsDigest"),
      expires: time("expires"),
      decision: f("decision"),
      attributedTo: ref("attributedTo", `${PROV}wasAttributedTo`),
      createdAt: time("createdAt", `${DCT}created`),
      proof,
    },
  },
  "mandate-reference": {
    classIri: agent("MandateReference"),
    fields: {
      credential: ref("credential"),
      credentialStatus: ref(
        "credentialStatus",
        "https://www.w3.org/2018/credentials#credentialStatus",
      ),
      digest: f("digest"),
      validFrom: time("validFrom"),
      validUntil: time("validUntil"),
      proof,
    },
  },
  "control-statement": {
    classIri: agent("ControlStatement"),
    fields: {
      kind: f("controlKind", "concept"),
      attributedTo: ref("attributedTo", `${PROV}wasAttributedTo`),
      createdAt: time("createdAt", `${DCT}created`),
      expires: time("expires"),
      target: ref("target"),
      binding: f("binding"),
      bindingState: f("bindingState"),
      proof,
    },
  },
  transmission: {
    classIri: agent("Transmission"),
    fields: {
      proposal: ref("executedProposal"),
      status: f("status"),
      externalId: f("externalId"),
      wireDigest: f("wireDigest"),
      underMandate: ref("underMandate"),
      underApproval: ref("underApproval"),
      startedAt: time("startedAt", `${PROV}startedAtTime`),
      endedAt: time("endedAt", `${PROV}endedAtTime`),
    },
  },
  "audit-entry": {
    classIri: agent("LedgerEntry"),
    fields: {
      seq: f("sequence", "integer"),
      at: time("at", `${PROV}generatedAtTime`),
      prev: f("previousHash"),
      hash: f("entryHash"),
      record: f("recordsStatement", "json"),
    },
  },
};

function writeFields(node: RdfResource, data: Record<string, unknown>, fields: Fields): void {
  for (const [key, field] of Object.entries(fields)) {
    const value = data[key];
    if (value === undefined) continue;
    if (field.kind === "object" || field.kind === "sequence") {
      const child = new RdfResource(
        derivedUrn("node", { subject: node.id, predicate: field.predicate }),
        node.dataset,
        DataFactory,
      );
      node.write(field.predicate, "iri", child.id);
      if (field.kind === "object")
        writeFields(child, value as Record<string, unknown>, field.fields ?? {});
      else {
        const items = value as unknown[];
        child.type.add(`${RDF}Seq`);
        child.write(agent("length"), "integer", items.length);
        items.forEach((item, index) => {
          writeScalar(child, `${RDF}_${index + 1}`, field.itemKind ?? "string", item);
        });
      }
    } else if (field.kind === "concept") node.write(field.predicate, "iri", agent(String(value)));
    else writeScalar(node, field.predicate, field.kind, value);
  }
}
function writeScalar(node: RdfResource, predicate: string, kind: ScalarKind, value: unknown): void {
  if (kind === "json") {
    const text = canonicalJson(value);
    parseBoundedJson(text);
    node.write(predicate, kind, text);
  } else node.write(predicate, kind, value as string | number | boolean);
}
function readScalar(node: RdfResource, predicate: string, kind: ScalarKind): unknown {
  const value = node.read(predicate, kind);
  return kind === "json" && typeof value === "string" ? parseBoundedJson(value) : value;
}
function checkPredicates(node: RdfResource, predicates: string[]): void {
  const allowed = new Set([`${RDF}type`, ...predicates]);
  for (const quad of node.dataset.match(node.subjectTerm)) {
    if (!allowed.has(quad.predicate.value))
      throw new Error(`unsupported property ${quad.predicate.value}`);
  }
}
function readFields(node: RdfResource, fields: Fields): Record<string, unknown> {
  checkPredicates(
    node,
    Object.values(fields).map((field) => field.predicate),
  );
  const data: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(fields)) {
    let value: unknown;
    if (["object", "sequence", "concept"].includes(field.kind)) {
      if (field.kind === "concept") {
        const id = node.read(field.predicate, "iri");
        if (id === undefined) continue;
        if (typeof id !== "string" || !id.startsWith(AGENT))
          throw new Error("foreign control kind");
        value = id.slice(AGENT.length);
      } else {
        const term = node.readNode(field.predicate);
        if (term === undefined) continue;
        if (term.termType === "NamedNode" && !isIri(term.value))
          throw new Error("invalid node identifier");
        const child = new RdfResource(term, node.dataset, DataFactory);
        if (field.kind === "object") value = readFields(child, field.fields ?? {});
        else {
          const length = child.read(agent("length"), "integer");
          if (
            typeof length !== "number" ||
            !Number.isSafeInteger(length) ||
            length < 0 ||
            length > 512
          )
            throw new Error("invalid sequence length");
          if (child.type.size !== 1 || !child.type.has(`${RDF}Seq`))
            throw new Error("invalid sequence type");
          const predicates = Array.from({ length }, (_, i) => `${RDF}_${i + 1}`);
          checkPredicates(child, [agent("length"), ...predicates]);
          value = predicates.map((predicate) => {
            const item = readScalar(child, predicate, field.itemKind ?? "string");
            if (item === undefined) throw new Error("missing sequence item");
            return item;
          });
        }
      }
    } else value = readScalar(node, field.predicate, field.kind as ScalarKind);
    if (value !== undefined) data[key] = value;
  }
  return data;
}

/** Validate a pod record and write its graph through typed wrapper accessors. */
export function toRdf(record: PodRecord): DatasetCore {
  assertJsonBounds(record);
  const parsed = podRecordSchema.parse(record);
  const mapping = RECORD_MAPPINGS[parsed.type];
  const store = new Store();
  const node = new RdfResource(parsed.id, store, DataFactory);
  node.type.add(mapping.classIri);
  writeFields(node, parsed, mapping.fields);
  return store;
}
/** Parse exactly one known record at id. This performs no proof/authority verification. */
export function fromRdf(dataset: DatasetCore, id: string): PodRecord {
  if (!isIri(id)) throw new Error("invalid record id");
  if (dataset.size > 10000) throw new Error("RDF exceeds record bounds");
  for (const quad of dataset)
    if (quad.graph.termType !== "DefaultGraph") throw new Error("named graphs are not pod records");
  const node = new RdfResource(id, dataset, DataFactory);
  const entries = Object.entries(RECORD_MAPPINGS).filter(([, mapping]) =>
    node.type.has(mapping.classIri),
  );
  if (entries.length !== 1 || node.type.size !== 1)
    throw new Error("expected exactly one pod record type");
  const entry = entries[0];
  if (!entry) throw new Error("missing record type");
  const [type, mapping] = entry;
  const value = { type, id, ...readFields(node, mapping.fields) };
  assertJsonBounds(value);
  return podRecordSchema.parse(value);
}
const MAX_TURTLE_BYTES = 256 * 1024;
function assertTurtleBounds(text: string): void {
  if (Buffer.byteLength(text, "utf8") > MAX_TURTLE_BYTES)
    throw new Error("Turtle exceeds record bounds");
}

/** Serialize a validated pod record as Turtle using the suite serializer. */
export async function recordToTurtle(record: PodRecord): Promise<string> {
  const text = await serialize([...toRdf(record)], {
    prefixes: { agent: AGENT, as: AS, prov: PROV, schema: SCHEMA },
  });
  assertTurtleBounds(text);
  return text;
}
/** Parse Turtle locally using the suite parser, then validate the selected record. */
export async function recordFromTurtle(text: string, id: string): Promise<PodRecord> {
  assertTurtleBounds(text);
  return fromRdf(await parseRdf(text, "text/turtle", { baseIRI: id }), id);
}
