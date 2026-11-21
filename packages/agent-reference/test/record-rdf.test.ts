// AUTHORED-BY Codex GPT-6.2 Sol
// AUTHORED-BY Codex GPT-6
import { parseRdf } from "@jeswr/fetch-rdf";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { readFileSync } from "fs";
import { DataFactory, Store } from "n3";
import ShaclValidator from "rdf-validate-shacl";
import { expect, it } from "vitest";
import { digestBytes, digestOf } from "../src/core/canonical.js";
import { StoreNode } from "../src/model/store/common.js";
import {
  REQUIRED_TYPED_RECORDS,
  rangeEntryDataset,
  recordEntryDataset,
  recordEntryFrom,
  recordGraphIri,
} from "../src/model/store/record.js";
import {
  LEDGER_GENESIS,
  legacyApprovalRedaction,
  MemoryLedger,
  verifyLedger,
  verifyLedgerRange,
} from "../src/store/ledger.js";
import { TraceRecorder } from "../src/trace/recorder.js";
import { storeDocumentLoader } from "../src/wire/store-contexts.js";
import { linkedView, storeProjection } from "../src/wire/store-document.js";
import { readNQuads, writeNQuads } from "../src/wire/store-quads.js";

const at = "2026-11-20T09:00:00Z";
const digest = digestOf("fixture");
const awp = "https://w3id.org/jeswr/awp#";
const rdfType = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const { namedNode, literal } = DataFactory;
const records = [
  {
    type: "gate-check",
    agent: "urn:actor",
    gate: "inbound-gate",
    check: "integrity",
    verdict: "pass",
    at,
  },
  {
    type: "gate-decision",
    agent: "urn:actor",
    gate: "outbound-gate",
    outcome: "go",
    checks: [digest, digestOf("second"), digest],
    at,
  },
  {
    type: "verification",
    protectedObject: digest,
    property: "none-unsigned",
    mechanism: "fixture",
    verifier: "urn:verifier",
    outcome: "not-applicable",
    limitations: ["two", "one", "two"],
    at,
  },
  {
    type: "representation-assessment",
    evaluator: "urn:evaluator",
    actor: "urn:actor",
    party: "urn:party",
    outcome: "accepted",
    at,
  },
  {
    type: "authorisation-decision",
    decider: "urn:actor",
    actionDigest: digest,
    action: { z: { z: 1e-30, a: false }, a: ["a", null] },
    policy: { id: "urn:policy", digest, evaluator: "fixture" },
    outcome: "permit",
    reason: "ok",
    originalDigests: [digest, digestOf("other original"), digest],
    at,
  },
  {
    type: "grant",
    id: "urn:grant",
    kind: "owner-mandate",
    grantor: "urn:issuer",
    grantee: "urn:actor",
    digest,
    at,
  },
  ...["message-in", "message-out"].map((type) => ({
    type,
    id: "urn:message",
    kind: "describe",
    conversation: "urn:conversation",
    digest,
    at,
  })),
  ...["item-received", "item-released"].map((type) => ({
    type,
    item: "urn:item",
    digest,
    subject: type === "item-received" ? "Raw subject text" : "urn:subject",
    to: { actor: "urn:recipient", party: "urn:recipient-party" },
    duties: [{ kind: "delete", items: ["urn:item"] }],
    at,
  })),
  { type: "approval-requested", actionDigest: digest, conversation: "urn:conversation", at },
  { type: "approval", jws: "exact.compact.jws" },
  {
    type: "ledger-checkpoint",
    prunedSegments: ["record.seg-2", "record.seg-1"],
    lastPrunedSeq: 2,
    lastPrunedHash: digest,
    note: "retention",
  },
  { type: "private-extension", z: { z: 0, a: ["two", null, "two"] }, a: "urn:value" },
];

const shapes = async () =>
  new ShaclValidator(
    (await parseRdf(
      readFileSync(new URL("../vocab/answerable-stores.shacl.ttl", import.meta.url), "utf8"),
      "text/turtle",
    )) as never,
  );

