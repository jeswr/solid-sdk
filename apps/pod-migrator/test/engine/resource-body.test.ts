// AUTHORED-BY Codex GPT-6
import { LiteralFrom, SetFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { describe, expect, it } from "vitest";
import { executeMigration, finalizePlan, planMigration } from "../../src/engine/index.js";
import { serialize } from "../../src/engine/rdf.js";
import { readResourceBytes } from "../../src/engine/resource-body.js";
import { pods, resolve } from "./helpers.js";

const url = "https://source.example/pod/file";
async function unicodeTurtle(): Promise<string> {
  const store = new Store();
  const node = new TermWrapper("urn:note", store, DataFactory);
  SetFrom.subjectPredicate(node, "urn:text", (term) => term.value, LiteralFrom.string).add(
    "café 漢字 🌱",
  );
  return serialize(store);
}

describe("resource body integrity before copying", () => {
  it("preserves exact non-ASCII RDF bytes without rewriting", async () => {
    const bytes = new TextEncoder().encode(await unicodeTurtle());
    expect(
      await readResourceBytes(
        new Response(bytes, {
          headers: {
            "content-type": "Text/Turtle; charset=utf-8",
            "content-length": `${bytes.length}`,
          },
        }),
        url,
      ),
    ).toEqual(bytes);
  });

  it("preserves binary bodies without a media type or length and empty identity bodies", async () => {
    const bytes = new Uint8Array([0, 255, 13, 10]);
    expect(await readResourceBytes(new Response(bytes), url)).toEqual(bytes);
    expect(
      await readResourceBytes(
        new Response(null, { headers: { "content-length": "0", "content-encoding": "IDENTITY" } }),
        url,
      ),
    ).toEqual(new Uint8Array());
  });

  it("does not compare decoded bytes with an encoded Content-Length", async () => {
    expect(
      await readResourceBytes(
        new Response("decompressed", {
          headers: { "content-length": "2", "content-encoding": "gzip" },
        }),
        url,
      ),
    ).toEqual(new TextEncoder().encode("decompressed"));
  });

  it.each(["garbage", "-1", "9007199254740992"])("refuses invalid length %s", async (length) => {
    await expect(
      readResourceBytes(new Response("abc", { headers: { "content-length": length } }), url),
    ).rejects.toThrow(`Invalid Content-Length at ${url}`);
  });

  it.each(["2", "4"])("refuses received bytes inconsistent with length %s", async (length) => {
    await expect(
      readResourceBytes(new Response("abc", { headers: { "content-length": length } }), url),
    ).rejects.toThrow(`Content-Length is ${length} bytes, received 3`);
  });

  it("reports stream failures with their cause", async () => {
    const cause = new Error("connection terminated");
    const body = new ReadableStream<Uint8Array>({ start: (controller) => controller.error(cause) });
    await expect(readResourceBytes(new Response(body), url)).rejects.toMatchObject({
      message: `Incomplete resource body at ${url}: response stream failed`,
      cause,
    });
  });

  it.each([
    { type: "text/turtle", bytes: new TextEncoder().encode('<urn:s> <urn:p> "unfinished') },
    { type: "application/ld+json", bytes: new TextEncoder().encode('{"@id":"urn:s"') },
    { type: "text/turtle", bytes: new Uint8Array([35, 32, 0xc3]) },
  ])("refuses invalid or truncated $type even when Content-Length matches", async ({
    type,
    bytes,
  }) => {
    await expect(
      readResourceBytes(
        new Response(bytes, {
          headers: { "content-type": type, "content-length": String(bytes.byteLength) },
        }),
        url,
      ),
    ).rejects.toThrow(`Invalid or truncated RDF body at ${url}; refusing to copy`);
  });

  it.each([
    false,
    true,
  ])("reports a failed resource before destination writes (existing=%s)", async (existing) => {
    const { source, target } = await pods();
    const sourceUrl = `${source.root}unicode.ttl`;
    const targetUrl = `${target.root}unicode.ttl`;
    const turtle = await unicodeTurtle();
    source.store(sourceUrl, turtle, "text/turtle");
    if (existing) target.store(targetUrl, "keep existing bytes", "text/plain");
    const options = { source: source.side(), target: target.side() };
    const plan = await planMigration(options);
    const bytes = new TextEncoder().encode(turtle);
    const truncated = bytes.subarray(0, bytes.length - 8);
    source.responses.set(
      `GET ${sourceUrl}`,
      () =>
        new Response(truncated, {
          headers: { "content-type": "text/turtle", "content-length": String(truncated.length) },
        }),
    );
    const result = await executeMigration(
      finalizePlan(plan, resolve(plan, { "target-exists": "overwrite" })),
      options,
    );
    expect(result.failed).toEqual([
      { url: targetUrl, error: `Invalid or truncated RDF body at ${sourceUrl}; refusing to copy` },
    ]);
    expect(result.copied).toEqual([]);
    expect(result.verified).toBe(false);
    expect(result.skipped).toContainEqual({ url: sourceUrl, reason: "Copy did not complete" });
    expect(target.requests.filter((request) => request.method === "PUT")).toEqual([]);
    if (existing)
      expect(new TextDecoder().decode(target.data.get(targetUrl)?.bytes)).toBe(
        "keep existing bytes",
      );
    else expect(target.data.has(targetUrl)).toBe(false);
  });
});
