// AUTHORED-BY Codex GPT-6.1-Sol

import { Writer } from "n3";
import { expect, it, vi } from "vitest";
import { MemoryLedger, verifyLedger } from "../src/ledger.js";
import {
  AGENT,
  assertSameGraph,
  entryGraph,
  headGraph,
  node,
  PROV,
  parseTurtle,
  turtle,
} from "../src/rdf.js";
import { loadTrace, readHead } from "../src/reader.js";
import { ENTRY_KINDS, seal } from "../src/records.js";
import { createMemoryAuditPod } from "../src/testing.js";
import type { AuditFetch } from "../src/transport.js";
import { boundedText, documentUrl, readDocument, request, storageRoot } from "../src/transport.js";
import { AuditWriter, hashRecipient, PodMirror } from "../src/writer.js";
import { AT, required } from "./fixture.js";

const ROOT = "https://pod.example/";
const BASE = `${ROOT}agent/audit/`;
const record = {
  type: "ingest",
  id: "urn:event:1",
  agent: "https://pod.example/agent#me",
  owner: "https://pod.example/profile#me",
} as const;
function ledger(count = 1) {
  const l = new MemoryLedger();
  for (let i = 0; i < count; i++) l.append(record, AT);
  return l;
}
it.each([
  ...ENTRY_KINDS,
  "ledger-checkpoint",
] as const)("keeps PROV entity and activity roles disjoint for %s", (type) => {
  const l = new MemoryLedger();
  const entry = l.append(
    type === "ledger-checkpoint"
      ? { type, lastPrunedSeq: 1, lastPrunedHash: `sha-256:${"a".repeat(64)}` }
      : { ...record, type, proposal: "urn:proposal:1", mandate: "urn:mandate:1" },
    AT,
  );
  const url = `${BASE}1.ttl`;
  const graph = entryGraph(url, entry);
  const activity = node(graph, url);
  const entity = node(graph, `${url}#entry`);
  const rdfType = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
  expect(activity.values(rdfType).map((n) => n.value)).toContain(`${PROV}Activity`);
  expect(activity.values(rdfType).map((n) => n.value)).not.toContain(`${PROV}Entity`);
  expect(entity.values(rdfType).map((n) => n.value)).toEqual([`${PROV}Entity`]);
  expect(activity.values(`${PROV}wasAttributedTo`)).toEqual([]);
  expect(entity.values(`${PROV}wasAttributedTo`).map((n) => n.value)).toEqual(
    type === "ledger-checkpoint" ? [] : [record.owner],
  );
  expect(activity.values(`${PROV}generated`).map((n) => n.value)).toContain(entity.value);
  const headUrl = `${BASE}chain.ttl`;
  const head = node(headGraph(headUrl, entry.seq, entry.hash), headUrl);
  expect(head.values(rdfType).map((n) => n.value)).toContain(`${PROV}Collection`);
  const members = head.values(`${PROV}hadMember`).map((n) => n.value);
  expect(members).toEqual([entity.value]);
  // Include Entity types inferred by the domains/ranges of PROV relations.
  const entities = [
    entity.value,
    head.value,
    ...members,
    ...activity.values(`${PROV}generated`).map((n) => n.value),
    ...activity.values(`${PROV}used`).map((n) => n.value),
  ];
  expect(entities).not.toContain(activity.value);
});
it("produces byte-identical PROV Turtle and a golden head", async () => {
  const pod = createMemoryAuditPod();
  const l = ledger(2);
  const m = new PodMirror(pod.fetch, ROOT);
  await m.sync(l.entries());
  expect(required(pod.resources.get(`${BASE}1.ttl`)).body).toMatchFileSnapshot("fixtures/1.ttl");
  expect(required(pod.resources.get(`${BASE}chain.ttl`)).body).toMatchFileSnapshot(
    "fixtures/chain.ttl",
  );
  const before = structuredClone(pod.resources);
  await m.sync(l.entries());
  expect(pod.resources).toEqual(before);
  expect((await loadTrace(pod.fetch, ROOT)).entries).toEqual(l.entries());
  const checkpoint = {
    type: "ledger-checkpoint" as const,
    lastPrunedSeq: 1,
    lastPrunedHash: required(l.entries()[0]).hash,
  };
  l.append(checkpoint, AT);
  await m.sync(l.entries());
  expect((await loadTrace(pod.fetch, ROOT)).chain.ok).toBe(true);
});
it("serializes concurrent appends and retains local evidence after mirror failure", async () => {
  const pod = createMemoryAuditPod();
  const l = new MemoryLedger();
  let fail = true;
  const io: AuditFetch = async (input, init) => {
    if (fail && init?.method === "PUT") throw new Error("unavailable");
    return pod.fetch(input, init);
  };
  const writer = new AuditWriter(l, new PodMirror(io, ROOT));
  await expect(writer.append(record, AT)).rejects.toThrow("unavailable");
  expect(l.entries()).toHaveLength(1);
  fail = false;
  const input = { ...record, id: String(record.id) };
  const promises = [writer.append(input, AT), writer.append(input, AT)];
  input.id = "urn:changed";
  expect((await Promise.all(promises)).map((e) => e.seq)).toEqual([2, 3]);
  expect((await loadTrace(pod.fetch, ROOT)).entries).toEqual(l.entries());
});
it("accepts 205 responses when updating the head", async () => {
  const pod = createMemoryAuditPod();
  const io: AuditFetch = async (input, init) => {
    const response = await pod.fetch(input, init);
    return String(input).endsWith("chain.ttl") && response.status === 204
      ? new Response(null, { status: 205, headers: response.headers })
      : response;
  };
  const l = new MemoryLedger();
  const writer = new AuditWriter(l, new PodMirror(io, ROOT));
  await writer.append(record, AT);
  await writer.append(record, AT);
  expect((await loadTrace(pod.fetch, ROOT)).entries).toEqual(l.entries());
});
it("refreshes ETags omitted by head PUTs before committing the next entry in a batch", async () => {
  const pod = createMemoryAuditPod();
  const io: AuditFetch = async (input, init) => {
    const response = await pod.fetch(input, init);
    if (String(input).endsWith("chain.ttl") && init?.method === "PUT")
      response.headers.delete("etag");
    return response;
  };
  const l = ledger(3);
  const mirror = new PodMirror(io, ROOT);
  await mirror.sync(l.entries());
  const headCalls = pod.calls.filter(({ url }) => url === `${BASE}chain.ttl`);
  expect(headCalls.map(({ init }) => init.method ?? "GET")).toEqual([
    "GET",
    "PUT",
    "GET",
    "PUT",
    "GET",
    "PUT",
    "GET",
  ]);
  const commits = headCalls.filter(({ init }) => init.method === "PUT");
  expect(new Headers(required(commits[0]).init.headers).get("if-none-match")).toBe("*");
  for (const [i, commit] of commits.slice(1).entries())
    expect(new Headers(commit.init.headers).get("if-match")).toBe(`"${(i + 1) * 2}"`);
  expect((await loadTrace(pod.fetch, ROOT)).entries).toEqual(l.entries());
  const before = structuredClone(pod.resources);
  await mirror.sync(l.entries());
  expect(pod.resources).toEqual(before);
});
it.each([
  "missing",
  "sequence",
  "hash",
  "etag",
] as const)("rejects an invalid head re-read after a PUT (%s)", async (fault) => {
  const pod = createMemoryAuditPod();
  const entries = ledger(2).entries();
  const headUrl = `${BASE}chain.ttl`;
  const io: AuditFetch = async (input, init) => {
    const response = await pod.fetch(input, init);
    if (String(input) === headUrl && init?.method === "PUT") {
      response.headers.delete("etag");
      if (fault === "missing") pod.resources.delete(headUrl);
      if (fault === "sequence" || fault === "hash")
        pod.put(
          headUrl,
          await turtle(
            headGraph(
              headUrl,
              fault === "sequence" ? 2 : 1,
              fault === "hash" ? `sha-256:${"a".repeat(64)}` : required(entries[0]).hash,
            ),
          ),
        );
    }
    if (fault === "etag") response.headers.delete("etag");
    return response;
  };
  await expect(new PodMirror(io, ROOT).sync(entries)).rejects.toThrow(
    fault === "etag" ? "ETag" : "head changed after commit",
  );
  expect(pod.resources.has(`${BASE}2.ttl`)).toBe(false);
  expect(pod.calls.filter(({ init }) => init.method === "PUT")).toHaveLength(2);
});
it("retains conditional updates if a competing write follows the ETag refresh", async () => {
  const pod = createMemoryAuditPod();
  const entries = ledger(2).entries();
  const headUrl = `${BASE}chain.ttl`;
  let refreshed = false;
  const io: AuditFetch = async (input, init) => {
    if (String(input) === `${BASE}2.ttl` && init?.method === "PUT") {
      const head = required(pod.resources.get(headUrl));
      pod.put(headUrl, head.body);
    }
    const response = await pod.fetch(input, init);
    if (String(input) === headUrl) {
      if (init?.method === "PUT") response.headers.delete("etag");
      else if (response.status === 200) refreshed = true;
    }
    return response;
  };
  const mirror = new PodMirror(io, ROOT);
  await expect(mirror.sync(entries)).rejects.toThrow("head commit");
  expect(refreshed).toBe(true);
  expect(await readHead(pod.fetch, BASE)).toMatchObject({ seq: 1 });
  await new PodMirror(pod.fetch, ROOT).sync(entries);
  expect((await loadTrace(pod.fetch, ROOT)).entries).toEqual(entries);
});
it("recovers an immutable entry left by a failed head commit", async () => {
  const pod = createMemoryAuditPod();
  let fail = true;
  const io: AuditFetch = (input, init) =>
    String(input).endsWith("chain.ttl") && init?.method === "PUT" && fail
      ? Promise.resolve(new Response(null, { status: 412 }))
      : pod.fetch(input, init);
  const m = new PodMirror(io, ROOT);
  const e = ledger().entries();
  await expect(m.sync(e)).rejects.toThrow("head commit");
  expect(pod.resources.has(`${BASE}1.ttl`)).toBe(true);
  fail = false;
  await m.sync(e);
  expect((await loadTrace(pod.fetch, ROOT)).chain.ok).toBe(true);
  const mismatched = ledger()
    .entries()
    .map((e) => ({ ...e, hash: `sha-256:${"a".repeat(64)}` }));
  await expect(m.sync(mismatched)).rejects.toThrow("integrity");
});
it("fails closed on entry conflicts, failed PUTs and unsupported head concurrency", async () => {
  const e = ledger(2).entries();
  const pod = createMemoryAuditPod();
  const gone: AuditFetch = async (_input, init) =>
    new Response(null, { status: init?.method === "PUT" ? 412 : 404 });
  await expect(new PodMirror(gone, ROOT).sync(e)).rejects.toThrow("entry conflict");
  const failed: AuditFetch = async (_input, init) =>
    new Response(null, { status: init?.method === "PUT" ? 500 : 404 });
  await expect(new PodMirror(failed, ROOT).sync(e)).rejects.toThrow("entry write");
  pod.put(`${BASE}1.ttl`, "<urn:a> <urn:b> <urn:c> .");
  await expect(new PodMirror(pod.fetch, ROOT).sync(e)).rejects.toThrow("missing-prov");
  const noEtag: AuditFetch = async (input, init) => {
    const response = await pod.fetch(input, init);
    response.headers.delete("etag");
    return response;
  };
  pod.resources.clear();
  await expect(new PodMirror(noEtag, ROOT).sync(e)).rejects.toThrow("ETag");
  await expect(new PodMirror(noEtag, ROOT).sync(e)).rejects.toThrow("ETag");
});
it("refuses head divergence, a missing prefix and malformed local entries", async () => {
  const pod = createMemoryAuditPod();
  const l = ledger(2);
  const m = new PodMirror(pod.fetch, ROOT);
  await m.sync(l.entries());
  await expect(m.sync(l.entries().slice(0, 1))).rejects.toThrow("ahead");
  const other = new MemoryLedger();
  other.append({ ...record, id: "urn:different" }, AT);
  other.append(record, AT);
  await expect(m.sync(other.entries())).rejects.toThrow("divergence");
  pod.resources.clear();
  const entries = l.entries();
  const cp = l.append(
    { type: "ledger-checkpoint", lastPrunedSeq: 1, lastPrunedHash: required(entries[0]).hash },
    AT,
  );
  expect(verifyLedger([required(entries[1]), cp]).ok).toBe(true);
  await expect(m.sync([required(entries[1]), cp])).rejects.toThrow("contiguous");
});
it("rejects a batch beyond the reader's limit before any writes and accepts the boundary", async () => {
  const pod = createMemoryAuditPod();
  const previousHash = `sha-256:${"a".repeat(64)}`;
  const checkpoint = seal(199999, AT, previousHash, {
    type: "ledger-checkpoint",
    lastPrunedSeq: 199998,
    lastPrunedHash: previousHash,
  });
  const last = seal(200000, AT, checkpoint.hash, record);
  const overflow = seal(200001, AT, last.hash, record);
  const entries = [checkpoint, last, overflow];
  const headUrl = `${BASE}chain.ttl`;
  pod.put(headUrl, await turtle(headGraph(headUrl, checkpoint.seq, checkpoint.hash)));
  const before = structuredClone(pod.resources);
  const mirror = new PodMirror(pod.fetch, ROOT);
  await expect(mirror.sync(entries)).rejects.toThrow("Audit range exceeds bound");
  expect(pod.resources).toEqual(before);
  expect(pod.calls.some(({ init }) => init.method === "PUT")).toBe(false);
  await mirror.sync([checkpoint, last]);
  expect(await readHead(pod.fetch, BASE)).toMatchObject({ seq: last.seq, hash: last.hash });
  expect(pod.resources.has(`${BASE}200000.ttl`)).toBe(true);
  expect(pod.resources.has(`${BASE}200001.ttl`)).toBe(false);
  const atLimit = structuredClone(pod.resources);
  pod.calls.length = 0;
  await expect(mirror.sync(entries)).rejects.toThrow("Audit range exceeds bound");
  expect(pod.resources).toEqual(atLimit);
  expect(pod.calls.some(({ init }) => init.method === "PUT")).toBe(false);
  const empty = createMemoryAuditPod();
  await expect(new PodMirror(empty.fetch, ROOT).sync(entries)).rejects.toThrow(
    "Audit range exceeds bound",
  );
  expect(empty.resources.size).toBe(0);
  expect(empty.calls.some(({ init }) => init.method === "PUT")).toBe(false);
});
it("leaves an empty mirror unchanged when there are no entries", async () => {
  const pod = createMemoryAuditPod();
  await new PodMirror(pod.fetch, ROOT).sync([]);
  expect(pod.resources.size).toBe(0);
});
it("projects complete and incomplete decision records without inventing a verdict", () => {
  const l = new MemoryLedger();
  const minimal = l.append({ ...record, type: "decision" }, AT);
  const graph = entryGraph(`${BASE}1.ttl`, minimal);
  expect(node(graph, `${BASE}1.ttl`).values(`${AGENT}decision`)).toHaveLength(0);
  const full = l.append(
    {
      ...record,
      type: "decision",
      decision: "permit",
      reason: "autonomous",
      mandate: "urn:mandate:1",
    },
    AT,
  );
  expect(node(entryGraph(`${BASE}2.ttl`, full), `${BASE}2.ttl`).text(`${AGENT}reason`)).toBe(
    "autonomous",
  );
});
it("salts and account-binds recipient hashes and refuses weak salts", () => {
  const salt = new Uint8Array(32).fill(1);
  const hash = hashRecipient("a@example.org", "a", salt);
  expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  expect(hashRecipient("a@example.org", "b", salt)).not.toBe(hash);
  expect(hashRecipient("a@example.org", "a", new Uint8Array(32).fill(2))).not.toBe(hash);
  for (const [recipient, bytes] of [
    ["x", new Uint8Array(31)],
    ["", salt],
    ["x".repeat(4097), salt],
  ] as const)
    expect(() => hashRecipient(recipient, "a", bytes)).toThrow();
});
it("validates roots and confines document references to the configured pod", () => {
  expect(storageRoot(ROOT)).toBe(ROOT);
  expect(documentUrl(ROOT, `${ROOT}x#it`)).toBe(`${ROOT}x`);
  for (const root of [
    "file:///x/",
    "https://user:private@pod.example/",
    `${ROOT}?query`,
    `${ROOT}#it`,
    `${ROOT}no-slash`,
  ])
    expect(() => storageRoot(root)).toThrow();
  expect(() => documentUrl(ROOT, "https://elsewhere.example/x")).toThrow();
});
it("refuses redirects, errors and media mismatches without echoing response bodies", async () => {
  for (const response of [
    new Response(null, { status: 302 }),
    Object.assign(new Response(""), {}),
    new Response("private", { status: 403 }),
    new Response("private", { headers: { "content-type": "text/html" } }),
    new Response("private"),
  ]) {
    if (
      response.status === 200 &&
      response.headers.get("content-type") === "text/plain;charset=UTF-8"
    )
      Object.defineProperty(response, "url", { value: "https://elsewhere.example/" });
    await expect(readDocument(async () => response, `${BASE}1.ttl`)).rejects.toThrow();
  }
  const redirected = new Response();
  Object.defineProperty(redirected, "redirected", { value: true });
  await expect(request(async () => redirected, ROOT, {})).rejects.toThrow("redirect");
  expect(await readDocument(async () => new Response(null, { status: 404 }), ROOT)).toBeUndefined();
  expect(await boundedText(new Response(null))).toBe("");
  await expect(readDocument(async () => new Response(null), ROOT)).rejects.toThrow("media type");
  await expect(boundedText(new Response("x".repeat(1024 * 1024 + 1)))).rejects.toThrow("bound");
  const response = new Response(
    new ReadableStream({
      start(c) {
        c.error(new Error("broken stream"));
      },
    }),
  );
  await expect(boundedText(response)).rejects.toThrow("broken");
});
it("keeps fixture access anonymous and enforces both create and update preconditions", async () => {
  const pod = createMemoryAuditPod();
  await expect(pod.fetch(ROOT, { headers: { Authorization: "synthetic" } })).rejects.toThrow(
    "zero credentials",
  );
  await expect(pod.fetch(ROOT, { headers: { Cookie: "synthetic" } })).rejects.toThrow(
    "zero credentials",
  );
  expect(
    (await pod.fetch(ROOT, { method: "PUT", headers: { "If-Match": '"missing"' } })).status,
  ).toBe(412);
});
it("rejects malformed, ambiguous and missing PROV and handles serializer errors", async () => {
  const pod = createMemoryAuditPod();
  const url = `${BASE}chain.ttl`;
  const g = headGraph(url, 1, required(ledger().entries()[0]).hash);
  node(g, url).setText(`${AGENT}seq`, "2");
  pod.put(url, await turtle(g));
  await expect(readHead(pod.fetch, BASE)).rejects.toThrow("ambiguous");
  pod.put(url, "<urn:a> <urn:b> <urn:c> .");
  await expect(readHead(pod.fetch, BASE)).rejects.toThrow("Missing");
  const h = headGraph(url, 1, required(ledger().entries()[0]).hash);
  node(h, url).setIri(`${AGENT}seq`, "urn:not-a-literal");
  pod.put(url, await turtle(h));
  await expect(readHead(pod.fetch, BASE)).rejects.toThrow("literal");
  const empty = await parseTurtle("", url);
  expect(() => assertSameGraph(empty, g)).toThrow("missing-prov");
  const spy = vi.spyOn(Writer.prototype, "end").mockImplementationOnce((callback: unknown) => {
    (callback as (error: Error) => void)(new Error("serialize failed"));
    return undefined as never;
  });
  await expect(turtle(g)).rejects.toThrow("serialize failed");
  spy.mockRestore();
});
