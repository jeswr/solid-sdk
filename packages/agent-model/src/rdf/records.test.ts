// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6

import { parseRdf } from "@jeswr/fetch-rdf";
import { serialize } from "@jeswr/rdf-serialize";
import fc from "fast-check";
// biome-ignore lint/style/useNodejsImportProtocol: agent imports allow only bare package names or relative paths
import { readFileSync } from "fs";
import { DataFactory, Store } from "n3";
import { describe, expect, it } from "vitest";
import { canonicalJson } from "../core/canonical.js";
import type { ActionIntent } from "../core/types.js";
import { type PodRecord, podRecordSchema, type RecordType } from "../records.js";
import { exampleRecords } from "../testing.js";
import { AGENT, agent, RDF, RDFS, SCHEMA, TERM_DEFINITIONS, VOCAB_MAPPING } from "../vocab.js";
import { fromRdf, RECORD_MAPPINGS, recordFromTurtle, recordToTurtle, toRdf } from "./records.js";
import { RdfResource } from "./resource.js";

const string = fc.string({ maxLength: 80 });
const nonempty = fc.string({ minLength: 1, maxLength: 60 });
const iri = fc.uuid().map((id) => `https://record.example/${id}#it`);
const timestamp = fc.constantFrom("2026-10-26T00:00:00Z", "2026-10-26T01:00:00.120+01:00");
const optional = <T>(arbitrary: fc.Arbitrary<T>) => fc.option(arbitrary, { nil: undefined });
const json = fc.jsonValue({ maxDepth: 3 });
const state = fc.constantFrom("none", "setup-required", "connected", "error", "disabled");
const amount = fc.record({
  value: fc.double({ min: 0, max: 1e12, noNaN: true }),
  currency: fc.constantFrom("GBP", "USD", "EUR"),
});
const restrictions = fc.record({
  read: fc.boolean(),
  triage: fc.boolean(),
  draft: fc.boolean(),
  send: fc.boolean(),
});
const intent = fc.record({
  operation: iri,
  operationVersion: nonempty,
  action: nonempty,
  target: iri,
  binding: nonempty,
  recipientHash: nonempty,
  amount,
  purpose: iri,
  termsDigest: nonempty,
  parameters: fc.dictionary(nonempty, json),
  conversation: iri,
});
const variations: Record<RecordType, fc.Arbitrary<unknown>> = {
  account: fc.record({
    channel: nonempty,
    provider: nonempty,
    organisation: optional(string),
    label: optional(string),
    channelHandleHash: nonempty,
    bindingState: state,
    credentialRef: optional(nonempty),
    restrictions,
  }),
  "channel-capability": fc.record({
    channel: nonempty,
    binding: nonempty,
    carriage: nonempty,
    structuredPayload: fc.boolean(),
    endToEndEncrypted: fc.boolean(),
    deliveryReceipts: fc.boolean(),
    maxMessageBytes: fc.nat(),
    sendSupported: fc.boolean(),
    costPerMessage: fc.double({ min: 0, max: 1e6, noNaN: true }),
    rateLimit: fc.record({ perRecipient: fc.nat(), perDay: fc.nat() }),
    credentialState: state,
    lastIngest: optional(timestamp),
  }),
  "inbound-message": fc.record({
    binding: nonempty,
    wasDerivedFrom: iri,
    rawSha256: nonempty,
    rawByteLength: fc.nat(),
    text: string,
    subject: optional(string),
    channelHandleHash: nonempty,
    receivedAt: timestamp,
    structuredPart: fc.array(json, { maxLength: 6 }),
  }),
  "conversation-turn": fc.record({
    conversation: iri,
    attributedTo: iri,
    role: fc.constantFrom("owner", "agent"),
    text: string,
    createdAt: timestamp,
    refersToProposal: fc.array(iri, { maxLength: 6 }),
  }),
  "action-proposal": fc.record({
    intent,
    renderedPreview: string,
    wasGeneratedBy: iri,
    createdAt: timestamp,
    validUntil: timestamp,
    state: fc.constantFrom("proposed", "approved", "denied", "expired", "sent", "failed"),
  }),
  approval: fc.record({
    approves: iri,
    termsDigest: nonempty,
    expires: timestamp,
    decision: fc.constantFrom("approve", "deny"),
    attributedTo: iri,
    createdAt: timestamp,
    proof: optional(json),
  }),
  "mandate-reference": fc.record({
    credential: iri,
    credentialStatus: optional(iri),
    digest: nonempty,
    validFrom: timestamp,
    validUntil: timestamp,
    proof: optional(json),
  }),
  "control-statement": fc.record({
    kind: fc.constantFrom(
      "Halt",
      "Resume",
      "SetBindingState",
      "DispatchNow",
      "RevokeMandate",
      "Forget",
    ),
    target: iri,
    binding: nonempty,
    bindingState: state,
    attributedTo: iri,
    createdAt: timestamp,
    expires: timestamp,
    proof: optional(json),
  }),
  transmission: fc.record({
    proposal: iri,
    status: fc.constantFrom("attempting", "sent", "not-sent", "uncertain", "refused"),
    externalId: optional(string),
    wireDigest: nonempty,
    underMandate: iri,
    underApproval: optional(iri),
    startedAt: timestamp,
    endedAt: optional(timestamp),
  }),
  "audit-entry": fc.record({
    seq: fc.nat(),
    at: timestamp,
    prev: nonempty,
    hash: nonempty,
    record: fc
      .dictionary(nonempty, json)
      .map((record) => ({ ...record, type: "test-system-event" })),
  }),
};
function recordArbitrary(type: RecordType): fc.Arbitrary<PodRecord> {
  return fc.tuple(iri, variations[type]).map(([id, changes]) => {
    // Fixtures are JSON values; explicit undefined optionals are omitted on the wire.
    return podRecordSchema.parse(
      JSON.parse(JSON.stringify({ ...exampleRecords[type], ...(changes as object), id })),
    );
  });
}

