// AUTHORED-BY Codex GPT-6
import { once } from "node:events";
import { createConnection } from "node:net";
import { fetchRdf, parseRdf, RdfFetchError } from "@jeswr/fetch-rdf";
import { LiteralFrom, NamedNodeAs, NamedNodeFrom, SetFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Store, Writer } from "n3";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  createPodHttp,
  executeMigration,
  finalizePlan,
  type PodSide,
  planMigration,
} from "../../src/engine/index.js";
import { serialize } from "../../src/engine/rdf.js";
import { type CssAccount, createAccount } from "./account.js";
import { ownerRule, putFixture, setAccess } from "./fixtures.js";
import { appendProbeBody } from "./probe.js";
import { type CssServer, startServer } from "./server.js";

let server: CssServer;
let account: CssAccount;
beforeAll(async () => {
  server = await startServer("wac");
  account = await createAccount(server.base);
});
afterAll(async () => server?.stop());

/** Inspect all wire bytes, including bytes beyond the advertised HTTP body. */
async function wireGet(url: string): Promise<{ headers: string; body: Buffer }> {
  const target = new URL(url);
  const socket = createConnection({ host: "127.0.0.1", port: Number(target.port) });
  const chunks: Buffer[] = [];
  socket.on("data", (chunk) => chunks.push(chunk));
  socket.setTimeout(10_000, () => socket.destroy(new Error("Raw GET timed out")));
  try {
    socket.end(
      `GET ${target.pathname} HTTP/1.1\r\nHost: ${target.host}\r\nAccept: text/turtle\r\nConnection: close\r\n\r\n`,
    );
    await once(socket, "close");
    const wire = Buffer.concat(chunks);
    const separator = wire.indexOf("\r\n\r\n");
    expect(separator).toBeGreaterThan(0);
    return { headers: wire.subarray(0, separator).toString(), body: wire.subarray(separator + 4) };
  } finally {
    socket.destroy();
  }
}

it("CSS 7.2 counts string chunks as characters after PATCH and Fetch accepts truncated bytes", async () => {
  const store = new Store();
  const node = new TermWrapper("urn:example:note", store, DataFactory);
  SetFrom.subjectPredicate(node, "urn:example:text", (term) => term.value, LiteralFrom.string).add(
    "café 漢字 🌱",
  );
  const writer = new Writer();
  writer.addQuads([...store]);
  const original = await new Promise<string>((resolve, reject) =>
    writer.end((error, value) => (error ? reject(error) : resolve(value))),
  );
  await putFixture(account.side, "source/", "");
  await setAccess(account.side, "wac", `${account.podRoot}source/`, [
    ownerRule(account.webId, true),
  ]);
  const url = `${account.podRoot}source/length.ttl`;
  const put = await account.side.http.put(url, original, { contentType: "text/turtle" });
  expect(put.status).toBe(201);
  await put.arrayBuffer();
  await setAccess(account.side, "wac", url, [
    ownerRule(account.webId),
    { public: true, allow: ["read"] },
  ]);
  const before = await account.side.http.get(url, { accept: "text/turtle" });
  expect(before.status).toBe(200);
  expect(before.headers.get("content-length")).toBe(String(Buffer.byteLength(original)));
  expect(await before.text()).toBe(original);

  const patch = await appendProbeBody();
  const patched = await account.fetch(url, {
    method: "PATCH",
    headers: { "content-type": "application/sparql-update" },
    body: patch,
  });
  expect(patched.status).toBe(205);
  await patched.arrayBuffer();
  const wire = await wireGet(url);
  expect(wire.headers).toMatch(/^HTTP\/1\.1 200 /);
  const full = wire.body.toString("utf8");
  const head = await account.side.http.head(url);
  expect(head.status).toBe(200);
  expect(head.headers.get("content-length")).toBe(String(full.length));
  expect(wire.headers.toLowerCase()).toContain(`content-length: ${full.length}\r\n`);
  expect(wire.body.byteLength).toBeGreaterThan(full.length);
  expect((await parseRdf(full, "text/turtle", { baseIRI: url })).size).toBe(2);

  // Negotiation converts the complete stored stream and drops its character-counted length.
  const converted = await account.side.http.get(url, { accept: "application/n-quads" });
  expect(converted.status).toBe(200);
  expect(converted.headers.get("content-type")).toContain("application/n-quads");
  expect(converted.headers.get("content-length")).toBeNull();
  const independent = await parseRdf(await converted.text(), "application/n-quads", {
    baseIRI: url,
  });
  expect(independent.equals(await parseRdf(full, "text/turtle", { baseIRI: url }))).toBe(true);

  const after = await account.side.http.get(url, { accept: "text/turtle" });
  expect(after.status).toBe(200);
  const received = new Uint8Array(await after.arrayBuffer());
  expect(received.byteLength).toBe(full.length);
  expect(Buffer.from(received)).toEqual(wire.body.subarray(0, full.length));
  await expect(
    parseRdf(new TextDecoder().decode(received), "text/turtle", { baseIRI: url }),
  ).rejects.toThrow();
  // The shared parser already reports this error for streamed network reads too.
  await expect(fetchRdf(url, { fetch: account.fetch })).rejects.toBeInstanceOf(RdfFetchError);
  console.log(
    "[CSS Content-Length reproduction]",
    JSON.stringify({
      put: { status: put.status, body: original, bytes: Buffer.byteLength(original) },
      getBeforePatch: {
        status: before.status,
        contentLength: before.headers.get("content-length"),
      },
      patch: { status: patched.status, body: patch },
      rawGet: {
        headers: wire.headers,
        body: full,
        bytes: wire.body.byteLength,
        characters: full.length,
      },
      head: { status: head.status, contentLength: head.headers.get("content-length") },
      fetchGet: {
        status: after.status,
        bytes: received.byteLength,
        body: Buffer.from(received).toString(),
      },
    }),
  );

  await putFixture(account.side, "target/", "");
  await setAccess(account.side, "wac", `${account.podRoot}target/`, [
    ownerRule(account.webId, true),
  ]);
  const scopedSide = (path: string): PodSide => {
    const root = `${account.podRoot}${path}/`;
    return {
      root,
      ownerWebId: account.webId,
      implementation: "css",
      http: createPodHttp({ root, fetch: account.fetch, allowInsecureLoopback: true }),
    };
  };
  const options = { source: scopedSide("source"), target: scopedSide("target") };
  const plan = await planMigration(options);
  expect(plan.resources.filter((resource) => resource.kind === "resource")).toHaveLength(1);
  const choices = Object.fromEntries(
    plan.report
      .filter((item) => item.severity === "needs-decision")
      .map((item) => [item.id, "skip" as const]),
  );
  const result = await executeMigration(finalizePlan(plan, choices), options);
  expect(result.failed).toEqual([
    {
      url: `${options.target.root}length.ttl`,
      error: `Invalid or truncated RDF body at ${url}; refusing to copy`,
    },
  ]);
  expect(result.copied).toEqual([]);
  expect(result.verified).toBe(false);
  expect(result.skipped).toContainEqual({ url, reason: "Copy did not complete" });
  expect((await options.target.http.head(`${options.target.root}length.ttl`)).status).toBe(404);
});

