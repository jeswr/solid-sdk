// AUTHORED-BY Codex GPT-6
import { parseRdf } from "@jeswr/fetch-rdf";
import { BlankNodeFrom, NamedNodeAs, NamedNodeFrom, SetFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { expect, it } from "vitest";
import { isomorphic } from "../../src/engine/isomorphism.js";

const graph = (body: string) => parseRdf(body, "application/trig");
it("compares graph structure, literal terms and a bijection rather than blank-node labels", async () => {
  const first = await graph("_:a <urn:p> _:b. _:b <urn:p> _:a.");
  const renamed = await graph("_:y <urn:p> _:z. _:z <urn:p> _:y.");
  expect(isomorphic(first, renamed)).toBe(true);
  expect(isomorphic(first, first)).toBe(true);
  expect(isomorphic(first, new Store())).toBe(false);
  expect(isomorphic(first, await graph("_:y <urn:p> _:y. _:z <urn:p> _:z."))).toBe(false);
  expect(
    isomorphic(await graph("_:a <urn:p> <urn:o>."), await graph("<urn:s> <urn:p> <urn:o>.")),
  ).toBe(false);
  expect(
    isomorphic(await graph('<urn:s> <urn:p> "é"@en.'), await graph('<urn:s> <urn:p> "é"@fr.')),
  ).toBe(false);
  expect(isomorphic(await graph('<urn:s> <urn:p> "1".'), await graph("<urn:s> <urn:p> 1."))).toBe(
    false,
  );
  expect(
    isomorphic(await graph("_:g { _:a <urn:p> _:a. }"), await graph("_:h { _:b <urn:p> _:b. }")),
  ).toBe(true);
});

function cycle(size: number, split: number, prefix: string) {
  const store = new Store();
  for (let i = 0; i < size; i++) {
    const node = new TermWrapper(DataFactory.blankNode(`${prefix}${i}`), store, DataFactory);
    SetFrom.subjectPredicate(node, "urn:edge", (term) => term.value, BlankNodeFrom.string).add(
      `${prefix}${Math.floor(i / split) * split + ((i + 1) % split)}`,
    );
  }
  return store;
}
it("bounds symmetric non-isomorphic graphs rather than exhausting permutations", () => {
  expect(() => isomorphic(cycle(32, 32, "a"), cycle(32, 16, "b"))).toThrow("work limit");
});
it("bounds the blank-node mapping depth", () => {
  const left = cycle(65, 65, "a");
  const right = cycle(65, 65, "b");
  expect(() => isomorphic(left, right)).toThrow("blank-node limit");
});
it("refuses unestablished quoted-triple isomorphism", async () => {
  const left = await graph("<< <urn:s> <urn:p> <urn:o> >> <urn:p> <urn:a>.");
  const right = await graph("<< <urn:s> <urn:p> <urn:o> >> <urn:p> <urn:b>.");
  expect(() => isomorphic(left, right)).toThrow("quoted triples");
});
it("can backtrack after an initially compatible blank-node mapping", () => {
  const left = cycle(4, 4, "a");
  const right = cycle(4, 4, "b");
  // A ground attachment breaks rotational symmetry. The first candidate is wrong.
  const a = new TermWrapper(DataFactory.blankNode("a0"), left, DataFactory);
  const b = new TermWrapper(DataFactory.blankNode("b2"), right, DataFactory);
  for (const term of [a, b])
    SetFrom.subjectPredicate(term, "urn:anchor", NamedNodeAs.string, NamedNodeFrom.string).add(
      "urn:fixed",
    );
  expect(isomorphic(left, right)).toBe(true);
});
