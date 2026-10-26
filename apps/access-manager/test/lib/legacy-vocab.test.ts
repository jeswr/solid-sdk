// AUTHORED-BY Codex GPT-6.1-Sol
import { parseRdf } from "@jeswr/fetch-rdf";
import { NS } from "@jeswr/suite-vocab";
import { NamedNodeAs, NamedNodeFrom, SetFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { describe, expect, it } from "vitest";
import { resolveTargets } from "../../src/lib/approval.js";
import { readGrantRecord } from "../../src/lib/history.js";
import { readAccessRequest } from "../../src/lib/inbox.js";
import { toTurtle } from "../../src/lib/rdf.js";
import { AccmRecord, statusFromIri } from "../../src/lib/records.js";
import { ACCM } from "../../src/lib/vocab.js";
import { createPodStub } from "../pod-stub.js";

const LEGACY = "https://w3id.org/jeswr/accm#";
const URL = "https://pod.example/request.ttl";

async function legacyRecord(status: "Pending" | "Approving" | "Approved" | "Denied") {
  const dataset = new Store();
  const record = new AccmRecord(URL, dataset, DataFactory);
  record.status = status;
  record.grantId = "digest";
  record.grantRef = "https://pod.example/grant.ttl";
  record.requestRef = URL;
  record.snapshotAgent = "https://app.example/#agent";
  record.snapshotModes.add(`${NS.ACL}Read`);
  record.snapshotModes.add(`${NS.ACL}Append`);
  record.resolvesTo.add("https://pod.example/data/");
  record.schemaVersion = "1";
  record.dataClass = ACCM.DataClass;
  record.revokedAt = new Date("2026-10-01T00:00:00Z");
  const label = new TermWrapper("urn:class", dataset, DataFactory);
  SetFrom.subjectPredicate(label, `${NS.RDF}type`, NamedNodeAs.string, NamedNodeFrom.string).add(
    ACCM.DataClass,
  );
  const canonical = await toTurtle(dataset);
  expect(canonical).not.toContain("w3id.org/jeswr");
  return canonical.replaceAll(NS.ACCESS_MANAGER, LEGACY);
}

describe("legacy accm reads and canonical writes", () => {
  it.each([
    "Pending",
    "Approving",
    "Approved",
    "Denied",
  ] as const)("reads %s, grant references and the full snapshot through the pod data layer", async (status) => {
    const pod = createPodStub({ [URL]: await legacyRecord(status) });
    const request = await readAccessRequest(URL, pod.fetch);
    expect(request?.status).toBe(status);
    expect(request?.snapshot).toEqual({
      grantId: "digest",
      agent: "https://app.example/#agent",
      modes: ["Read", "Append"],
      targets: ["https://pod.example/data/"],
      schemaVersion: "1",
    });
    expect(request?.dataClass).toBe(ACCM.DataClass);
    if (!request) throw new Error("missing legacy request");
    expect(
      resolveTargets(
        request,
        [
          {
            id: "urn:registration",
            forClass: `${LEGACY}DataClass`,
            instanceContainers: ["https://pod.example/data/"],
            instances: [],
            visibility: "private",
            label: "Legacy data class",
          },
        ],
        ["https://pod.example/data/record.ttl"],
        "https://pod.example/",
      ),
    ).toEqual(["https://pod.example/data/record.ttl"]);
    const grant = await readGrantRecord(URL, pod.fetch);
    expect(grant).toMatchObject({ grantId: "digest", requestRef: URL, modes: ["Read", "Append"] });
    expect(grant?.revokedAt).toEqual(new Date("2026-10-01T00:00:00Z"));
    const dataset = await parseRdf(await legacyRecord(status), "text/turtle", { baseIRI: URL });
    const record = new AccmRecord(URL, dataset, DataFactory);
    expect(record.grantRef).toBe("https://pod.example/grant.ttl");
    expect(statusFromIri(`${LEGACY}${status}`)).toBe(status);
    expect([...dataset.match(null, DataFactory.namedNode(`${NS.RDF}type`))][0]?.object.value).toBe(
      ACCM.DataClass,
    );
    record.status = "Denied";
    record.snapshotModes.clear();
    record.snapshotModes.add(`${NS.ACL}Write`);
    const output = await toTurtle(dataset);
    expect(output).not.toContain("w3id.org/jeswr");
    const reread = new AccmRecord(URL, await parseRdf(output, "text/turtle"), DataFactory);
    expect(reread.status).toBe("Denied");
    expect([...reread.snapshotModes]).toEqual([`${NS.ACL}Write`]);
  });

  it("preserves resource identifiers and literal contents", async () => {
    const dataset = new Store();
    const record = new AccmRecord(`${LEGACY}resource`, dataset, DataFactory);
    record.grantId = `${LEGACY}literal`;
    record.grantRef = `${LEGACY}resource`;
    record.statusIri = `${LEGACY}Approved`;
    const output = await toTurtle(dataset);
    const read = new AccmRecord(
      `${LEGACY}resource`,
      await parseRdf(output, "text/turtle"),
      DataFactory,
    );
    expect(read.grantId).toBe(`${LEGACY}literal`);
    expect(read.grantRef).toBe(`${LEGACY}resource`);
    expect(read.statusIri).toBe(ACCM.Approved);
  });
});
