// AUTHORED-BY Codex GPT-6.1-Sol
// Legacy history remains readable; request lifecycle parsing belongs to the SDK.
import { parseRdf } from "@jeswr/fetch-rdf";
import { ODRL } from "@jeswr/pod-access/requests-solid";
import { NS } from "@jeswr/suite-vocab";
import type { DatasetCore } from "@rdfjs/types";
import { NamedNodeAs, NamedNodeFrom, SetFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { describe, expect, it } from "vitest";
import { readGrantRecord } from "../../src/lib/history.js";
import { toTurtle } from "../../src/lib/rdf.js";
import { GrantHistory } from "../../src/lib/records.js";
import { createPodStub } from "../pod-stub.js";

const LEGACY = "https://w3id.org/jeswr/accm#";
const URL = "https://pod.example/grant.ttl";
async function legacyRecord() {
  const dataset = new Store();
  const record = new GrantHistory(URL, dataset, DataFactory);
  record.grantId = "digest";
  record.grantRef = "https://pod.example/grant.ttl";
  record.requestRef = "https://pod.example/inbox/request.ttl";
  record.agent = "https://app.example/#agent";
  record.modes.add(`${NS.ACL}Read`);
  record.modes.add(`${NS.ACL}Append`);
  record.resolvesTo.add("https://pod.example/data/");
  record.revokedAt = new Date("2026-10-01T00:00:00Z");
  const typed = new TermWrapper(URL, dataset, DataFactory);
  SetFrom.subjectPredicate(typed, `${NS.RDF}type`, NamedNodeAs.string, NamedNodeFrom.string).add(
    ODRL.Agreement,
  );
  const canonical = await toTurtle(dataset);
  expect(canonical).not.toContain("w3id.org/jeswr");
  return canonical.replaceAll(NS.ACCESS_MANAGER, LEGACY);
}

describe("legacy history reads and canonical writes", () => {
  it.each([
    false,
    true,
  ])("reads without mutating the caller's dataset (read-only: %s)", async (readOnly) => {
    const dataset = await parseRdf(await legacyRecord(), "text/turtle", { baseIRI: URL });
    const before = [...dataset];
    const source: DatasetCore = dataset;
    const input: DatasetCore = readOnly
      ? {
          size: dataset.size,
          has: (q) => dataset.has(q),
          match: (...args) => source.match(...args),
          [Symbol.iterator]: () => dataset[Symbol.iterator](),
          add() {
            throw new Error("read-only dataset");
          },
          delete() {
            throw new Error("read-only dataset");
          },
        }
      : dataset;
    const record = new GrantHistory(URL, input, DataFactory);
    expect([...record.modes]).toEqual([`${NS.ACL}Read`, `${NS.ACL}Append`]);
    expect(record.agent).toBe("https://app.example/#agent");
    expect(await toTurtle(input)).not.toContain("w3id.org/jeswr");
    expect(dataset.size).toBe(before.length);
    expect(before.every((q) => dataset.has(q))).toBe(true);
    if (!readOnly) {
      record.grantId = "replacement";
      expect(
        dataset.match(DataFactory.namedNode(URL), DataFactory.namedNode(`${LEGACY}grantId`)).size,
      ).toBe(0);
    }
  });

  it("projects legacy grants for the history view", async () => {
    const pod = createPodStub({ [URL]: await legacyRecord() });
    expect(await readGrantRecord(URL, pod.fetch)).toMatchObject({
      grantId: "digest",
      requestRef: "https://pod.example/inbox/request.ttl",
      modes: ["Read", "Append"],
      targets: ["https://pod.example/data/"],
      revokedAt: new Date("2026-10-01T00:00:00Z"),
    });
  });

  it("preserves resource identifiers and literal contents", async () => {
    const dataset = new Store();
    const record = new GrantHistory(`${LEGACY}resource`, dataset, DataFactory);
    record.grantId = `${LEGACY}literal`;
    record.grantRef = `${LEGACY}resource`;
    const read = new GrantHistory(
      `${LEGACY}resource`,
      await parseRdf(await toTurtle(dataset), "text/turtle"),
      DataFactory,
    );
    expect(read.grantId).toBe(`${LEGACY}literal`);
    expect(read.grantRef).toBe(`${LEGACY}resource`);
  });
});
