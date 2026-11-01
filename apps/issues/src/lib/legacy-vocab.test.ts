// AUTHORED-BY Codex GPT-6.1-Sol
import { parseRdf } from "@jeswr/fetch-rdf";
import { NS } from "@jeswr/suite-vocab";
import type { DatasetCore } from "@rdfjs/types";
import { canonicalizeTaskDataset } from "./canonical-vocab";
import { Repository } from "./repository";
import { fakePod } from "./testing/fake-pod";
import { DataFactory, Store, Writer } from "n3";
import { describe, expect, it } from "vitest";
import { Rule, Tracker } from "./issue";
import { odrl } from "./vocab";

const LEGACY = "https://w3id.org/jeswr/task#";
const DOC = "https://pod.example/tracker.ttl";
const TRACKER = `${DOC}#this`;

function serialize(dataset: Store): Promise<string> {
  const writer = new Writer({ format: "text/turtle" });
  for (const quad of canonicalizeTaskDataset(dataset, DataFactory)) writer.addQuad(quad);
  return new Promise((resolve, reject) => writer.end((error, body) => error ? reject(error) : resolve(body)));
}

describe("legacy task extensions", () => {
  it.each([false, true])("reads without changing sibling subjects or graphs (read-only: %s)", async (readOnly) => {
    const ruleIri = `${DOC}#rule-legacy`;
    const dataset = await parseRdf(`
      <${TRACKER}> <${LEGACY}rule> <${ruleIri}> .
      <${DOC}#status-in-progress> a <${NS.WF}State> ; <${LEGACY}wipMax> 3 .
      <${ruleIri}> a <${LEGACY}Rule> ; <${LEGACY}enabled> false ; <${LEGACY}trigger> <${LEGACY}OnStatusChange> ; <${LEGACY}action> <${LEGACY}SetPriority> .
      <urn:other> <${LEGACY}enabled> true .
      <urn:g> { <urn:named> <${LEGACY}action> <${LEGACY}SetPriority> . }
    `, "application/trig");
    const before = [...dataset];
    const source: DatasetCore = dataset;
    const input: DatasetCore = readOnly ? {
      size: dataset.size,
      has: (q) => dataset.has(q),
      match: (...args) => source.match(...args),
      [Symbol.iterator]: () => dataset[Symbol.iterator](),
      add() { throw new Error("read-only dataset"); },
      delete() { throw new Error("read-only dataset"); },
    } : dataset;
    const tracker = new Tracker(TRACKER, input, DataFactory);
    expect(tracker.wipLimits).toEqual({ "in-progress": { max: 3 } });
    expect(tracker.rules).toMatchObject([{ enabled: false, trigger: "OnStatusChange", action: "SetPriority" }]);
    const rule = new Rule(ruleIri, input, DataFactory);
    expect(rule.enabled).toBe(false);
    expect(dataset.size).toBe(before.length);
    expect(before.every((q) => dataset.has(q))).toBe(true);
    const copy = canonicalizeTaskDataset(input, DataFactory);
    expect(copy).not.toBe(input);
    expect([...copy].every((q) => !q.predicate.value.startsWith(LEGACY) && !q.object.value.startsWith(LEGACY))).toBe(true);
    expect(dataset.size).toBe(before.length);
    expect(before.every((q) => dataset.has(q))).toBe(true);
    if (!readOnly) {
      rule.enabled = true;
      tracker.setWipLimit("in-progress", { max: 4 });
      expect(dataset.match(DataFactory.namedNode(ruleIri), DataFactory.namedNode(`${LEGACY}enabled`)).size).toBe(0);
      expect(dataset.match(DataFactory.namedNode(`${DOC}#status-in-progress`), DataFactory.namedNode(`${LEGACY}wipMax`)).size).toBe(0);
      expect(before.filter((q) => q.subject.value.startsWith("urn:")).every((q) => dataset.has(q))).toBe(true);
    }
  });

  it("the repository serializes legacy tracker extensions canonically", async () => {
    const { impl, store } = fakePod();
    const repo = new Repository(DOC, impl);
    await repo.ensureTracker();
    await repo.setWipLimit("in-progress", { max: 3 });
    store.set(DOC, store.get(DOC)!.replaceAll(NS.TASK, LEGACY));
    await repo.setWipLimit("in-progress", { max: 4 });
    expect(store.get(DOC)).not.toContain("w3id.org/jeswr");
  });

  it.each([NS.TASK, LEGACY])("reads WIP bounds and automation rules from %s and saves canonical terms", async (namespace) => {
    const dataset = new Store();
    const tracker = new Tracker(TRACKER, dataset, DataFactory);
    tracker.configure("Demo");
    tracker.setWipLimit("in-progress", { min: 1, max: 3 });
    const rule = tracker.defineRule({
      enabled: false,
      trigger: "OnStatusChange",
      action: "SetPriority",
      actionValue: "high",
      condition: { leftOperand: odrl("purpose"), operator: odrl("eq"), rightOperand: "medium" },
    });
    const written = await serialize(dataset);
    expect(written).not.toContain("w3id.org/jeswr");
    const incoming = await parseRdf(written.replaceAll(NS.TASK, namespace), "text/turtle", { baseIRI: DOC });
    // A rule may also be wrapped independently of its tracker.
    const standalone = await parseRdf(written.replaceAll(NS.TASK, namespace), "text/turtle", { baseIRI: DOC });
    expect(new Rule(rule.iri, standalone, DataFactory).toDef()).toEqual(rule);
    const read = new Tracker(TRACKER, incoming, DataFactory);
    expect(read.wipLimits).toEqual({ "in-progress": { min: 1, max: 3 } });
    expect(read.rules).toEqual([rule]);
    read.setWipLimit("in-progress", { max: 4 });
    read.defineRule({ ...rule, enabled: true });
    const output = await serialize(new Store([...incoming]));
    expect(output).not.toContain("w3id.org/jeswr");
    const reread = new Tracker(TRACKER, await parseRdf(output, "text/turtle"), DataFactory);
    expect(reread.wipLimits).toEqual({ "in-progress": { max: 4 } });
    expect(reread.rules).toEqual([{ ...rule, enabled: true }]);
    reread.removeRule(rule.iri);
    expect(reread.rules).toEqual([]);
  });
});
