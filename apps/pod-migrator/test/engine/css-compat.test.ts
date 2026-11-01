// AUTHORED-BY Codex GPT-6
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { parseRdf } from "@jeswr/fetch-rdf";
import { describe, expect, it } from "vitest";
import {
  createPodHttp,
  executeMigration,
  finalizePlan,
  planMigration,
} from "../../src/engine/index.js";
import { acl, grant, pods, policy, resolve } from "./helpers.js";

describe("CSS PUT responses without ETags", () => {
  for (const from of ["wac", "acp"] as const)
    for (const to of ["wac", "acp"] as const)
      it(`${from} → ${to} locks, copies and grants using read ETags, including Unicode`, async () => {
        const { source, target } = await pods(from, to);
        target.writeEtags = false;
        const unicode = "private/caf%C3%A9%20%E6%BC%A2%E5%AD%97.txt";
        source.store(`${source.root}private/`, "", "text/turtle");
        source.store(source.root + unicode, "café 漢字 🌱\n");
        source.setAcl(
          source.root + unicode,
          await acl(source, source.root + unicode, policy(grant())),
        );
        const binary = Uint8Array.from({ length: 256 }, (_, i) => i);
        source.store(`${source.root}private/bytes.bin`, binary, "application/octet-stream");
        const options = { source: source.side(), target: target.side() };
        const plan = await planMigration(options);
        const result = await executeMigration(finalizePlan(plan, resolve(plan)), options);
        expect(result.failed).toEqual([]);
        expect(result.verified).toBe(true);
        expect(target.data.get(target.root + unicode)?.bytes).toEqual(
          new TextEncoder().encode("café 漢字 🌱\n"),
        );
        expect(target.data.get(`${target.root}private/bytes.bin`)).toMatchObject({
          bytes: binary,
          type: "application/octet-stream",
        });
        expect(await target.permissions(target.root + unicode)).toEqual(new Set(["read"]));
        const writes = target.requests.filter(
          (r) => r.method === "PUT" && r.url === target.acl(target.root + unicode),
        );
        expect(writes).toHaveLength(2);
        expect(writes[0]?.headers.get("if-none-match")).toBe("*");
        expect(writes[1]?.headers.get("if-match")).toBeTruthy();
        expect(writes[1]?.headers.has("if-none-match")).toBe(false);
        const binaryRead = target.requests.find(
          (r) => r.method === "GET" && r.url === `${target.root}private/bytes.bin`,
        );
        expect(binaryRead?.headers.get("accept")).toBe("application/octet-stream");
      });

  it.each([
    "changed-resource",
    "changed-members",
    "removed",
    "missing-etag",
  ])("refuses an unsafe ACL fallback: %s", async (change) => {
    const { source, target } = await pods("wac", "wac");
    target.writeEtags = false;
    const path = change === "changed-members" ? "folder/" : "file";
    const url = target.root + path;
    source.store(source.root + path, path.endsWith("/") ? "" : "secret");
    const options = {
      source: source.side(),
      target: target.side(),
    };
    // Mutate after the lock PUT, before its next read. The engine must never
    // treat a new ETag alone as proof that the locked state survived.
    target.afterWrite = async (written) => {
      if (written !== target.acl(url)) return;
      if (change === "changed-resource")
        target.setAcl(url, await acl(target, url, policy(grant())));
      if (change === "changed-members") target.setAcl(url, await acl(target, url, policy(), false));
      if (change === "removed") target.access.delete(written);
      if (change === "missing-etag") {
        const stored = target.access.get(written);
        if (stored) stored.etag = "";
      }
    };
    const plan = await planMigration(options);
    const result = await executeMigration(finalizePlan(plan, resolve(plan)), options);
    expect(result.verified).toBe(false);
    expect(result.failed[0]?.error).toMatch(
      /changed after write|disappeared after write|require an ETag/,
    );
    expect(
      target.requests.filter((r) => r.method === "PUT" && r.url === target.acl(url)),
    ).toHaveLength(1);
  });

  it("refuses a content fallback if a concurrent writer filled the placeholder", async () => {
    const { source, target } = await pods();
    target.writeEtags = false;
    source.store(`${source.root}file`, "secret");
    target.afterWrite = (url) => {
      if (url === `${target.root}file`) target.store(url, "concurrent");
    };
    const options = { source: source.side(), target: target.side() };
    const plan = await planMigration(options);
    const result = await executeMigration(finalizePlan(plan, resolve(plan)), options);
    expect(result.failed[0]?.error).toContain("require an ETag");
    expect(result.copied).toEqual([]);
    expect(new TextDecoder().decode(target.data.get(`${target.root}file`)?.bytes)).toBe(
      "concurrent",
    );
  });

  it("keeps If-Match protection when the ACL changes after its fallback read", async () => {
    const { source, target } = await pods("wac", "wac");
    target.writeEtags = false;
    source.store(`${source.root}file`, "secret");
    const url = `${target.root}file`;
    let locked = false;
    let raced = false;
    const http = createPodHttp({
      root: target.root,
      fetch: async (input, init) => {
        const response = await target.fetch(input, init);
        if (locked && !raced && init?.method === "GET" && input === target.acl(url)) {
          raced = true;
          target.setAcl(url, await acl(target, url));
        }
        return response;
      },
    });
    const options = {
      source: source.side(),
      target: { ...target.side(), http },
      onProgress: (event: { phase: string }) => {
        if (event.phase === "copy") locked = true;
      },
    };
    const plan = await planMigration(options);
    const result = await executeMigration(finalizePlan(plan, resolve(plan)), options);
    expect(raced).toBe(true);
    expect(result.failed[0]?.error).toBe("Pod request failed (412)");
    expect(result.verified).toBe(false);
    const writes = target.requests.filter((r) => r.method === "PUT" && r.url === target.acl(url));
    expect(writes).toHaveLength(2);
    expect(writes[1]?.headers.has("if-match")).toBe(true);
    expect(await target.permissions(url)).toEqual(new Set());
  });
});

