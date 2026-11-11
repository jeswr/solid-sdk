// AUTHORED-BY Codex GPT-6.1-Sol
import { NanopubStore } from "@jeswr/pkg-memory";
import { createMemoryPodPort } from "@jeswr/pkg-memory/testing";
import { NamedGraphDataset } from "@rdfjs/wrapper";
import { DataFactory as df, type Store, Writer } from "n3";
import { expect, it } from "vitest";
import { entities } from "../src/generated/model.js";
import {
  healthTimeline,
  importHealthExport,
  observationSeries,
  projectHealthFacts,
} from "../src/index.js";
import { batch, claim, condition, FixtureNode, observation, owner, S, X } from "./helpers.js";

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing fictional fixture");
  return value;
}
// External exports can contain invalid values that the atomic serializer refuses.
function external(dataset: Store): Promise<string> {
  const writer = new Writer({ format: "application/trig" });
  writer.addQuads([...dataset]);
  return new Promise((resolve, reject) =>
    writer.end((error, text) => (error ? reject(error) : resolve(text))),
  );
}
function poison(dataset: Store, name: string): void {
  new FixtureNode(
    "https://example.org/extra",
    new NamedGraphDataset(df.namedNode(name), dataset, df),
  ).text(`${S}name`, "Fictional\u2028value");
}

it("keeps A uncertain when its superseding revision B is skipped", async () => {
  const value = await batch([
    claim("a", condition("Fictional original", "a")),
    { ...claim("b", condition("Fictional revision", "b")), supersedes: ["a"] },
    claim("unrelated", condition("Fictional unrelated", "unrelated")),
  ]);
  const a = required(value.nanopubs.find((np) => np.identifier.endsWith("/a")));
  const b = required(value.nanopubs.find((np) => np.identifier.endsWith("/b")));
  expect(projectHealthFacts(value, { owner }).facts.find((f) => f.id === a.id)?.belief).toBe(
    "past",
  );
  poison(value.dataset, b.provenanceId);
  const imported = await importHealthExport(await external(value.dataset), { owner });
  expect(imported.value.affected).toEqual([a.id]);
  expect(imported.skipped.count).toBe(1);
  const view = projectHealthFacts(imported.value, { owner });
  expect(view.facts.find((f) => f.id === a.id)).toMatchObject({
    belief: "might",
    affectedBySkipped: true,
  });
  expect(view.facts.find((f) => f.label === "Fictional unrelated")).toMatchObject({
    belief: "definitely",
    affectedBySkipped: undefined,
  });
});

it("keeps A uncertain when its retraction R is skipped", async () => {
  const port = createMemoryPodPort({ root: "https://example.org/pod/", webId: owner });
  const store = new NanopubStore({
    ...port,
    async head(target: string) {
      return { acl: `${target}.acl` };
    },
  });
  const original = await batch([claim("a")]);
  const a = required(original.nanopubs[0]);
  await store.put(original);
  const withdrawal = await store.retract(a.id, {
    batchId: "withdrawal",
    clientId: "https://example.org/client",
    generatedAt: "2026-11-11T12:00:00Z",
  });
  const r = required(withdrawal.nanopubs[0]);
  const value = await store.list();
  expect(projectHealthFacts(value, { owner }).facts.find((f) => f.id === a.id)?.belief).toBe(
    "past",
  );
  poison(value.dataset, r.pubinfoId);
  const imported = await importHealthExport(await external(value.dataset), { owner });
  expect(imported.value.affected).toEqual([a.id]);
  expect(projectHealthFacts(imported.value, { owner }).facts).toMatchObject([
    { id: a.id, belief: "might", affectedBySkipped: true },
  ]);
});