it.each(records)("round-trips and shape-validates $type", async (record) => {
  const entry = new MemoryLedger().append(record, at);
  const graph = recordGraphIri(entry.hash);
  const dataset = recordEntryDataset(entry);
  expect(dataset.getGraphs(null, null, null).map((term) => term.value)).toEqual([graph]);
  const payloadType = REQUIRED_TYPED_RECORDS.get(record.type) ?? awp + "UntypedRecord";
  const payload = dataset.getObjects(graph, awp + "record", graph)[0]!;
  expect(dataset.countQuads(payload, rdfType, payloadType, graph)).toBe(1);
  const decoded = recordEntryFrom(readNQuads(writeNQuads(dataset)), graph);
  expect(recordEntryFrom(dataset, graph)).toEqual(decoded);
  expect(digestOf(decoded)).toBe(digestOf(entry));
  expect(JSON.stringify(decoded.record)).toBe(JSON.stringify(entry.record));
  expect(verifyLedger([decoded as typeof entry]).ok).toBe(true);
  const report = await (await shapes()).validate(storeProjection(dataset, graph) as never);
  expect(
    report.conforms,
    report.results.map((result) => result.message.map((term) => term.value).join(" ")).join("\n"),
  ).toBe(true);
});

it("falls back to a shape-valid untyped record when the payload timestamp is invalid", async () => {
  const entry = new MemoryLedger().append({ type: "approval", at: "invalid" }, at);
  const graph = recordGraphIri(entry.hash);
  const dataset = recordEntryDataset(entry);
  const [payload] = dataset.getObjects(graph, `${awp}record`, graph);
  if (!payload) throw new Error("Missing record payload");
  expect(dataset.getObjects(payload, rdfType, graph)).toEqual([namedNode(`${awp}UntypedRecord`)]);
  expect(recordEntryFrom(readNQuads(writeNQuads(dataset)), graph)).toEqual(entry);
  expect((await (await shapes()).validate(storeProjection(dataset, graph) as never)).conforms).toBe(
    true,
  );
});

it("round-trips committed and legacy withheld entries without exposing payload terms", async () => {
  for (const committed of [true, false]) {
    const ledger = new MemoryLedger();
    if (committed) ledger.enableRangeCommitments();
    const entry = ledger.append(
      { type: "approval", jws: "unique.exact.jws", id: "urn:private:id" },
      at,
    );
    const withheld = legacyApprovalRedaction(entry)!;
    const graph = recordGraphIri(entry.hash);
    expect(
      verifyLedger([recordEntryFrom(recordEntryDataset(entry), graph) as typeof entry]).ok,
    ).toBe(true);
    const dataset = rangeEntryDataset(withheld);
    const decoded = recordEntryFrom(readNQuads(writeNQuads(dataset)), graph);
    expect(digestOf(decoded)).toBe(digestOf(withheld));
    expect(
      verifyLedgerRange(
        [decoded],
        LEDGER_GENESIS,
        ledger.head(),
        committed ? undefined : new Set([digestOf(withheld)]),
      ).ok,
    ).toBe(true);
    expect(dataset.getSubjects(null, null, null).map((term) => term.value)).toEqual([graph]);
    expect(dataset.countQuads(graph, rdfType, awp + "WithheldRecordEntry", graph)).toBe(1);
    const full = recordEntryDataset(entry);
    const payload = full.getObjects(graph, awp + "record", graph)[0]!;
    const privateTerms = [...full.match(payload, null, null, null)].flatMap((quad) => [
      quad.subject.value,
      quad.object.value,
    ]);
    const visibleTerms = [...dataset].flatMap((quad) => [quad.subject.value, quad.object.value]);
    for (const term of privateTerms) expect(visibleTerms).not.toContain(term);
    expect(
      (await (await shapes()).validate(storeProjection(dataset, graph) as never)).conforms,
    ).toBe(true);
    dataset.addQuad(
      namedNode(graph),
      namedNode(awp + "recordType"),
      literal("approval"),
      namedNode(graph),
    );
    expect(() => recordEntryFrom(dataset, graph)).toThrow();
  }
});

