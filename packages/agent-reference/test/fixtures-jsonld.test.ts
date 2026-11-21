// AUTHORED-BY Codex GPT-6.2 Sol
import { parseRdfSync } from "@jeswr/fetch-rdf";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { readdirSync, readFileSync } from "fs";
import type { Store, Term } from "n3";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { expect, it } from "vitest";
// @ts-expect-error The migration command has no declaration file.
import { checkMigration } from "../scripts/migrate-fixtures-jsonld.mjs";
import { digestBytes } from "../src/core/canonical.js";
import { readCaseGraph } from "../src/engine/load.js";
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
const read = (path: string) => readFileSync(join(root, path), "utf8");

it("checks migration and the pre-migration engine-object digests", () => {
  expect(checkMigration()).toBe(145);
});

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
