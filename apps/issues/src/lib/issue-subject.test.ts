// AUTHORED-BY Claude Fable 5.2
import { DataFactory, Store } from "n3";
import { describe, expect, it } from "vitest";
import { issueSubject } from "./repository";

const { namedNode, blankNode, quad } = DataFactory;
const TYPE = namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
const TASK = namedNode("http://www.w3.org/2005/01/wf/flow#Task");
const DOC = "https://pod.example/issues/1.ttl";

describe("issueSubject", () => {
  it("skips a blank-node task and returns the first IRI-named one", () => {
    const store = new Store([
      quad(blankNode("b0"), TYPE, TASK),
      quad(namedNode(`${DOC}#this`), TYPE, TASK),
    ]);
    expect(issueSubject(store, DOC)).toBe(`${DOC}#this`);
  });

  it("falls back to the default fragment when only a blank-node task exists", () => {
    const store = new Store([quad(blankNode("b0"), TYPE, TASK)]);
    expect(issueSubject(store, DOC)).toBe(`${DOC}#it`);
  });
});
