// AUTHORED-BY Codex GPT-6.1-Sol
import { createHash } from "node:crypto";
import { parseRdf } from "@jeswr/fetch-rdf";
import { SetFrom, TermAs, TermFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory as df, Store, Writer } from "n3";
import { describe, expect, it } from "vitest";
import {
  buildConnectionRecord,
  type ConnectionRecord,
  classifyConnection,
  connectionRecordUrl,
  MCP,
  parseConnectionRecord,
  revokeConnectionRecord,
  touchLastUsed,
} from "../src/index.js";

const ROOT = "https://pod.example/alice/";
const URL = `${ROOT}private/pkg/clients/${"a".repeat(32)}.ttl`;
const RESOURCE = "https://mcp.example/mcp";
const CLIENT = "https://assistant.example/app";
const data = (): ConnectionRecord => ({
  resource: RESOURCE,
  client: CLIENT,
  created: new Date("2026-11-01T10:00:00Z"),
  expiresAt: new Date("2026-12-01T10:00:00Z"),
  access: `${MCP}ReadOnly`,
  personalDataMode: `${MCP}OwnerPolicy`,
});
const parse = (text: string, url = URL) => parseConnectionRecord(text, "text/turtle", url);
async function edit(
  predicate: string,
  values: ReturnType<typeof df.literal | typeof df.namedNode>[],
  subject = URL,
) {
  const dataset = new Store([
    ...(await parseRdf(buildConnectionRecord(URL, data()), "text/turtle")),
  ]);
  const wrapper = new TermWrapper(subject, dataset, df);
  const terms = SetFrom.subjectPredicate(wrapper, predicate, TermAs.term, TermFrom.itself);
  terms.clear();
  for (const value of values) terms.add(value);
  return new Writer({ format: "text/turtle" }).quadsToString([...dataset]);
}
describe("generated denial records", () => {
  it("round trips every field and both enum families", async () => {
    const input = {
      ...data(),
      title: "App <&> “quoted”",
      scope: "mcp",
      redirectOrigin: "https://assistant.example/",
      purposes: ["https://w3id.org/dpv#Personalisation"],
      lastUsed: new Date("2026-11-02T00:00:00Z"),
      revokedAt: new Date("2026-11-03T10:00:00Z"),
    };
    expect(await parse(buildConnectionRecord(URL, input))).toEqual(input);
    expect(await parse(buildConnectionRecord(URL, { ...data(), scope: undefined }))).toEqual(
      data(),
    );
    expect(
      (
        await parse(
          buildConnectionRecord(URL, { ...data(), lastUsed: new Date("2026-11-02T12:30:00Z") }),
        )
      ).lastUsed?.toISOString(),
    ).toBe("2026-11-02T00:00:00.000Z");
    for (const personalDataMode of [`${MCP}Mandate`, `${MCP}NoPersonalData`] as const)
      expect(
        await parse(
          buildConnectionRecord(URL, { ...data(), access: `${MCP}ReadWrite`, personalDataMode }),
        ),
      ).toMatchObject({ personalDataMode });
  });
  it("mints deterministic locations from unambiguous trusted components", async () => {
    const hash = createHash("sha256")
      .update(`mcp-connection\0${RESOURCE}\0grant`)
      .digest("hex")
      .slice(0, 32);
    expect(await connectionRecordUrl(ROOT, RESOURCE, "grant")).toBe(
      `${ROOT}private/pkg/clients/${hash}.ttl`,
    );
    expect(await connectionRecordUrl(ROOT, `${RESOURCE}2`, "grant")).not.toBe(
      await connectionRecordUrl(ROOT, RESOURCE, "grant"),
    );
    expect(await connectionRecordUrl(ROOT, RESOURCE, "grant2")).not.toBe(
      await connectionRecordUrl(ROOT, RESOURCE, "grant"),
    );
    for (const id of ["", "a\0b"])
      await expect(connectionRecordUrl(ROOT, RESOURCE, id)).rejects.toThrow();
    await expect(
      connectionRecordUrl("https://pod.example/root", RESOURCE, "grant"),
    ).rejects.toThrow();
    for (const resource of [
      "relative",
      "javascript:alert(1)",
      "https://u:p@mcp.example/mcp",
      "https://mcp.example/<>",
    ])
      await expect(connectionRecordUrl(ROOT, resource, "grant")).rejects.toThrow();
  });
  it.each([
    ["resource", []],
    ["client", []],
    ["access", []],
    ["personalDataMode", []],
    ["expiresAt", []],
    ["resource", [df.literal(RESOURCE)]],
    ["access", [df.namedNode(`${MCP}Admin`)]],
    ["personalDataMode", [df.namedNode(`${MCP}Anything`)]],
    ["revokedAt", [df.literal("yesterday")]],
    ["lastUsed", [df.literal("2026-02-30", df.namedNode("http://www.w3.org/2001/XMLSchema#date"))]],
    ["scope", [df.literal("a"), df.literal("b")]],
    ["title", [df.literal("a"), df.literal("b")]],
    ["title", [df.literal("x".repeat(257))]],
    ["redirectOrigin", [df.namedNode("https://app.example/path")]],
  ])("refuses malformed or ambiguous %s", async (field, values) => {
    await expect(
      parse(await edit(field === "title" ? "http://purl.org/dc/terms/title" : MCP + field, values)),
    ).rejects.toThrow();
  });
  it("refuses invalid optional title/purpose/created terms, missing type, and wrong subjects", async () => {
    for (const [predicate, values] of [
      ["http://purl.org/dc/terms/title", [df.literal("x".repeat(257))]],
      ["http://purl.org/dc/terms/title", [df.literal("a"), df.literal("b")]],
      ["http://purl.org/dc/terms/title", [df.namedNode(CLIENT)]],
      ["http://purl.org/dc/terms/created", []],
      ["https://w3id.org/dpv#hasPurpose", [df.literal("purpose")]],
      ["http://www.w3.org/1999/02/22-rdf-syntax-ns#type", []],
    ] as const)
      await expect(parse(await edit(predicate, [...values]))).rejects.toThrow();
    await expect(parse(buildConnectionRecord(URL, data()), `${URL}other`)).rejects.toThrow();
    await expect(
      parse(await edit(`${MCP}scope`, [df.literal("wrong subject")], `${URL}#other`)),
    ).rejects.toThrow();
    await expect(parse("<broken")).rejects.toThrow();
    await expect(parse(" ".repeat(65537))).rejects.toThrow();
    await expect(
      parseConnectionRecord(
        '{"@context":"https://foreign.example/context"}',
        "application/ld+json",
        URL,
      ),
    ).rejects.toThrow();
  });
  it("preserves exact client/resource lexical identities when classifying a record", async () => {
    const client = "https://ASSISTANT.example:443/app";
    const record = await parse(await edit(`${MCP}client`, [df.namedNode(client)]));
    expect(record.client).toBe(client);
    expect(classifyConnection(200, record, { resource: RESOURCE, client: CLIENT })).toBe("revoked");
  });
  it("refuses invalid writes instead of silently dropping required or optional data", () => {
    for (const change of [
      { resource: "bad" },
      { client: "https://u:p@app.example/" },
      { title: "x".repeat(257) },
      { redirectOrigin: "https://app.example/path" },
      { lastUsed: new Date(NaN) },
      { scope: 4 },
      { purposes: ["bad"] },
      { scope: "x".repeat(65536) },
    ])
      expect(() =>
        buildConnectionRecord(URL, { ...data(), ...change } as ConnectionRecord),
      ).toThrow();
    expect(() => buildConnectionRecord("bad", data())).toThrow();
  });
  it("preserves unknown metadata, keeps earliest revocation, and touches a UTC day", async () => {
    const original = await edit("https://example.org/metadata", [df.literal("keep me")]);
    const early = new Date("2026-11-02T12:00:00Z");
    const late = new Date("2026-11-03T12:00:00Z");
    let revoked = await revokeConnectionRecord(original, "text/turtle", URL, late);
    revoked = await revokeConnectionRecord(revoked, "text/turtle", URL, early);
    expect(
      (await parse(await revokeConnectionRecord(revoked, "text/turtle", URL, late))).revokedAt,
    ).toEqual(early);
    expect(revoked).toContain("keep me");
    expect(
      (
        await parse(await touchLastUsed(original, "text/turtle", URL, late))
      ).lastUsed?.toISOString(),
    ).toBe("2026-11-03T00:00:00.000Z");
    await expect(
      revokeConnectionRecord(original, "text/turtle", URL, new Date(NaN)),
    ).rejects.toThrow();
    await expect(touchLastUsed(original, "text/turtle", URL, new Date(NaN))).rejects.toThrow();
  });
  it("snapshots mutation dates before asynchronous parsing", async () => {
    const original = buildConnectionRecord(URL, data());
    const at = new Date("2026-11-11T10:00:00Z");
    const revocation = revokeConnectionRecord(original, "text/turtle", URL, at);
    const touch = touchLastUsed(original, "text/turtle", URL, at);
    at.setTime(NaN);
    expect((await parse(await revocation)).revokedAt?.toISOString()).toBe(
      "2026-11-11T10:00:00.000Z",
    );
    expect((await parse(await touch)).lastUsed?.toISOString()).toBe("2026-11-11T00:00:00.000Z");
  });
  it.each([
    0, 201, 204, 206, 301, 302, 304, 307, 308, 400, 401, 403, 408, 412, 429, 500, 503,
  ])("classifies status %s as unavailable without trusting a body", (status) => {
    expect(classifyConnection(status, data(), { resource: RESOURCE, client: CLIENT })).toBe(
      "unavailable",
    );
  });
  it("classifies authoritative denial and exact matching live records", () => {
    const expected = { resource: RESOURCE, client: CLIENT };
    for (const status of [404, 410])
      expect(classifyConnection(status, data(), expected)).toBe("revoked");
    for (const record of [
      undefined,
      null,
      "bad",
      {},
      { resource: RESOURCE },
      new Error(),
      { ...data(), resource: `${RESOURCE}/` },
      { ...data(), client: `${CLIENT}/` },
      { ...data(), revokedAt: new Date() },
    ])
      expect(classifyConnection(200, record, expected)).toBe("revoked");
    expect(classifyConnection(200, data(), expected)).toBe("live");
    expect(classifyConnection(200, { ...data(), revokedAt: undefined }, expected)).toBe("live");
  });
});
