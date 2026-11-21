// AUTHORED-BY Codex GPT-6.2 Sol
import { parseRdfSync, type Term } from "@jeswr/fetch-rdf";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { readdirSync, readFileSync } from "fs";
import jsonld from "jsonld";
import type { Store } from "n3";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { expect, it, vi } from "vitest";
// @ts-expect-error The migration command has no declaration file.
import { checkMigration, engineDigest } from "../scripts/migrate-fixtures-jsonld.mjs";
import { digestBytes, isIri } from "../src/core/canonical.js";
import { loadScenario, readCaseGraph } from "../src/engine/load.js";
import { ANSWERABLE_CONTEXT, ODRL_CONTEXT, VC_CONTEXT } from "../src/wire/contexts.js";
import {
  SCENARIO_CONTEXT,
  SCENARIO_CONTEXT_SHA256,
  scenarioDocumentLoader,
} from "../src/wire/store-contexts.js";

const root = join(import.meta.dirname, "..");
const awps = "https://w3id.org/jeswr/awp/scenario#";
const awp = "https://w3id.org/jeswr/awp#";
const rdf = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const odrl = "http://www.w3.org/ns/odrl/2/";
const xsdString = "http://www.w3.org/2001/XMLSchema#string";
const read = (path: string) => readFileSync(join(root, path), "utf8");

it("checks migration and the pre-migration engine-object digests", () => {
  expect(checkMigration()).toBe(145);
});

it("detects reordering steps appended by a keyed branch patch", async () => {
  const { patch } = await import("../src/engine/run.js");
  const scenario = loadScenario(join(root, "scenarios/mortgage-main.json"));
  const [first] = scenario.script;
  if (!first) throw new Error("The fixture has no initial step");
  const { id: _, ...step } = first;
  const [branch] = scenario.branches;
  if (!branch) throw new Error("The fixture has no branch");
  const forward = { ...branch, change: { script: { "new-a": step, "new-b": step } } };
  const reverse = { ...branch, change: { script: { "new-b": step, "new-a": step } } };
  expect(
    patch(scenario, forward.change)
      .script.slice(-2)
      .map(({ id }) => id),
  ).toEqual(["new-a", "new-b"]);
  expect(
    patch(scenario, reverse.change)
      .script.slice(-2)
      .map(({ id }) => id),
  ).toEqual(["new-b", "new-a"]);
  expect(engineDigest({ ...scenario, branches: [forward] })).not.toBe(
    engineDigest({ ...scenario, branches: [reverse] }),
  );
});

const textPredicates = new Set([
  "http://www.w3.org/2000/01/rdf-schema#label",
  "https://schema.org/email",
  `${awp}termsDigest`,
]);

function isLocalListReference(dataset: Store, cell: Term, value: string): boolean {
  const owner = value.startsWith("message:") ? "claims" : "replaces";
  if (!/^(?:message|statement|step):/.test(value)) return false;
  let previous = dataset.getSubjects(`${rdf}rest`, cell, null)[0];
  while (previous) {
    cell = previous;
    previous = dataset.getSubjects(`${rdf}rest`, cell, null)[0];
  }
  return dataset.countQuads(null, `${awps}${owner}`, cell, null) > 0;
}

