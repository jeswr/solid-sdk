// AUTHORED-BY Codex GPT-6.1-Sol
import { SetFrom, TermAs, TermFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory as df, Store, Writer } from "n3";
import { describe, expect, it, vi } from "vitest";
import {
  type AuditRead,
  auditChainContainer,
  auditContainer,
  connectionsContainer,
  MCP,
  monthlyAuditSource,
} from "../src/index.js";

const storage = "https://pod.example/alice/";
const container = auditContainer(storage);
const PROV = "http://www.w3.org/ns/prov#";
const DPV = "https://w3id.org/dpv#";
const TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const ERROR = "Personal data reads unavailable";
class Node extends TermWrapper {
  values(predicate: string) {
    return SetFrom.subjectPredicate(this, predicate, TermAs.term, TermFrom.itself);
  }
  iri(predicate: string, value: string) {
    this.values(predicate).add(df.namedNode(value));
    return this;
  }
  text(predicate: string, value: string) {
    this.values(predicate).add(df.literal(value));
    return this;
  }
}
function document(build: (node: (id: string) => Node) => void) {
  const store = new Store();
  build((id) => new Node(id, store, df));
  return new Writer({ format: "text/turtle" }).quadsToString([...store]);
}
function activity(
  node: (id: string) => Node,
  id = "urn:read",
  at = "2026-11-01T12:00:00Z",
  client = "https://client.example/id",
) {
  return node(id)
    .iri(TYPE, `${PROV}Activity`)
    .text(`${PROV}startedAtTime`, at)
    .iri(`${PROV}wasAssociatedWith`, client);
}
function reader(
  files: Record<string, string>,
  members = Object.keys(files),
): AuditRead & ReturnType<typeof vi.fn> {
  const listing = document((node) => {
    for (const name of members)
      node(container).iri("http://www.w3.org/ns/ldp#contains", new URL(name, container).href);
  });
  return vi.fn(async (url: string) => {
    const text = url === container ? listing : files[url.slice(container.length)];
    if (text === undefined) throw { status: 404 };
    return { text, contentType: "text/turtle" };
  });
}

describe("layout", () => {
  it.each([
    "https://pod.example/",
    storage,
    "http://localhost:3000/pod/",
  ])("keeps all locations below %s", (root) => {
    expect(connectionsContainer(root)).toBe(`${root}private/pkg/clients/`);
    expect(auditContainer(root)).toBe(`${root}private/pkg/audit/`);
    expect(auditChainContainer(root)).toBe(`${root}private/pkg/audit-chain/`);
    expect(MCP).toBe("https://jeswr.org/ns/mcp#");
  });
  it.each([
    "",
    "/relative/",
    "https://pod.example",
    "https://pod.example/a",
    "file:///a/",
    "ftp://pod.example/",
    "https://u:p@pod.example/",
    "https://pod.example/?x/",
    "https://pod.example/#x/",
    "https://pod.example/a/../",
    " https://pod.example/",
    "https://POD.example/",
  ])("rejects %s with fixed text", (root) => {
    for (const layout of [connectionsContainer, auditContainer, auditChainContainer])
      expect(() => layout(root)).toThrow("Invalid storage container");
  });
});

