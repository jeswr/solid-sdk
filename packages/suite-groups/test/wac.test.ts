// AUTHORED-BY Codex GPT-6.1-Sol
import { parseRdf } from "@jeswr/fetch-rdf";
import { Store } from "n3";
import { expect, it } from "vitest";
import { peopleWac, preserveGroupWac } from "../src/wac.js";

it("projects people while retaining independent group selectors in replacement policies", async () => {
  const original = await parseRdf(
    `@prefix acl: <http://www.w3.org/ns/auth/acl#>.
    <#owner> a acl:Authorization; acl:agent <https://owner.example/#me>; acl:mode acl:Control.
    <#mixed> a acl:Authorization; acl:agent <https://bob.example/#me>; acl:agentClass <http://xmlns.com/foaf/0.1/Agent>; acl:agentGroup <https://pod.example/groups/team#this>; acl:mode acl:Read.
    <#group> a acl:Authorization; acl:agentGroup <https://pod.example/groups/family#this>; acl:mode acl:Read.`,
    "text/turtle",
    { baseIRI: "https://pod.example/.acl" },
  );
  const people = peopleWac(original);
  expect([...people].some((quad) => quad.predicate.value.endsWith("#agentGroup"))).toBe(false);
  expect([...people].some((quad) => quad.subject.value.endsWith("#group"))).toBe(false);
  expect([...people].some((quad) => quad.subject.value.endsWith("#mixed"))).toBe(true);
  const retained = preserveGroupWac(new Store(), original);
  expect([...retained].filter((quad) => quad.predicate.value.endsWith("#agentGroup"))).toHaveLength(
    2,
  );
  expect(
    [...retained].some(
      (quad) =>
        quad.predicate.value.endsWith("#agent") || quad.predicate.value.endsWith("#agentClass"),
    ),
  ).toBe(false);
  expect(() => preserveGroupWac(original, original)).toThrow("collision");
  expect(peopleWac(new Store()).size).toBe(0);
});

it("refuses malformed and named-graph WAC without hiding group selectors", async () => {
  const malformed = await parseRdf(
    '<#rule> a <http://www.w3.org/ns/auth/acl#Authorization>; <http://www.w3.org/ns/auth/acl#agentGroup> "not an IRI".',
    "text/turtle",
    { baseIRI: "https://pod.example/.acl" },
  );
  expect(() => peopleWac(malformed)).toThrow();
  const graph = await parseRdf(
    '{ "@id": "https://pod.example/graph", "@graph": [{ "@id": "https://pod.example/.acl#rule", "@type": "http://www.w3.org/ns/auth/acl#Authorization" }] }',
    "application/ld+json",
    { baseIRI: "https://pod.example/.acl" },
  );
  expect(() => peopleWac(graph)).toThrow("Named graph");
});

it("reads unique symbolic group recipients while keeping people separate", async () => {
  const { wacGroupIds } = await import("../src/wac.js");
  const resource = "https://pod.example/file.txt";
  const dataset = await parseRdf(
    `@prefix acl: <http://www.w3.org/ns/auth/acl#>.
    <#rule> a acl:Authorization; acl:accessTo <https://pod.example/file.txt>; acl:agent <https://alice.example/#me>; acl:agentGroup <https://pod.example/groups/team#this>; acl:mode acl:Read.
    <#second> a acl:Authorization; acl:accessTo <https://pod.example/file.txt>; acl:agentGroup <https://pod.example/groups/team#this>; acl:mode acl:Write.`,
    "text/turtle",
    { baseIRI: `${resource}.acl` },
  );
  expect(wacGroupIds(dataset, resource, `${resource}.acl`)).toEqual([
    "https://pod.example/groups/team#this",
  ]);
  expect(wacGroupIds(dataset, "https://pod.example/other.txt", `${resource}.acl`)).toEqual([]);
});

it("does not re-interpret legacy person-only ACLs to discover absent groups", async () => {
  const { wacGroupIds } = await import("../src/wac.js");
  const dataset = await parseRdf(
    "@prefix acl: <http://www.w3.org/ns/auth/acl#>. <#legacy> a acl:Authorization; acl:defaultForNew <https://pod.example/>; acl:agent <https://alice.example/#me>; acl:mode acl:Read.",
    "text/turtle",
    { baseIRI: "https://pod.example/.acl" },
  );
  expect(wacGroupIds(dataset, "https://pod.example/", "https://pod.example/.acl")).toEqual([]);
});