it.each([
  ["profiles", "profile", "DomainProfile"],
  ["scenarios", "scenario", "Scenario"],
])(
  "checks every %s document and reads its identified RDF root",
  async (directory, kind, type) => {
    for (const file of readdirSync(join(root, directory)).filter((name) =>
      name.endsWith(".json"),
    )) {
      const path = join(root, directory, file);
      const id = file.slice(0, -5);
      const graph = await readCaseGraph(path);
      expect(graph.root, file).toBe(`urn:${kind}:${id}`);
      expect(graph.dataset.countQuads(graph.root, rdf + "type", awps + type, null), file).toBe(1);
      expect(graph.dataset.getObjects(graph.root, awps + "slug", null)[0]?.value, file).toBe(id);
      const iriLiterals = [];
      for (const { subject, object, predicate } of graph.dataset) {
        if (
          object.termType !== "Literal" ||
          object.datatype.value !== xsdString ||
          !isIri(object.value)
        )
          continue;
        if (textPredicates.has(predicate.value)) continue;
        // These are local claim or fixture references whose syntax includes a colon.
        if (
          predicate.value === `${rdf}first` &&
          isLocalListReference(graph.dataset, subject, object.value)
        )
          continue;
        iriLiterals.push([predicate.value, object.value]);
      }
      expect(iriLiterals, file).toEqual([]);
      if (id === "mortgage-main") {
        const fixture = JSON.parse(read(`${directory}/${file}`));
        const trust = one(graph.dataset, graph.root, awps + "trust");
        const entries = graph.dataset.getObjects(trust, awps + "ownLists", null);
        const entryKeys = entries.map((entry) => {
          expect(one(graph.dataset, entry, rdf + "type").value).toBe(awp + "OwnListEntry");
          return one(graph.dataset, entry, awps + "key").value;
        });
        const authoredKeys = Object.entries(fixture.trust.ownLists as Record<string, unknown[]>)
          .flatMap(([key, list]) => list.map(() => key))
          .sort();
        expect(entryKeys.sort()).toEqual(authoredKeys);
        const mandate = one(
          graph.dataset,
          one(graph.dataset, graph.root, awps + "mandates"),
          rdf + "first",
        );
        const rules = one(graph.dataset, mandate, awps + "nativeAutonomousRules");
        expect(rules).toMatchObject({ termType: "Literal", datatype: { value: rdf + "JSON" } });
        expect(JSON.parse(rules.value)).toEqual(fixture.mandates[0].autonomous);
      }
      if (id === "wearable-data" && kind === "profile") {
        const fixture = JSON.parse(read(`${directory}/${file}`));
        const actors = graph.dataset.getObjects(graph.root, awps + "termsAcceptance", null);
        expect(actors.map((actor) => actor.value).sort()).toEqual(
          Object.keys(fixture.termsAcceptance).sort(),
        );
        expect(actors.every((actor) => actor.termType === "NamedNode")).toBe(true);
      }
    }
  },
  60_000,
);

function one(dataset: Store, subject: string | Term, predicate: string) {
  const values = dataset.getObjects(subject, predicate, null);
  expect(values, predicate).toHaveLength(1);
  return values[0]!;
}

it("emits the wildcard and repeated claim types directly on source authority rules", async () => {
  const path = join(root, "scenarios/mortgage-main.json");
  const { dataset } = await readCaseGraph(path);
  const rules = Object.values(loadScenario(path).trust.sources).flat();
  const wildcard = rules.find((rule) => rule.subjects === "any" && rule.claimTypes.length > 1);
  if (!wildcard) throw new Error("Missing wildcard rule with multiple claim types");
  expect.soft(one(dataset, wildcard.id, `${awp}subjects`)).toMatchObject({
    termType: "NamedNode",
    value: `${awp}anySubject`,
  });
  expect
    .soft(
      dataset
        .getObjects(wildcard.id, `${awp}claimType`, null)
        .map((term) => {
          expect.soft(term.termType).toBe("Literal");
          return term.value;
        })
        .sort(),
    )
    .toEqual([...wildcard.claimTypes].sort());
  expect.soft(dataset.countQuads(wildcard.id, `${awps}claimTypes`, null, null)).toBe(0);

  const restricted = rules.find((rule) => rule.subjects !== "any");
  if (!restricted || restricted.subjects === "any") throw new Error("Missing restricted rule");
  let cell = one(dataset, restricted.id, `${awp}subjects`);
  for (const subject of restricted.subjects) {
    expect(one(dataset, cell, `${rdf}first`)).toMatchObject({
      termType: "NamedNode",
      value: subject,
    });
    cell = one(dataset, cell, `${rdf}rest`);
  }
  expect(cell.value).toBe(`${rdf}nil`);
});

it("joins recycled-content action claims to operation nodes", async () => {
  const { dataset, root: subject } = await readCaseGraph(
    join(root, "profiles/recycled-content.json"),
  );
  let claimCell = one(dataset, subject, `${awps}actionClaims`);
  for (const action of ["urn:op:recycled-content", "urn:op:recycled-content:proof-answer"]) {
    const entry = one(dataset, claimCell, `${rdf}first`);
    const operation = one(dataset, entry, `${odrl}action`);
    expect(operation).toMatchObject({ termType: "NamedNode", value: action });
    expect(one(dataset, operation, "http://www.w3.org/2000/01/rdf-schema#label").termType).toBe(
      "Literal",
    );
    claimCell = one(dataset, claimCell, `${rdf}rest`);
  }
  expect(claimCell.value).toBe(`${rdf}nil`);
});