it("refuses a CSS PATCH body truncated exactly between valid triples, with rewriting on or off", async () => {
  const probe = new Store();
  const probeNode = new TermWrapper("urn:css-test:probe", probe, DataFactory);
  SetFrom.subjectPredicate(
    probeNode,
    "urn:css-test:predicate",
    NamedNodeAs.string,
    NamedNodeFrom.string,
  ).add("urn:css-test:value");
  const tail = await serialize(probe);
  const store = new Store();
  const node = new TermWrapper("urn:example:note", store, DataFactory);
  SetFrom.subjectPredicate(node, "urn:example:text", (term) => term.value, LiteralFrom.string).add(
    "é".repeat(tail.length),
  );
  const original = await serialize(store);
  await putFixture(account.side, "source-prefix/", "");
  await setAccess(account.side, "wac", `${account.podRoot}source-prefix/`, [
    ownerRule(account.webId, true),
  ]);
  const url = `${account.podRoot}source-prefix/prefix.ttl`;
  await putFixture(account.side, "source-prefix/prefix.ttl", original, "text/turtle");
  await setAccess(account.side, "wac", url, [
    ownerRule(account.webId),
    { public: true, allow: ["read"] },
  ]);
  const patched = await account.fetch(url, {
    method: "PATCH",
    headers: { "content-type": "application/sparql-update" },
    body: await appendProbeBody(),
  });
  expect(patched.status).toBe(205);
  await patched.arrayBuffer();
  const wire = await wireGet(url);
  expect(wire.body.toString("utf8")).toBe(original + tail);
  const fetched = await account.side.http.get(url, { accept: "text/turtle" });
  const bytes = new Uint8Array(await fetched.arrayBuffer());
  expect(bytes.length).toBe(Number(fetched.headers.get("content-length")));
  expect(new TextDecoder("utf-8", { fatal: true }).decode(bytes)).toBe(original);
  expect((await parseRdf(original, "text/turtle")).size).toBe(1);
  expect((await parseRdf(wire.body.toString("utf8"), "text/turtle")).size).toBe(2);

  const scoped = (path: string): PodSide => {
    const root = `${account.podRoot}${path}/`;
    return {
      root,
      ownerWebId: account.webId,
      implementation: "css",
      http: createPodHttp({ root, fetch: account.fetch, allowInsecureLoopback: true }),
    };
  };
  for (const rewriteIris of [false, true]) {
    const path = `target-prefix-${rewriteIris}`;
    await putFixture(account.side, `${path}/`, "");
    await setAccess(account.side, "wac", `${account.podRoot}${path}/`, [
      ownerRule(account.webId, true),
    ]);
    const target = scoped(path);
    const put = target.http.put;
    const writes: string[] = [];
    target.http = {
      ...target.http,
      put: async (resource, body, init) => {
        writes.push(resource);
        return put(resource, body, init);
      },
    };
    const options = { source: scoped("source-prefix"), target, rewriteIris };
    const plan = await planMigration(options);
    const choices = Object.fromEntries(
      plan.report
        .filter((item) => item.severity === "needs-decision")
        .map((item) => [item.id, "skip" as const]),
    );
    const result = await executeMigration(finalizePlan(plan, choices), options);
    expect(result.failed).toEqual([
      {
        url: `${target.root}prefix.ttl`,
        error: `RDF completeness cannot be established at ${url}: independent representation unavailable or graph mismatch`,
      },
    ]);
    expect(result.copied).toEqual([]);
    expect(result.verified).toBe(false);
    expect(writes).toEqual([]);
    expect((await target.http.head(`${target.root}prefix.ttl`)).status).toBe(404);
  }
});
