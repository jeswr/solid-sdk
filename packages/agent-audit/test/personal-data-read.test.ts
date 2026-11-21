// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, it } from "vitest";
import { MemoryLedger } from "../src/ledger.js";
import { entryGraph, node, PROV } from "../src/rdf.js";
import { auditArtifact } from "../src/reader.js";
import { type AuditRecord, checkedRecord, ENTRY_KINDS, GENESIS, seal } from "../src/records.js";
import { aggregateTaskStats } from "../src/stats.js";
import { AT, fixture } from "./fixture.js";

const record: AuditRecord = {
  type: "personal-data-read",
  id: "urn:read",
  owner: "urn:owner",
  agent: "urn:agent",
  tool: "memory_recall",
  decision: "permit",
  reason: "autonomous",
  purpose: "https://w3id.org/dpv#Personalisation",
  categories: ["https://w3id.org/dpv/pd#Preference"],
  resources: ["urn:memory:one", "urn:memory:two"],
};
it("appends the new kind without changing historical ordering", () => {
  expect(ENTRY_KINDS).toEqual([
    "ingest",
    "proposal",
    "decision",
    "approval-seen",
    "transmission",
    "receipt",
    "control",
    "mandate-change",
    "model-call",
    "tool-call",
    "tamper-suspected",
    "conversation",
    "personal-data-read",
  ]);
  expect(checkedRecord(record)).toEqual(record);
  const { purpose: _purpose, ...withoutPurpose } = record;
  expect(
    checkedRecord({
      ...withoutPurpose,
      categories: ["https://w3id.org/dpv/pd#Preference"],
      resources: [],
    }),
  ).toBeDefined();
  expect(() => checkedRecord({ ...withoutPurpose, categories: [], resources: [] })).toThrow();
});
it.each([
  "tool",
  "decision",
  "reason",
  "categories",
  "resources",
])("requires %s for personal reads", (field) => {
  const value = { ...record };
  delete value[field as keyof AuditRecord];
  expect(() => checkedRecord(value)).toThrow();
});
it("forbids recall fields on every other kind, and refuses unbounded or value-bearing fields", () => {
  for (const type of ENTRY_KINDS.filter((t) => t !== "personal-data-read"))
    for (const field of ["purpose", "categories", "resources"])
      expect(() =>
        checkedRecord({
          type,
          id: "urn:test",
          owner: "urn:owner",
          agent: "urn:agent",
          [field]: record[field as keyof AuditRecord],
        }),
      ).toThrow();
  for (const field of [
    "value",
    "values",
    "body",
    "prompt",
    "result",
    "arguments",
    "data",
    "categoryValues",
  ])
    expect(() => checkedRecord({ ...record, [field]: "private" })).toThrow();
  for (const patch of [
    { categories: Array(65).fill("urn:category") },
    { resources: Array(101).fill("urn:resource") },
    { purpose: "not an IRI" },
    { categories: ["literal"] },
    { resources: ["literal"] },
  ])
    expect(() => checkedRecord({ ...record, ...patch })).toThrow();
  expect(
    checkedRecord({
      ...record,
      categories: Array(64).fill("urn:category"),
      resources: Array(100).fill("urn:resource"),
    }),
  ).toBeDefined();
});
it("projects only reference metadata through the typed RDF writer", () => {
  const url = "https://pod.example/agent/audit/1.ttl";
  const graph = entryGraph(url, seal(1, AT, GENESIS, record));
  const n = node(graph, url);
  expect(n.values("https://w3id.org/dpv#hasPurpose").map((v) => v.value)).toEqual([record.purpose]);
  expect(n.values("https://w3id.org/dpv#hasPersonalData").map((v) => v.value)).toEqual(
    record.categories,
  );
  expect(n.values(`${PROV}used`).map((v) => v.value)).toEqual(record.resources);
  expect(
    [...graph]
      .filter((q) => q.predicate.value.startsWith("https://w3id.org/dpv#"))
      .every((q) => q.object.termType === "NamedNode"),
  ).toBe(true);
  const { purpose: _purpose, ...withoutPurpose } = record;
  const minimal = {
    ...withoutPurpose,
    categories: ["https://w3id.org/dpv/pd#Preference"],
    resources: [],
  };
  expect(
    node(entryGraph(url, seal(1, AT, GENESIS, minimal)), url).values(
      "https://w3id.org/dpv#hasPurpose",
    ),
  ).toEqual([]);
});
it("statistics entirely ignore reads, including their task labels and refused decisions", () => {
  const ledger = new MemoryLedger();
  const before = aggregateTaskStats(ledger.entries());
  ledger.append({ ...record, decision: "refuse-all" }, AT);
  ledger.append({ ...record, taskId: "recall", decision: "prohibited" }, AT);
  expect(aggregateTaskStats(ledger.entries())).toEqual(before);
});
it("auditArtifact ignores read event identities and references while verifying their chain", async () => {
  const f = await fixture();
  const before = await auditArtifact({ fetch: f.pod.fetch, root: f.root, proposal: f.proposal });
  expect(before.ok).toBe(true);
  f.records.push({ ...record, id: f.proposal, proposal: f.proposal, decision: "refuse-all" });
  await f.mirror();
  const after = await auditArtifact({ fetch: f.pod.fetch, root: f.root, proposal: f.proposal });
  expect(after.ok).toBe(true);
  expect(after.authorityChain).toEqual(before.authorityChain);
  expect(after.breaches).toEqual([]);
});