it.each([
  "script",
  "branches",
])("preserves mortgage-main %s as an ordered RDF list", async (key) => {
  const path = "scenarios/mortgage-main.json";
  const { dataset, root: subject } = await readCaseGraph(join(root, path));
  const expected: { id: string }[] = JSON.parse(read(path))[key];
  let cell = one(dataset, subject, awps + key);
  for (const item of expected) {
    const entry = one(dataset, cell, rdf + "first");
    expect(one(dataset, entry, awps + "slug").value).toBe(item.id);
    cell = one(dataset, cell, rdf + "rest");
  }
  expect(cell.value).toBe(rdf + "nil");
});

it("pins and declares scenario terms and ratchets JSON literals against the context README", async () => {
  const bytes = read("vocab/context/scenario-v1.jsonld");
  const bundled = JSON.parse(bytes);
  const context = bundled["@context"];
  expect(digestBytes(bytes)).toBe("sha-256:" + SCENARIO_CONTEXT_SHA256);
  await expect(scenarioDocumentLoader.load(SCENARIO_CONTEXT)).resolves.toEqual(bundled);
  await expect(scenarioDocumentLoader.load(ODRL_CONTEXT)).resolves.toHaveProperty("@context");
  await expect(scenarioDocumentLoader.load(VC_CONTEXT)).resolves.toHaveProperty("@context");
  await expect(scenarioDocumentLoader.load(ANSWERABLE_CONTEXT)).rejects.toThrow(
    "context-not-accepted",
  );
  const readme = read("vocab/context/scenario-v1.README.md");
  const ontology = parseRdfSync(read("vocab/scenario.ttl"));
  const jsonTerms = new Set<string>();
  function walk(scope: Record<string, unknown>) {
    for (const [term, definition] of Object.entries(scope)) {
      if (term.startsWith("@")) continue;
      const def = definition as { "@id"?: string; "@type"?: string; "@context"?: unknown };
      if (def["@type"] === "@json") jsonTerms.add(term);
      const iri = typeof definition === "string" ? definition : def["@id"];
      if (iri?.startsWith("awps:")) {
        const identifier = awps + iri.slice(5);
        expect(ontology.countQuads(identifier, rdf + "type", null, null), identifier).toBe(1);
      }
      if (def["@context"] && typeof def["@context"] === "object")
        walk(def["@context"] as Record<string, unknown>);
    }
  }
  expect(context).toHaveProperty("@version", 1.1);
  expect(context).not.toHaveProperty("@vocab");
  expect(context).not.toHaveProperty("@base");
  expect(context).not.toHaveProperty("id");
  walk(context);
  expect(jsonTerms.size).toBeGreaterThan(0);
  const documented = readme.split("## Slug references")[0] ?? "";
  expect([...jsonTerms].sort()).toEqual(
    [...documented.matchAll(/^\| `([^\x60]+)` \| .+ \|$/gm)].map((match) => match[1]).sort(),
  );
});

it("imports the package before trying the internal resolver and falls back to identical N-Quads", async () => {
  const path = join(root, "scenarios/mortgage-core.json");
  const toRDF = vi.spyOn(jsonld, "toRDF");
  try {
    await readCaseGraph(path);
    expect(toRDF).toHaveBeenCalledOnce();
    expect(toRDF.mock.calls[0]?.[1]).toHaveProperty("contextResolver");
    const expected = await toRDF.mock.results[0]?.value;
    toRDF.mockClear();

    vi.resetModules();
    const unavailable = vi.fn(() => {
      throw Object.assign(new Error("jsonld internal resolver unavailable"), {
        code: "ERR_PACKAGE_PATH_NOT_EXPORTED",
      });
    });
    vi.doMock("jsonld/lib/ContextResolver.js", unavailable);
    const engine = await import("../src/index.js");
    expect(unavailable).not.toHaveBeenCalled();
    expect(engine.loadScenario(path).schema).toBe("agent-scenario/0.1");
    expect(unavailable).not.toHaveBeenCalled();
    const fixture = await import("../src/engine/load.js");
    await expect(fixture.readCaseGraph(path)).resolves.toHaveProperty(
      "root",
      "urn:scenario:mortgage-core",
    );
    expect(unavailable).toHaveBeenCalledOnce();
    expect(toRDF).toHaveBeenCalledOnce();
    expect(toRDF.mock.calls[0]?.[1]).not.toHaveProperty("contextResolver");
    expect(await toRDF.mock.results[0]?.value).toBe(expected);
  } finally {
    vi.doUnmock("jsonld/lib/ContextResolver.js");
    vi.resetModules();
    toRDF.mockRestore();
  }
}, 15_000);