it.each([
  ["financial", ["pd:Financial"], false],
  ["uncategorised", [], true],
  ["health", ["pd:MedicalHealth"], true],
  ["mixed", ["pd:Financial", "pd:MedicalHealth"], true],
] as const)("admits %s documents only with health or no categories", async (id, categories, admitted) => {
  const assertion = entities.DigitalDocument.build(`https://example.org/${id}`, {
    about: owner,
    name: "Fictional document",
  });
  const view = projectHealthFacts(
    await batch([{ ...claim(id), assertion, categories: [...categories] }]),
    { owner },
  );
  expect(view.byKind.document).toHaveLength(admitted ? 1 : 0);
  expect(view.unrecognised).toEqual([]);
  if (!admitted) expect(JSON.stringify(view)).not.toContain("Fictional document");
});

it.each([
  ["string", "2026-02-01", undefined],
  ["date", "2026-02-30", undefined],
  ["date", "not a date", undefined],
  ["date", "2026-02-01", "2026-02-01"],
  ["gYearMonth", "2026-02", "2026-02"],
  ["gYear", "2026", "2026"],
  ["dateTime", "2026-02-01T00:00:00Z", "2026-02-01T00:00:00+00:00"],
] as const)("validates document dateCreated: %s %s", async (datatype, date, expected) => {
  const assertion = entities.DigitalDocument.build("https://example.org/document", {
    about: owner,
  });
  new FixtureNode("https://example.org/document", assertion).text(
    `${S}dateCreated`,
    date,
    X + datatype,
  );
  const view = projectHealthFacts(await batch([{ ...claim("document"), assertion }]), { owner });
  expect(required(view.byKind.document[0])).toMatchObject({ dateCreated: expected });
  expect(healthTimeline(view).documents).toHaveLength(expected ? 1 : 0);
});

function memoryStore() {
  const port = createMemoryPodPort({ root: "https://example.org/pod/", webId: owner });
  return new NanopubStore({
    ...port,
    async head(target: string) {
      return { acl: `${target}.acl` };
    },
  });
}
const withdraw = { clientId: "https://example.org/client", generatedAt: "2026-11-11T12:00:00Z" };

it("keeps A past when one of two retractions is skipped", async () => {
  const store = memoryStore();
  const original = await batch([claim("a")]);
  const a = required(original.nanopubs[0]);
  await store.put(original);
  const r1 = required((await store.retract(a.id, { ...withdraw, batchId: "w1" })).nanopubs[0]);
  const r2 = required(
    (
      await store.retract(a.id, {
        ...withdraw,
        batchId: "w2",
        generatedAt: "2026-11-11T13:00:00Z",
      })
    ).nanopubs[0],
  );
  const value = await store.list();
  poison(value.dataset, r2.pubinfoId);
  const imported = await importHealthExport(await external(value.dataset), { owner });
  const view = projectHealthFacts(imported.value, { owner });
  for (const id of [a.id, r1.id]) {
    const fact = view.facts.find((f) => f.id === id);
    expect(fact?.belief).toBe("past");
    expect(fact?.affectedBySkipped).toBeUndefined();
  }
  expect(healthTimeline(view).condition.find((item) => item.id === a.id)?.tone).toBe("past");
});

it("keeps A past when it has its own invalidation and its skipped replacement names it", async () => {
  const value = await batch([
    { ...claim("old", condition("Fictional old", "old")), validity: "Superseded" },
    claim("bad", condition("Fictional bad", "bad")),
  ]);
  const old = required(value.nanopubs.find((np) => np.identifier.endsWith("/old")));
  const bad = required(value.nanopubs.find((np) => np.identifier.endsWith("/bad")));
  new FixtureNode(
    bad.assertionId,
    new NamedGraphDataset(df.namedNode(bad.provenanceId), value.dataset, df),
  ).link("http://www.w3.org/ns/prov#wasRevisionOf", old.assertionId);
  poison(value.dataset, bad.pubinfoId);
  const imported = await importHealthExport(await external(value.dataset), { owner });
  expect(imported.value.affected).toEqual([old.id]);
  expect(projectHealthFacts(imported.value, { owner }).facts).toMatchObject([
    { id: old.id, belief: "past", affectedBySkipped: undefined },
  ]);
});

