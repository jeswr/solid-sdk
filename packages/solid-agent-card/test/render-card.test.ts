// AUTHORED-BY Codex GPT-6.1-Sol
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { recordToTurtle } from "@jeswr/agent-model";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderCard } from "../scripts/render-card.mjs";
import { verifyDescriptor } from "../src/verify.js";
import { descriptor, gmail, matrix } from "./fixtures/bindings.js";

const container = "https://alice.example/agent/descriptors/";
const gmailUrl = `${container}gmail.ttl`;
const matrixUrl = `${container}matrix.ttl`;
const listing = (members: string[]) => `@prefix ldp: <http://www.w3.org/ns/ldp#>.
<${container}> a ldp:BasicContainer; ldp:contains ${members.map((url) => `<${url}>`).join(", ")}.`;
const response = (body: string, status = 200) =>
  new Response(body, { status, headers: { "content-type": "text/turtle" } });
const multipleRecords = `${await recordToTurtle(gmail)}\n${await recordToTurtle(matrix)}`;
async function transport(body = listing([matrixUrl, gmailUrl])) {
  const responses = new Map([
    [container, body],
    [gmailUrl, await recordToTurtle(gmail)],
    [matrixUrl, await recordToTurtle(matrix)],
  ]);
  return vi.fn(async (url, _init) => {
    const text = responses.get(String(url));
    return response(text ?? "missing", text === undefined ? 404 : 200);
  });
}

describe("descriptor-container renderer", () => {
  it("reads only scoped documents, deduplicates, sorts, and replaces configured bindings", async () => {
    const fetch = await transport(
      listing([
        matrixUrl,
        gmailUrl,
        gmailUrl,
        container,
        `${container}nested/`,
        "https://evil.example/private",
        "https://alice.example/private.ttl",
        `${container}%2Fprivate.ttl`,
      ]),
    );
    const result = await renderCard({ ...descriptor, bindings: [matrix] }, container, fetch);
    expect(result.agentCard.capabilities.extensions[0].params.bindings).toEqual([gmail, matrix]);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([container, gmailUrl, matrixUrl]);
    expect(fetch.mock.calls.every(([, init]) => init.redirect === "error")).toBe(true);
  });

  it("renders an empty container without an extension", async () => {
    const fetch = await transport(`<${container}> a <http://www.w3.org/ns/ldp#BasicContainer>.`);
    const result = await renderCard(descriptor, container, fetch);
    expect(result.agentCard.capabilities).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    "urn:agent:binding:direct",
    "https://alice.example/bindings/gmail",
  ])("preserves capability identity %s independently of its document URL", async (id) => {
    const capability = { ...gmail, id };
    const body = await recordToTurtle(capability);
    const fetch = vi.fn(async (url) =>
      response(String(url) === container ? listing([gmailUrl]) : body),
    );
    const result = await renderCard(descriptor, container, fetch);
    expect(result.agentCard.capabilities.extensions[0].params.bindings).toEqual([capability]);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([container, gmailUrl]);
  });

  it.each([
    "https://alice.example/descriptors",
    `${container}?secret=hidden`,
    `${container}#fragment`,
    "file:///tmp/descriptors/",
    "https://user:pass@alice.example/descriptors/",
  ])("refuses invalid container URLs before fetching", async (url) => {
    const fetch = vi.fn();
    await expect(renderCard(descriptor, url, fetch)).rejects.toThrow(/container URL/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([404, 410, 403])("fails closed on container HTTP %s", async (status) => {
    await expect(
      renderCard(descriptor, container, async () => response("missing", status)),
    ).rejects.toThrow();
  });

  it("fails closed when a listed descriptor cannot be read", async () => {
    const fetch = await transport(listing([`${container}missing.ttl`]));
    await expect(renderCard(descriptor, container, fetch)).rejects.toThrow(/Could not read/);
  });

  it("rejects redirected responses even from an injected fetch", async () => {
    const redirected = response("");
    Object.defineProperty(redirected, "redirected", { value: true });
    await expect(renderCard(descriptor, container, async () => redirected)).rejects.toThrow(
      /redirect/,
    );
  });

  it("bounds response bytes and the number of descriptor reads", async () => {
    await expect(
      renderCard(descriptor, container, async () => response("x".repeat(256 * 1024 + 1))),
    ).rejects.toThrow(/byte limit/);
    const fetch = await transport(
      listing(Array.from({ length: 101 }, (_, index) => `${container}${index}.ttl`)),
    );
    await expect(renderCard(descriptor, container, fetch)).rejects.toThrow(/Too many/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    "not RDF!",
    `<${gmail.id}> a <https://jeswr.org/ns/agent#ChannelCapability>.`,
    multipleRecords,
  ])("rejects malformed, incomplete, or ambiguous descriptor documents", async (body) => {
    const fetch = async (url) => response(String(url) === container ? listing([gmailUrl]) : body);
    await expect(renderCard(descriptor, container, fetch)).rejects.toThrow();
  });
});

describe("render-card CLI", () => {
  const cleanup: (() => Promise<unknown>)[] = [];
  afterEach(async () => {
    for (const dispose of cleanup.splice(0).reverse()) await dispose();
  });

  it("writes three local files from an HTTP container using GET only", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agent-card-"));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const methods: string[] = [];
    let localContainer = "";
    const server = createServer(async (req, res) => {
      methods.push(req.method ?? "");
      res.setHeader("content-type", "text/turtle");
      if (req.url === "/descriptors/") {
        res.end(
          `<${localContainer}> a <http://www.w3.org/ns/ldp#BasicContainer>; <http://www.w3.org/ns/ldp#contains> <gmail.ttl>.`,
        );
      } else res.end(await recordToTurtle({ ...gmail, id: `${localContainer}gmail.ttl#gmail` }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    cleanup.push(
      () =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
    );
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test server port.");
    localContainer = `http://127.0.0.1:${address.port}/descriptors/`;
    const config = join(directory, "descriptor.json");
    await writeFile(config, JSON.stringify({ ...descriptor, bindings: undefined }));
    const output = join(directory, "output");
    await promisify(execFile)(process.execPath, [
      "scripts/render-card.mjs",
      config,
      localContainer,
      output,
    ]);
    const card = JSON.parse(await readFile(join(output, "agent-card.json"), "utf8"));
    expect(card.capabilities.extensions[0].params.bindings[0].binding).toBe("gmail");
    for (const [file, type] of [
      ["agent-description.ttl", "text/turtle"],
      ["agent-description.jsonld", "application/ld+json"],
    ]) {
      const result = await verifyDescriptor(descriptor.id, {
        body: await readFile(join(output, file), "utf8"),
        bodyContentType: type,
        expectedId: descriptor.id,
      });
      expect(result.issues).toEqual([]);
      expect(result.descriptor?.bindings?.[0]?.binding).toBe("gmail");
    }
    expect(methods).toEqual(["GET", "GET"]);
  });
});