it("merges the shipped CSS root ACR and preserves a pre-existing specific ACR's conditional write", async () => {
  const { source, target } = await pods("acp", "acp");
  target.writeEtags = false;
  const template = await readFile(
    createRequire(import.meta.url).resolve("@solid/community-server/templates/pod/acp/.acr.hbs"),
    "utf8",
  );
  target.setAcl(target.root, template.replaceAll("{{webId}}", target.owner));
  source.setAcl(source.root, await acl(source, source.root, policy(grant())));
  source.store(`${source.root}file`, "secret");
  // A server may materialize a specific default during resource creation.
  target.afterWrite = async (url) => {
    if (url === `${target.root}file` && !target.access.has(target.acl(url)))
      target.setAcl(url, await acl(target, url));
  };
  const options = { source: source.side(), target: target.side() };
  const plan = await planMigration(options);
  const result = await executeMigration(
    finalizePlan(plan, resolve(plan, { "protected-target": "merge" })),
    options,
  );
  expect(result.failed).toEqual([]);
  expect(result.verified).toBe(true);
  expect(await target.permissions(target.root)).toEqual(new Set(["read"]));
  expect(await target.permissions(`${target.root}file`)).toEqual(new Set());
  const lock = target.requests.find(
    (r) => r.method === "PUT" && r.url === target.acl(`${target.root}file`),
  );
  expect(lock?.headers.has("if-match")).toBe(true);
  expect(lock?.headers.has("if-none-match")).toBe(false);
});

it.each([
  "wac",
  "acp",
] as const)("normalizes JSON-LD %s controls for scope checks, root merges and verification", async (system) => {
  const { source, target } = await pods(system, system);
  target.writeEtags = false;
  source.store(`${source.root}file`, "secret");
  const http = createPodHttp({
    root: target.root,
    fetch: async (input, init) => {
      const response = await target.fetch(input, init);
      if (init?.method !== "GET" || !target.access.has(input as string) || !response.ok)
        return response;
      const dataset = await parseRdf(await response.text(), "text/turtle");
      // Convert existing RDF terms to expanded JSON-LD; no remote contexts.
      const graph = [...dataset].map((q) => ({
        "@id": q.subject.value,
        [q.predicate.value]: [{ "@id": q.object.value }],
      }));
      const headers = new Headers(response.headers);
      headers.set("content-type", "application/ld+json");
      return new Response(JSON.stringify(graph), { headers });
    },
  });
  const options = { source: source.side(), target: { ...target.side(), http } };
  const plan = await planMigration(options);
  const result = await executeMigration(
    finalizePlan(plan, resolve(plan, { "protected-target": "merge" })),
    options,
  );
  expect(result.failed).toEqual([]);
  expect(result.verified).toBe(true);
  expect(result.aclWritten).toContain(target.acl(target.root));
});

it("refuses a binary verification response with the wrong content type", async () => {
  const { source, target } = await pods();
  source.store(`${source.root}bytes.bin`, new Uint8Array([0, 255]), "application/octet-stream");
  const http = createPodHttp({
    root: target.root,
    fetch: async (input, init) => {
      const response = await target.fetch(input, init);
      if (init?.method !== "GET" || input !== `${target.root}bytes.bin`) return response;
      const headers = new Headers(response.headers);
      headers.set("content-type", "text/plain");
      return new Response(response.body, { headers });
    },
  });
  const options = { source: source.side(), target: { ...target.side(), http } };
  const plan = await planMigration(options);
  const result = await executeMigration(finalizePlan(plan, resolve(plan)), options);
  expect(result.failed[0]?.error).toBe("Content type verification failed");
  expect(result.verified).toBe(false);
});
