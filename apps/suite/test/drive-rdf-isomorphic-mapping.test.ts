// AUTHORED-BY Claude Opus 5.5
import { parseRdf } from "@jeswr/fetch-rdf";
import { beforeEach, expect, it, vi } from "vitest";

const proposed = vi.hoisted(() => ({ bijection: null as Record<string, string> | null }));
vi.mock("rdf-isomorphic", () => ({ getBijection: () => proposed.bijection }));

const { isomorphicGraph } = await import("../src/apps/drive/lib/client/rdf");

const graph = (turtle: string) => parseRdf(turtle, "text/turtle");
const PREFIX = "@prefix ex: <https://example.org/>. ";

beforeEach(() => {
  proposed.bijection = null;
});

it("rejects a graph pair when no mapping is proposed", async () => {
  const a = await graph(`${PREFIX}ex:s ex:p ex:o.`);
  expect(isomorphicGraph(a, await graph(`${PREFIX}ex:s ex:p ex:other.`))).toBe(false);
  expect(isomorphicGraph(a, await graph(`${PREFIX}ex:s ex:p ex:o, ex:other.`))).toBe(false);
});

it("rejects a proposed mapping that is not injective", async () => {
  // Mapping both nodes onto one would cover the other graph without being an isomorphism.
  const a = await graph(`${PREFIX}_:a ex:p ex:x. _:b ex:q ex:y.`);
  const b = await graph(`${PREFIX}_:c ex:p ex:x; ex:q ex:y.`);
  const [label] = [...b].map((quad) => `_:${quad.subject.value}`);
  const [first, second] = [...new Set([...a].map((quad) => `_:${quad.subject.value}`))];
  proposed.bijection = { [String(first)]: String(label), [String(second)]: String(label) };
  expect(isomorphicGraph(a, b)).toBe(false);
});

it("rejects a proposed mapping that misses a blank node or targets a non-blank label", async () => {
  const a = await graph(`${PREFIX}_:a ex:p ex:x.`);
  const b = await graph(`${PREFIX}_:c ex:p ex:x.`);
  proposed.bijection = {};
  expect(isomorphicGraph(a, b)).toBe(false);
  const [quad] = [...a];
  proposed.bijection = { [`_:${quad?.subject.value}`]: "https://example.org/x" };
  expect(isomorphicGraph(a, b)).toBe(false);
});

it("fails closed on quoted triples", async () => {
  const a = await graph(`${PREFIX}<< ex:s ex:p ex:o >> ex:q ex:r.`);
  proposed.bijection = {};
  expect(isomorphicGraph(a, a)).toBe(false);
});