describe("DESIGN §2.4 pod record round trips", () => {
  for (const type of Object.keys(RECORD_MAPPINGS) as RecordType[]) {
    it(`${type}: typed graph and Turtle preserve content`, async () => {
      await fc.assert(
        fc.asyncProperty(recordArbitrary(type), async (record) => {
          expect(fromRdf(toRdf(record), record.id)).toEqual(record);
          expect(await recordFromTurtle(await recordToTurtle(record), record.id)).toEqual(record);
        }),
        { numRuns: 100, seed: 4004 },
      );
    });
  }
  it("reads nested blank nodes as in the DESIGN capability example", async () => {
    for (const record of [
      exampleRecords.account,
      exampleRecords["channel-capability"],
      exampleRecords["action-proposal"],
      exampleRecords["conversation-turn"],
    ]) {
      const text = await recordToTurtle(record);
      const graph = toRdf(record);
      const nodeIds = [
        ...new Set([...graph].map((quad) => quad.subject.value).filter((id) => id !== record.id)),
      ];
      const blankText = nodeIds.reduce(
        (text, id, index) => text.replaceAll(`<${id}>`, `_:structure${index}`),
        text,
      );
      const parsed = await parseRdf(blankText, "text/turtle");
      expect([...parsed].some((quad) => quad.subject.termType === "BlankNode")).toBe(true);
      expect(await recordFromTurtle(blankText, record.id)).toEqual(record);
    }
    const approval = exampleRecords.approval;
    const graph = new Store([...toRdf(approval)]);
    const node = new RdfResource(approval.id, graph, DataFactory);
    graph.deleteMatches(node.subjectTerm, DataFactory.namedNode(agent("approves")));
    node.addTerm(agent("approves"), DataFactory.blankNode("not-a-proposal-iri"));
    expect(() => fromRdf(graph, approval.id)).toThrow();
  });
  it("exposes queryable intent fields and opaque proofs", () => {
    const proposal = exampleRecords["action-proposal"];
    const action: ActionIntent = proposal.intent;
    expect(action.recipientHash).toBe(proposal.intent.recipientHash);
    const dataset = toRdf(proposal);
    const node = new RdfResource(proposal.id, dataset, DataFactory);
    const intentId = node.read(agent("intent"), "iri");
    expect(typeof intentId).toBe("string");
    const intentNode = new RdfResource(String(intentId), dataset, DataFactory);
    expect(intentNode.read(agent("recipientHash"), "string")).toBe(action.recipientHash);
    expect(intentNode.read(agent("binding"), "string")).toBe("direct");
    const amountId = intentNode.read(agent("amount"), "iri");
    expect(
      new RdfResource(String(amountId), dataset, DataFactory).read(`${SCHEMA}currency`, "string"),
    ).toBe("GBP");
    const approval = exampleRecords.approval;
    expect(fromRdf(toRdf(approval), approval.id)).toEqual(approval);
    const unsigned = { ...approval, proof: undefined };
    expect(fromRdf(toRdf(unsigned), unsigned.id)).not.toHaveProperty("proof");
  });
  it("preserves own __proto__ keys throughout opaque JSON validation and RDF conversion", async () => {
    const opaque = JSON.parse(
      '{"type":"OpaqueTestContent","__proto__":{"retained":true},"nested":{"__proto__":null},"items":[{"__proto__":"retained"}],"constructor":{"prototype":"opaque"}}',
    );
    const proposal = exampleRecords["action-proposal"];
    const cases: Array<{ record: PodRecord; content: (record: PodRecord) => unknown }> = [
      ...(["approval", "mandate-reference", "control-statement"] as const).map((type) => ({
        record: { ...exampleRecords[type], proof: opaque },
        content: (record: PodRecord) => ("proof" in record ? record.proof : undefined),
      })),
      {
        record: { ...proposal, intent: { ...proposal.intent, parameters: opaque } },
        content: (record) =>
          record.type === "action-proposal" ? record.intent.parameters : undefined,
      },
      {
        record: { ...exampleRecords["audit-entry"], record: opaque },
        content: (record) => (record.type === "audit-entry" ? record.record : undefined),
      },
      {
        record: { ...exampleRecords["inbound-message"], structuredPart: [opaque] },
        content: (record) =>
          record.type === "inbound-message" ? record.structuredPart[0] : undefined,
      },
    ];
    for (const { record, content } of cases) {
      expect(content(podRecordSchema.parse(record))).toBe(opaque);
      for (const converted of [
        fromRdf(toRdf(record), record.id),
        await recordFromTurtle(await recordToTurtle(record), record.id),
      ]) {
        // Compare JSON content directly: an opaque own constructor is ordinary data.
        expect(canonicalJson(converted)).toBe(canonicalJson(record));
        const result = content(converted);
        expect(Object.hasOwn(result as object, "__proto__")).toBe(true);
        expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
        expect(canonicalJson(result)).toBe(canonicalJson(opaque));
      }
    }
  });
});

