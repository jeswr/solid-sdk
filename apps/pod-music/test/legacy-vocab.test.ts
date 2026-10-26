// AUTHORED-BY Codex GPT-6.1-Sol
import { NS } from "@jeswr/suite-vocab";
import { NamedNodeAs, NamedNodeFrom, SetFrom, TermWrapper } from "@rdfjs/wrapper";
import { Store } from "n3";
import { expect, it } from "vitest";
import { factory, parseTurtle, serializeTurtle } from "../src/lib/rdf.js";
import { FEDAPP_APP, FEDAPP_SECTOR, RDF_TYPE, SECTOR_MEDIA, SECTORS } from "../src/vocab/iris.js";

it("reads legacy federation metadata and serializes canonical federation and sector IRIs", async () => {
  const dataset = new Store();
  const app = new TermWrapper("urn:app", dataset, factory);
  SetFrom.subjectPredicate(app, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string).add(FEDAPP_APP);
  SetFrom.subjectPredicate(app, FEDAPP_SECTOR, NamedNodeAs.string, NamedNodeFrom.string).add(
    SECTOR_MEDIA,
  );
  const canonical = await serializeTurtle(dataset);
  expect(FEDAPP_APP).toBe(`${NS.FED}App`);
  expect(SECTORS).toBe("https://jeswr.org/ns/sectors/");
  expect(canonical).not.toContain("w3id.org/jeswr");
  const legacy = canonical.replaceAll("https://jeswr.org/ns/", "https://w3id.org/jeswr/");
  const parsed = await parseTurtle(legacy, "https://pod.example/app.ttl");
  const read = new TermWrapper("urn:app", parsed, factory);
  expect([
    ...SetFrom.subjectPredicate(read, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string),
  ]).toEqual([FEDAPP_APP]);
  expect([
    ...SetFrom.subjectPredicate(read, FEDAPP_SECTOR, NamedNodeAs.string, NamedNodeFrom.string),
  ]).toEqual([SECTOR_MEDIA]);
  expect(await serializeTurtle(parsed)).not.toContain("w3id.org/jeswr");
  // Even raw serializer input accepts legacy metadata without a preceding parse.
  const { parseRdf } = await import("@jeswr/fetch-rdf");
  const raw = await parseRdf(legacy, "text/turtle");
  expect(await serializeTurtle(new Store([...raw]))).not.toContain("w3id.org/jeswr");
});