it("rejects non-output graphs and preserves seal verification after a valid one-quad mutation", () => {
  const entry = new MemoryLedger().append(records[0]!, at);
  const graph = recordGraphIri(entry.hash);
  const dataset = recordEntryDataset(entry);
  const verdict = dataset.getQuads(null, awp + "verdict", null, graph)[0]!;
  dataset.removeQuad(verdict);
  expect(() => recordEntryFrom(dataset, graph)).toThrow();
  dataset.addQuad(
    verdict.subject,
    verdict.predicate,
    namedNode(awp + "verdict/fail"),
    verdict.graph,
  );
  const decoded = recordEntryFrom(readNQuads(writeNQuads(dataset)), graph) as typeof entry;
  expect(verifyLedger([decoded])).toMatchObject({ ok: false, problem: "hash mismatch" });
  dataset.addQuad(verdict);
  expect(() => recordEntryFrom(dataset, graph)).toThrow();
  expect(() => recordEntryFrom(new Store(), graph)).toThrow();
});

it("projects only reachable subjects and renders the same RDF via Turtle and JSON-LD", async () => {
  const entry = new MemoryLedger().append(records[0]!, at);
  const root = recordGraphIri(entry.hash);
  const dataset = recordEntryDataset(entry);
  const projection = storeProjection(dataset, root);
  expect(projection.size).toBe(dataset.size);
  for (const quad of projection) {
    expect(quad.graph.termType).toBe("DefaultGraph");
    expect(dataset.countQuads(quad.subject, quad.predicate, quad.object, root)).toBe(1);
  }
  const subject = dataset.getObjects(root, awp + "record", root)[0]!;
  const p = namedNode(awp + "related");
  const issuer = namedNode("https://www.w3.org/2018/credentials#issuer");
  const child = namedNode("urn:child");
  dataset.addQuad(subject, p, child, namedNode("urn:other-graph"));
  dataset.addQuad(child, issuer, namedNode(root));
  dataset.addQuad(namedNode("urn:unreachable"), p, child);
  const json = { z: "\ud800", a: { z: "\udfff", a: true } };
  const jsonPredicate = `${awp}exactValue`;
  new StoreNode(child, dataset, "fixture").putValue(jsonPredicate, json);
  const expected = storeProjection(dataset, root);
  expect(expected.size).toBe(projection.size + 3);
  expect(expected.getObjects(child, jsonPredicate, null)).toEqual([
    literal(JSON.stringify(json), namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#JSON")),
  ]);
  const view = await linkedView(dataset, root, "record");
  expect(view.what).toBe("record");
  expect(JSON.parse(view.jsonld)["@context"]).toEqual(view.context);
  for (const graph of [
    await parseRdf(view.turtle, "text/turtle"),
    await parseRdf(view.jsonld, "application/ld+json", { documentLoader: storeDocumentLoader }),
  ]) {
    expect(graph.size).toBe(expected.size);
    for (const quad of graph) {
      expect(quad.graph.termType).toBe("DefaultGraph");
      expect([quad.subject, quad.object].every((term) => term.termType !== "BlankNode")).toBe(true);
      expect(expected.has(quad)).toBe(true);
    }
  }
});

it("keeps fragment escapes distinct across views and recorder keys", async () => {
  const recorder = new TraceRecorder(undefined, true);
  const sink = recorder.sink("agent");
  for (const root of ["urn:fixture#entry#two", "urn:fixture#entry%23two"]) {
    const dataset = new Store();
    dataset.addQuad(namedNode(root), namedNode(rdfType), namedNode(`${awp}RecordEntry`));
    sink.emit({
      part: "record",
      kind: "record",
      caption: "A recorded entry.",
      linkedInputs: [{ what: "record-entry", root, dataset }],
    });
  }
  await recorder.complete();
  const keys = recorder.events().flatMap((event) => event.linked ?? []);
  const views = keys.map((key) => {
    const view = recorder.linkedViews()?.[key];
    if (!view) throw new Error(`Missing linked view ${key}`);
    expect(digestBytes(view.jsonld)).toBe(key);
    return view;
  });
  expect(new Set(keys).size).toBe(2);
  expect(Object.keys(recorder.linkedViews() ?? {})).toEqual(keys);
  expect(views[0]?.jsonld).not.toBe(views[1]?.jsonld);
  expect(views[0]?.turtle).not.toBe(views[1]?.turtle);
});