it("never raises a Mentioned claim named by a skipped contradiction", async () => {
  const value = await batch([
    { ...claim("m", condition("Fictional mentioned", "m")), epistemic: "Mentioned" },
    claim("bad", condition("Fictional bad", "bad")),
  ]);
  const m = required(value.nanopubs.find((np) => np.identifier.endsWith("/m")));
  const bad = required(value.nanopubs.find((np) => np.identifier.endsWith("/bad")));
  new FixtureNode(
    bad.assertionId,
    new NamedGraphDataset(df.namedNode(bad.provenanceId), value.dataset, df),
  ).link("https://jeswr.org/ns/pkg#contradicts", m.assertionId);
  poison(value.dataset, bad.pubinfoId);
  const imported = await importHealthExport(await external(value.dataset), { owner });
  expect(projectHealthFacts(imported.value, { owner }).facts).toMatchObject([
    { id: m.id, belief: "mentioned", affectedBySkipped: undefined },
  ]);
});

it("limits a skipped envelope-scoped retraction to the envelope it names", async () => {
  const store = memoryStore();
  const first = await batch([claim("a")], "b1");
  const second = await batch([claim("a")], "b2");
  const a = required(first.nanopubs[0]);
  const copy = required(second.nanopubs[0]);
  expect(copy.assertionId).toBe(a.assertionId);
  await store.put(first);
  await store.put(second);
  const r = required((await store.retract(a.id, { ...withdraw, batchId: "w" })).nanopubs[0]);
  const value = await store.list();
  poison(value.dataset, r.pubinfoId);
  const imported = await importHealthExport(await external(value.dataset), { owner });
  expect(imported.value.affected).toEqual([a.id]);
  const view = projectHealthFacts(imported.value, { owner });
  expect(view.facts.find((f) => f.id === a.id)).toMatchObject({
    belief: "might",
    affectedBySkipped: true,
  });
  expect(view.facts.find((f) => f.id === copy.id)).toMatchObject({
    belief: "definitely",
    affectedBySkipped: undefined,
  });
});

it("marks uncertain facts on the timeline and never shows them as active", async () => {
  const value = await batch([
    claim("a", condition("Fictional original", "a")),
    { ...claim("b", condition("Fictional revision", "b")), supersedes: ["a"] },
  ]);
  const a = required(value.nanopubs.find((np) => np.identifier.endsWith("/a")));
  const b = required(value.nanopubs.find((np) => np.identifier.endsWith("/b")));
  poison(value.dataset, b.provenanceId);
  const imported = await importHealthExport(await external(value.dataset), { owner });
  const item = healthTimeline(projectHealthFacts(imported.value, { owner })).condition.find(
    (entry) => entry.id === a.id,
  );
  expect(item).toMatchObject({ belief: "might", affectedBySkipped: true, tone: "neutral" });
});

it("marks series points whose observation has an unreadable later update", async () => {
  const value = await batch([
    { ...claim("pulse"), assertion: observation({ id: "pulse", date: "2026-10-01T00:00:00Z" }) },
    {
      ...claim("pulse-fix"),
      assertion: observation({ id: "fix", date: "2026-10-01T00:00:00Z" }),
      supersedes: ["pulse"],
    },
  ]);
  const pulse = required(value.nanopubs.find((np) => np.identifier.endsWith("/pulse")));
  const fix = required(value.nanopubs.find((np) => np.identifier.endsWith("/pulse-fix")));
  poison(value.dataset, fix.provenanceId);
  const imported = await importHealthExport(await external(value.dataset), { owner });
  const points = observationSeries(projectHealthFacts(imported.value, { owner })).series.flatMap(
    (series) => series.points,
  );
  expect(points).toMatchObject([{ factId: pulse.id, belief: "might", affectedBySkipped: true }]);
});