function nodeFor(record: PodRecord) {
  const store = new Store([...toRdf(record)]);
  return { store, node: new RdfResource(record.id, store, DataFactory) };
}

describe("malformed and ambiguous records fail closed", () => {
  const account = exampleRecords.account;
  const approval = exampleRecords.approval;
  it("rejects invalid XSD timestamp lexical forms at every record timestamp field", async () => {
    const invalid = [
      "2026-10-26T10:30Z",
      "2026-10-26T10:30+01:00",
      "2026-10-26T10:30:00+14:01",
      "2026-10-26T10:30:00-14:01",
      "2026-10-26T10:30:00+15:00",
      "2026-10-26T10:30:00-23:59",
      "2026-10-26T10:30:00+00:60",
      "2026-10-26T10:60:00Z",
      "2026-10-26T10:30:60Z",
      "2026-10-26T24:00:01Z",
      "2026-10-26T24:00:00.001Z",
      "2026-10-26T10:30:00",
      "2026-02-29T10:30:00Z",
    ];
    const fields = {
      "channel-capability": ["lastIngest"],
      "inbound-message": ["receivedAt"],
      "conversation-turn": ["createdAt"],
      "action-proposal": ["createdAt", "validUntil"],
      approval: ["expires", "createdAt"],
      "mandate-reference": ["validFrom", "validUntil"],
      "control-statement": ["createdAt", "expires"],
      transmission: ["startedAt", "endedAt"],
      "audit-entry": ["at"],
    } as const;
    for (const type of Object.keys(fields) as (keyof typeof fields)[]) {
      for (const field of fields[type]) {
        for (const value of invalid) {
          const record = { ...exampleRecords[type], [field]: value };
          expect(podRecordSchema.safeParse(record).success).toBe(false);
          expect(() => toRdf(record)).toThrow(/xsd:dateTime/);
          await expect(recordToTurtle(record)).rejects.toThrow(/xsd:dateTime/);
        }
      }
    }
    for (const value of invalid) {
      const { node, store } = nodeFor(approval);
      node.write(agent("expires"), "dateTime", value);
      expect(() => fromRdf(store, approval.id)).toThrow(/xsd:dateTime|ISO-8601/);
      await expect(recordFromTurtle(await serialize([...store]), approval.id)).rejects.toThrow();
    }
  });
  it("preserves valid XSD timestamp lexical forms through graph and Turtle conversion", async () => {
    for (const expires of [
      "2026-10-26T10:30:00Z",
      "2026-10-26T10:30:00+14:00",
      "2026-10-26T10:30:00-14:00",
      "2026-10-26T10:30:00+13:59",
      "2026-10-26T10:30:00-00:00",
      "2026-10-26T10:30:00.123456789+00:00",
      "2028-02-29T23:59:59.120Z",
      "2026-10-26T24:00:00.000Z",
    ]) {
      const record = { ...approval, expires };
      expect(podRecordSchema.parse(record)).toEqual(record);
      const graph = toRdf(record);
      expect([...graph].find((q) => q.predicate.value === agent("expires"))?.object.value).toBe(
        expires,
      );
      expect(fromRdf(graph, record.id)).toEqual(record);
      expect(await recordFromTurtle(await recordToTurtle(record), record.id)).toEqual(record);
    }
  });
  it("rejects unknown fields, raw handles and missing intent fields", () => {
    for (const changes of [
      { channelHandle: "test@example.org" },
      { recipient: "test@example.org" },
      { restrictions: undefined },
      { bindingState: "unknown" },
    ]) {
      expect(() => toRdf({ ...account, ...changes } as PodRecord)).toThrow();
    }
    for (const field of ["binding", "recipientHash", "amount", "purpose", "termsDigest"]) {
      const proposal = structuredClone(exampleRecords["action-proposal"]);
      Reflect.deleteProperty(proposal.intent, field);
      expect(() => toRdf(proposal)).toThrow();
    }
    expect(() => toRdf({ ...approval, expires: "yesterday" })).toThrow();
    expect(() => fromRdf(new Store(), approval.id)).toThrow();
    expect(() => fromRdf(toRdf(approval), "relative")).toThrow();
  });
  it("rejects invalid opaque JSON instead of silently changing content", () => {
    const proposal = exampleRecords["action-proposal"];
    for (const value of [undefined, Number.NaN, Infinity, () => null, Symbol("invalid"), 1n]) {
      const opaque = { nested: { value } };
      for (const record of [
        { ...approval, proof: opaque },
        { ...exampleRecords["inbound-message"], structuredPart: [opaque] },
        { ...proposal, intent: { ...proposal.intent, parameters: opaque } },
        { ...exampleRecords["audit-entry"], record: { ...opaque, type: "test-event" } },
      ]) {
        expect(podRecordSchema.safeParse(record).success).toBe(false);
        expect(() => toRdf(record as PodRecord)).toThrow();
      }
    }
    for (const value of [null, [], "text", 1, true]) {
      expect(
        podRecordSchema.safeParse({
          ...proposal,
          intent: { ...proposal.intent, parameters: value },
        }).success,
      ).toBe(false);
    }
    for (const record of [{}, { type: "" }, { type: 1 }, { type: "x".repeat(16385) }, []]) {
      expect(podRecordSchema.safeParse({ ...exampleRecords["audit-entry"], record }).success).toBe(
        false,
      );
    }
  });
  it("refuses impossible dates, negative spend and malformed duration text", () => {
    for (const expires of [
      "2026-02-31T00:00:00Z",
      "2026-13-01T00:00:00Z",
      "2026-10-27T25:00:00Z",
    ]) {
      expect(() => toRdf({ ...approval, expires })).toThrow();
    }
    const capability = exampleRecords["channel-capability"];
    for (const historyWindow of ["P", "P30DT", "P-1D", "P1.2.3D"]) {
      expect(() => toRdf({ ...capability, historyWindow })).toThrow();
    }
    const proposal = exampleRecords["action-proposal"];
    for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        toRdf({ ...proposal, intent: { ...proposal.intent, amount: { value, currency: "GBP" } } }),
      ).toThrow();
    }
    expect(() =>
      toRdf({
        ...proposal,
        intent: { ...proposal.intent, amount: { value: 1, currency: "invalid" } },
      }),
    ).toThrow();
  });
  it("rejects C0 controls and DEL in record IDs and reference fields before serialization", async () => {
    const proposal = exampleRecords["action-proposal"];
    for (const code of [...Array.from({ length: 32 }, (_, code) => code), 0x7f]) {
      const iri = `https://record.example/before${String.fromCharCode(code)}after`;
      for (const record of [
        { ...approval, id: iri },
        { ...approval, approves: iri },
        { ...proposal, intent: { ...proposal.intent, target: iri } },
      ]) {
        expect(podRecordSchema.safeParse(record).success).toBe(false);
        expect(() => toRdf(record)).toThrow(/expected absolute IRI/);
        await expect(recordToTurtle(record)).rejects.toThrow(/expected absolute IRI/);
      }
      const { node, store } = nodeFor(approval);
      node.write(agent("approves"), "iri", iri);
      expect(() => fromRdf(store, approval.id)).toThrow(/expected absolute IRI/);
      expect(() => fromRdf(store, iri)).toThrow(/invalid record id/);
    }
    const unicode = { ...approval, id: "https://record.example/é/😀#it" };
    expect(await recordFromTurtle(await recordToTurtle(unicode), unicode.id)).toEqual(unicode);
  });
  it("rejects ambiguous scalar values and record classes", () => {
    const { node, store } = nodeFor(approval);
    node.addTerm(agent("decision"), DataFactory.literal("approve"));
    expect(() => fromRdf(store, approval.id)).toThrow(/ambiguous/);
    const other = nodeFor(approval);
    other.node.type.add(agent("Account"));
    expect(() => fromRdf(other.store, approval.id)).toThrow(/exactly one/);
  });
  it("rejects wrong term kinds, datatypes, malformed JSON and unknown predicates", () => {
    const mutations = [
      (node: RdfResource) => node.write(agent("decision"), "iri", "https://example.org/approve"),
      (node: RdfResource) => node.write(agent("decision"), "integer", 1),
      (node: RdfResource) => node.write(agent("expires"), "string", "2026-10-27T00:00:00Z"),
      (node: RdfResource) => node.write(agent("decision"), "string", "unexpected"),
      (node: RdfResource) => node.write(agent("binding"), "string", "unsupported"),
      (node: RdfResource) => node.write("https://w3id.org/security#proof", "json", "{bad"),
    ];
    for (const mutate of mutations) {
      const { node, store } = nodeFor(approval);
      mutate(node);
      expect(() => fromRdf(store, approval.id)).toThrow();
    }
  });
  it("refuses invalid lexical booleans and numbers", () => {
    const { node, store } = nodeFor(account);
    const restrictionsId = node.read(agent("restrictions"), "iri");
    const restrictionsNode = new RdfResource(String(restrictionsId), store, DataFactory);
    restrictionsNode.write(agent("read"), "string", "false");
    expect(() => fromRdf(store, account.id)).toThrow(/datatype/);
    store.deleteMatches(
      DataFactory.namedNode(String(restrictionsId)),
      DataFactory.namedNode(agent("read")),
    );
    restrictionsNode.addTerm(
      agent("read"),
      DataFactory.literal(
        "perhaps",
        DataFactory.namedNode("http://www.w3.org/2001/XMLSchema#boolean"),
      ),
    );
    expect(() => fromRdf(store, account.id)).toThrow(/boolean/);
    for (const value of ["NaN", "Infinity", "1e2", "", "0x10"]) {
      const entry = exampleRecords["audit-entry"];
      const audit = nodeFor(entry);
      audit.store.deleteMatches(
        DataFactory.namedNode(entry.id),
        DataFactory.namedNode(agent("sequence")),
      );
      audit.node.addTerm(
        agent("sequence"),
        DataFactory.literal(
          value,
          DataFactory.namedNode("http://www.w3.org/2001/XMLSchema#integer"),
        ),
      );
      expect(() => fromRdf(audit.store, entry.id)).toThrow();
    }
  });
  it("refuses incomplete controls and corrupt ordered collections", () => {
    const control = exampleRecords["control-statement"];
    expect(() => toRdf({ ...control, binding: undefined })).toThrow(/requires/);
    expect(() => toRdf({ ...control, kind: "DispatchNow", target: undefined })).toThrow(/target/);
    const turn = exampleRecords["conversation-turn"];
    const { node, store } = nodeFor(turn);
    const seqId = node.read(agent("refersToProposal"), "iri");
    store.deleteMatches(DataFactory.namedNode(String(seqId)), DataFactory.namedNode(`${RDF}_1`));
    expect(() => fromRdf(store, turn.id)).toThrow(/missing sequence/);
    const child = new RdfResource(String(seqId), store, DataFactory);
    child.write(agent("length"), "integer", 513);
    expect(() => fromRdf(store, turn.id)).toThrow(/length/);
  });
  it("enforces the reader's aggregate byte limit when serializing individually valid values", async () => {
    const turn = {
      ...exampleRecords["conversation-turn"],
      refersToProposal: Array.from(
        { length: 160 },
        (_, i) => `https://proposal.example/${i}/${"x".repeat(2000)}`,
      ),
    };
    const inbound = {
      ...exampleRecords["inbound-message"],
      structuredPart: Array.from({ length: 16 }, () => "😀".repeat(4096)),
    };
    for (const record of [turn, inbound]) {
      // All individual values and the graph are valid; Turtle must also fit as a whole.
      expect(fromRdf(toRdf(record), record.id)).toEqual(record);
      const oversized = await serialize([...toRdf(record)]);
      expect(Buffer.byteLength(oversized, "utf8")).toBeGreaterThan(256 * 1024);
      await expect(recordToTurtle(record)).rejects.toThrow("Turtle exceeds record bounds");
      await expect(recordFromTurtle(oversized, record.id)).rejects.toThrow(
        "Turtle exceeds record bounds",
      );
    }
    const readable = { ...turn, refersToProposal: turn.refersToProposal.slice(0, 100) };
    const text = await recordToTurtle(readable);
    expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(256 * 1024);
    expect(await recordFromTurtle(text, readable.id)).toEqual(readable);
  });
  it("rejects named graphs and oversized Turtle before parsing", async () => {
    const { store } = nodeFor(approval);
    const quad = [...store][0];
    if (!quad) throw new Error("fixture missing graph");
    // Parser creates the hostile graph fixture; production never hand-builds triples.
    const named = await parseRdf(
      `<${approval.id}> <${RDF}type> <${AGENT}Approval> <https://graph.example/> .`,
      "application/n-quads",
    );
    expect(() => fromRdf(named, approval.id)).toThrow(/named graphs/);
    await expect(recordFromTurtle(" ".repeat(256 * 1024 + 1), approval.id)).rejects.toThrow(
      /bounds/,
    );
    await expect(recordFromTurtle("not turtle", approval.id)).rejects.toThrow();
  });
});

it("documents every canonical term and every emitted minted term", async () => {
  const docs = readFileSync(new URL("../../docs/vocab.ttl", import.meta.url), "utf8");
  const dataset = await parseRdf(docs, "text/turtle");
  for (const name of Object.keys(TERM_DEFINITIONS)) {
    const node = new RdfResource(agent(name), dataset, DataFactory);
    expect(node.read(`${RDFS}comment`, "string")).toBe(
      TERM_DEFINITIONS[name as keyof typeof TERM_DEFINITIONS],
    );
    expect(VOCAB_MAPPING[`AWP.${name}`]).toBe(agent(name));
    expect(VOCAB_MAPPING[`AGENTIC.${name}`]).toBe(agent(name));
  }
  for (const record of Object.values(exampleRecords)) {
    for (const quad of toRdf(record)) {
      for (const term of [quad.predicate, quad.object]) {
        if (term.termType === "NamedNode" && term.value.startsWith(AGENT)) {
          expect(Object.hasOwn(TERM_DEFINITIONS, term.value.slice(AGENT.length))).toBe(true);
        }
      }
    }
  }
});
