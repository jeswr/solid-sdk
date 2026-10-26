// AUTHORED-BY Codex GPT-6.1-Sol
import { readFileSync } from "node:fs";
import { LEGACY_NAMESPACES, NS } from "@jeswr/suite-vocab";
import { DataFactory, Parser, Store } from "n3";
import { expect, it } from "vitest";

it.each([
  [
    "pod-docs",
    NS.POD_DOCS,
    "pd",
    ["Document", "body", "format", "currentRevision", "updateLog", "assets", "comments"],
  ],
  ["pod-drive", NS.POD_DRIVE, "poddrive", ["DriveRoot"]],
] as const)("parses %s and declares exactly the approved terms", (app, base, prefix, terms) => {
  const url = new URL(`../../${app}/vocab/${app}.ttl`, import.meta.url);
  const parser = new Parser();
  const store = new Store(parser.parse(readFileSync(url, "utf8")));
  const named = DataFactory.namedNode;
  const declared = [...store.match(null, named(`${NS.RDF}type`), null)]
    .filter((q) => q.subject.value.startsWith(base))
    .map((q) => q.subject.value)
    .sort();
  expect(declared).toEqual(terms.map((term) => base + term).sort());
  const subjects = new Set(
    [...store].filter((q) => q.subject.value.startsWith(base)).map((q) => q.subject.value),
  );
  expect([...subjects].sort()).toEqual(terms.map((term) => base + term).sort());
  const ontology = named(base.slice(0, -1));
  expect(
    [...store.match(ontology, named(`${NS.VANN}preferredNamespacePrefix`), null)][0]?.object.value,
  ).toBe(prefix);
  expect(
    [...store.match(ontology, named(`${NS.VANN}preferredNamespaceUri`), null)][0]?.object.value,
  ).toBe(base);
  if (app === "pod-docs") {
    for (const term of ["updateLog", "assets", "comments"]) {
      const subject = named(base + term);
      expect(
        store.match(subject, named(`${NS.RDF}type`), named(`${NS.OWL}ObjectProperty`)).size,
      ).toBe(1);
      expect(store.match(subject, named(`${NS.RDFS}domain`), named(`${base}Document`)).size).toBe(
        1,
      );
      expect(store.match(subject, named(`${NS.RDFS}range`), named(`${NS.LDP}Container`)).size).toBe(
        1,
      );
      expect(
        [...store.match(subject, named(`${NS.RDFS}comment`), null)][0]?.object.value,
      ).toContain("container holding");
    }
  }
});

it.each([
  ["pod-docs/clientid.jsonld", NS.POD_DOCS],
  ["pod-drive/public/clientid.jsonld", NS.POD_DRIVE],
  ["pod-health/public/clientid.jsonld", NS.HEALTH],
])("publishes canonical federation metadata in %s", (path, namespace) => {
  const metadata = JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), "utf8"));
  const serialized = JSON.stringify(metadata);
  for (const legacy of Object.keys(LEGACY_NAMESPACES)) {
    expect(serialized).not.toContain(legacy);
  }
  expect(metadata["@context"][1].fedapp).toBe(NS.FED);
  expect(serialized).toContain(namespace);
});
