// AUTHORED-BY Codex GPT-6.1-Sol
import { parseRdf } from "@jeswr/fetch-rdf";
import { NS } from "@jeswr/suite-vocab";
import { DataFactory, Store, Writer } from "n3";
import { describe, expect, it } from "vitest";
import { Rule, Tracker } from "./issue";
import { odrl } from "./vocab";

const LEGACY = "https://w3id.org/jeswr/task#";
const DOC = "https://pod.example/tracker.ttl";
const TRACKER = `${DOC}#this`;

function serialize(dataset: Store): Promise<string> {
  const writer = new Writer({ format: "text/turtle" });
  for (const quad of dataset) writer.addQuad(quad);
  return new Promise((resolve, reject) => writer.end((error, body) => error ? reject(error) : resolve(body)));
}

describe("legacy task extensions", () => {
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