describe("monthly audit projection", () => {
  it("projects only metadata, counts resource URLs and ignores injected literal values", async () => {
    const text = document((node) => {
      activity(node)
        .iri(`${DPV}hasPurpose`, `${DPV}ServiceProvision`)
        .iri(`${DPV}hasPersonalData`, "https://w3id.org/dpv/pd#Health")
        .text(`${MCP}tool`, "health_query")
        .text(`${MCP}decision`, "permit")
        .iri(`${PROV}used`, "https://pod.example/secret-resource")
        .text("https://example.org/value", "value")
        .text(`${DPV}hasPersonalData`, "private literal category");
    });
    const rows = await monthlyAuditSource.list(reader({ "2026-11.ttl": text }), storage, 100);
    expect(rows).toEqual([
      {
        at: "2026-11-01T12:00:00.000Z",
        client: "https://client.example/id",
        purpose: `${DPV}ServiceProvision`,
        categories: ["https://w3id.org/dpv/pd#Health"],
        tool: "health_query",
        decision: "permit",
        resourceCount: 1,
        source: "monthly",
      },
    ]);
    expect(JSON.stringify(rows)).not.toMatch(/value|secret-resource|private literal/);
  });
  it("reads only the newest three direct monthly names and sorts rows by timestamp before limiting", async () => {
    const files = Object.fromEntries(
      ["2026-08", "2026-09", "2026-10", "2026-11"].map((month, index) => [
        `${month}.ttl`,
        document((node) => activity(node, `urn:${month}`, `2026-11-0${4 - index}T12:00:00Z`)),
      ]),
    );
    const read = reader(files, [
      ...Object.keys(files),
      "2026-12.ttl?secret",
      "2026-12.ttl#secret",
      "nested/2026-12.ttl",
      "2026-12.ttl/",
      "2026-1.ttl",
      "notes.ttl",
      "../2027-01.ttl",
      "https://foreign.example/2027-01.ttl",
    ]);
    const rows = await monthlyAuditSource.list(read, storage, 2);
    expect(rows.map((row) => row.at)).toEqual([
      "2026-11-03T12:00:00.000Z",
      "2026-11-02T12:00:00.000Z",
    ]);
    expect(read.mock.calls.map(([url]) => url)).toEqual([
      container,
      ...["2026-11", "2026-10", "2026-09"].map((month) => `${container}${month}.ttl`),
    ]);
    expect(await monthlyAuditSource.list(reader(files), storage, 0)).toEqual([]);
  });
  it.each([404, 410])("only a missing container (%s) is empty", async (status) => {
    expect(
      await monthlyAuditSource.list(
        async () => {
          throw { status };
        },
        storage,
        100,
      ),
    ).toEqual([]);
  });
  it("returns empty for a listing with no monthly members", async () => {
    expect(await monthlyAuditSource.list(reader({}), storage, 100)).toEqual([]);
  });
  it.each([
    "prohibited",
    "refuse-all",
    "invalid",
    "",
  ])("whitelists decision %s", async (decision) => {
    const text = document((node) => {
      activity(node).text(`${MCP}decision`, decision);
    });
    const rows = await monthlyAuditSource.list(reader({ "2026-11.ttl": text }), storage, 100);
    expect(rows[0]?.decision).toBe(
      decision === "prohibited" || decision === "refuse-all" ? decision : undefined,
    );
    expect(rows[0]?.categories).toEqual([]);
    expect(rows[0]?.purpose).toBeUndefined();
  });
  it.each([
    "not-a-date",
    "",
    "2026-02-30T12:00:00Z",
    "2026-13-01T12:00:00Z",
    "2026-01-01",
    "2026-01-01T12:00:00",
    "2026-01-01T33:00:00Z",
    "2026-01-01T24:00:00Z",
    "2026-01-01T12:60:00Z",
    "2026-01-01T12:00:00+25:00",
  ])("drops bad date %s", async (at) => {
    const text = document((node) => {
      activity(node, "urn:bad", at);
      activity(node, "urn:good");
    });
    expect(
      await monthlyAuditSource.list(reader({ "2026-11.ttl": text }), storage, 100),
    ).toHaveLength(1);
  });
  it.each([
    "mailto:person@example.org",
    "javascript:alert(1)",
    "urn:client",
    "https://u:p@client.example/id",
    "http://[broken",
  ])("drops unsafe client %s", async (client) => {
    const text = document((node) => {
      activity(node, "urn:bad", undefined, client);
    });
    expect(await monthlyAuditSource.list(reader({ "2026-11.ttl": text }), storage, 100)).toEqual(
      [],
    );
  });
  it("drops missing/ambiguous/wrong-term fields while retaining valid rows", async () => {
    const text = document((node) => {
      activity(node, "urn:ambiguous-date").text(`${PROV}startedAtTime`, "2026-11-02T00:00:00Z");
      activity(node, "urn:ambiguous-client").iri(
        `${PROV}wasAssociatedWith`,
        "http://other.example/",
      );
      node("urn:missing").iri(TYPE, `${PROV}Activity`);
      node("urn:bad-date-kind")
        .iri(TYPE, `${PROV}Activity`)
        .iri(`${PROV}startedAtTime`, "urn:date");
      node("urn:bad-client-kind")
        .iri(TYPE, `${PROV}Activity`)
        .text(`${PROV}startedAtTime`, "2026-11-01T00:00:00Z")
        .text(`${PROV}wasAssociatedWith`, "https://client.example/");
      activity(node, "urn:good", "2026-11-01T13:00:00+01:00", "http://client.example/")
        .iri(`${DPV}hasPurpose`, "urn:first")
        .iri(`${DPV}hasPurpose`, "urn:second");
    });
    const rows = await monthlyAuditSource.list(reader({ "2026-11.ttl": text }), storage, 100);
    expect(rows).toEqual([
      {
        at: "2026-11-01T12:00:00.000Z",
        client: "http://client.example/",
        categories: [],
        source: "monthly",
      },
    ]);
  });
  it("bounds aggregate activity count including invalid activities", async () => {
    const text = document((node) => {
      for (let i = 0; i < 500; i++) activity(node, `urn:${i}`);
    });
    expect(
      await monthlyAuditSource.list(reader({ "2026-11.ttl": text }), storage, 500),
    ).toHaveLength(500);
    const extra = document((node) => {
      node("urn:invalid").iri(TYPE, `${PROV}Activity`);
    });
    await expect(
      monthlyAuditSource.list(reader({ "2026-11.ttl": text, "2026-10.ttl": extra }), storage, 100),
    ).rejects.toThrow(ERROR);
  });
  it.each([
    -1,
    501,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])("rejects limit %s before reading", async (limit) => {
    const read = reader({});
    await expect(monthlyAuditSource.list(read, storage, limit)).rejects.toThrow(ERROR);
    expect(read).not.toHaveBeenCalled();
  });
  it("rejects invalid storage with fixed text", async () => {
    await expect(monthlyAuditSource.list(reader({}), "file:///", 1)).rejects.toThrow(ERROR);
  });
  it.each([
    401, 403, 302, 500, 404, 410,
  ])("a file HTTP %s fails the entire view", async (status) => {
    const read = reader({}, ["2026-11.ttl"]);
    const failing: AuditRead = (url) =>
      url === container ? read(url) : Promise.reject({ status, message: "private value" });
    await expect(monthlyAuditSource.list(failing, storage, 100)).rejects.toEqual(new Error(ERROR));
  });
  it.each([
    new Error("backend secret"),
    { status: 401 },
    { status: 500 },
  ])("sanitizes listing failure %j", async (error) => {
    await expect(
      monthlyAuditSource.list(
        async () => {
          throw error;
        },
        storage,
        100,
      ),
    ).rejects.toEqual(new Error(ERROR));
  });
  it.each([
    "not valid RDF",
    `#${"é".repeat(131072)}`,
  ])("rejects bad/oversized file", async (text) => {
    await expect(
      monthlyAuditSource.list(reader({ "2026-11.ttl": text }), storage, 100),
    ).rejects.toThrow(ERROR);
  });
  it("accepts the exact byte boundary and refuses remote JSON-LD contexts", async () => {
    const text = "#".padEnd(256 * 1024, "x");
    expect(await monthlyAuditSource.list(reader({ "2026-11.ttl": text }), storage, 100)).toEqual(
      [],
    );
    const read = reader({}, ["2026-11.ttl"]);
    await expect(
      monthlyAuditSource.list(
        (url) =>
          url === container
            ? read(url)
            : Promise.resolve({
                text: '{"@context":"https://foreign.example/context"}',
                contentType: "application/ld+json",
              }),
        storage,
        100,
      ),
    ).rejects.toThrow(ERROR);
    const unsupported = (url: string) =>
      url === container ? read(url) : Promise.resolve({ text: "", contentType: "text/html" });
    await expect(monthlyAuditSource.list(unsupported, storage, 100)).rejects.toThrow(ERROR);
  });
  it("caps listing bytes as well", async () => {
    await expect(
      monthlyAuditSource.list(
        async () => ({ text: "#".padEnd(256 * 1024 + 1, "x"), contentType: "text/turtle" }),
        storage,
        100,
      ),
    ).rejects.toThrow(ERROR);
  });
});
