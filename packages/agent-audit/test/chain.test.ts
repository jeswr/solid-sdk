// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, it } from "vitest";
import { loadChain, PodChain } from "../src/chain.js";
import { AGENT, entryGraph, headGraph, node, turtle } from "../src/rdf.js";
import { type AuditRecord, GENESIS, MAX_AUDIT_SEQ, seal } from "../src/records.js";
import { createMemoryAuditPod } from "../src/testing.js";
import type { AuditFetch } from "../src/transport.js";

const BASE = "https://pod.example/agent/recall-audit/";
const HEAD = `${BASE}chain.ttl`;
const AT = "2026-11-01T12:00:00.000Z";
function record(id = "one"): AuditRecord {
  return {
    type: "personal-data-read",
    id: `urn:event:${id}`,
    owner: "urn:owner",
    agent: "urn:agent",
    tool: "memory_recall",
    decision: "permit",
    reason: "autonomous",
    categories: ["https://w3id.org/dpv/pd#Preference"],
    resources: [],
  };
}
it("writes genesis and sequential entries, serializes one instance, and detaches input", async () => {
  const pod = createMemoryAuditPod();
  const chain = new PodChain(pod.fetch, BASE);
  const r = record();
  const first = chain.append(r, AT);
  r.id = "urn:changed";
  const second = chain.append(record("two"), AT);
  const [a, b] = await Promise.all([first, second]);
  expect(a).toEqual(seal(1, AT, GENESIS, record()));
  expect(b).toEqual(seal(2, AT, a.hash, record("two")));
  expect((await loadChain(pod.fetch, BASE)).entries).toEqual([a, b]);
  for (const call of pod.calls) {
    expect(call.init.redirect).toBe("manual");
    expect(call.init.credentials).toBe("omit");
  }
  const puts = pod.calls.filter((c) => c.init.method === "PUT");
  expect(new Headers(puts[0]?.init.headers).get("if-none-match")).toBe("*");
  expect(new Headers(puts[1]?.init.headers).get("if-none-match")).toBe("*");
  expect(new Headers(puts[3]?.init.headers).has("if-match")).toBe(true);
});
it("two concurrent writers both succeed with a contiguous chain", async () => {
  const pod = createMemoryAuditPod();
  const [a, b] = await Promise.all([
    new PodChain(pod.fetch, BASE).append(record("a"), AT),
    new PodChain(pod.fetch, BASE).append(record("b"), AT),
  ]);
  expect([a.seq, b.seq].sort()).toEqual([1, 2]);
  const trace = await loadChain(pod.fetch, BASE);
  expect(trace.chain.ok).toBe(true);
  expect(
    new Set(trace.entries.map((e) => (e.record.type === "personal-data-read" ? e.record.id : ""))),
  ).toEqual(new Set(["urn:event:a", "urn:event:b"]));
});
it("heals a crash between entry and head creation before appending its own event", async () => {
  const pod = createMemoryAuditPod();
  let crash = true;
  const io: AuditFetch = (url, init) => {
    if (String(url) === HEAD && init?.method === "PUT" && crash) {
      crash = false;
      throw Error("private transport detail");
    }
    return pod.fetch(url, init);
  };
  await expect(new PodChain(io, BASE).append(record("crashed"), AT)).rejects.toThrow(
    "Audit chain append failed",
  );
  expect(pod.resources.has(`${BASE}1.ttl`)).toBe(true);
  expect(pod.resources.has(HEAD)).toBe(false);
  const result = await new PodChain(pod.fetch, BASE).append(record("recovery"), AT);
  expect(result.seq).toBe(2);
  expect((await loadChain(pod.fetch, BASE)).entries.map((e) => e.seq)).toEqual([1, 2]);
});
it("heals an entry after a prior head exists and resumes the same instance after a rejection", async () => {
  const pod = createMemoryAuditPod();
  await new PodChain(pod.fetch, BASE).append(record(), AT);
  let crash = true;
  const chain = new PodChain((url, init) => {
    if (String(url) === HEAD && init?.method === "PUT" && crash) {
      crash = false;
      return Promise.resolve(new Response(null, { status: 500 }));
    }
    return pod.fetch(url, init);
  }, BASE);
  await expect(chain.append(record("crashed"), AT)).rejects.toThrow("Audit chain append failed");
  expect((await chain.append(record("next"), AT)).seq).toBe(3);
  expect((await loadChain(pod.fetch, BASE)).chain.ok).toBe(true);
});
it.each([
  "hash",
  "prev",
  "projection",
  "schema",
  "malformed",
  "absent",
])("refuses a forged or unavailable collision: %s", async (mode) => {
  const pod = createMemoryAuditPod();
  const entry = seal(1, AT, GENESIS, record());
  if (mode === "hash") entry.hash = `sha-256:${"f".repeat(64)}`;
  if (mode === "prev") entry.prev = `sha-256:${"e".repeat(64)}`;
  const url = `${BASE}1.ttl`;
  const graph = entryGraph(url, entry);
  if (mode === "projection") node(graph, url).setText("urn:injected", "private");
  if (mode === "schema") {
    graph.removeQuads([...graph].filter((q) => q.predicate.value === `${AGENT}record`));
    node(graph, url).setText(`${AGENT}record`, JSON.stringify({ ...record(), value: "private" }));
  }
  if (mode !== "absent") pod.put(url, mode === "malformed" ? "invalid RDF" : await turtle(graph));
  const io: AuditFetch = (url, init) =>
    mode === "absent" && init?.method === "PUT" && String(url) !== HEAD
      ? Promise.resolve(new Response(null, { status: 412 }))
      : pod.fetch(url, init);
  await expect(new PodChain(io, BASE).append(record("next"), AT)).rejects.toThrow(
    "Audit chain integrity failure",
  );
  expect(pod.resources.has(HEAD)).toBe(false);
});
it.each([
  "head-get",
  "entry-put",
  "entry-get",
  "head-put",
])("refuses redirects at %s", async (where) => {
  const pod = createMemoryAuditPod();
  if (where === "entry-get")
    pod.put(
      `${BASE}1.ttl`,
      await turtle(entryGraph(`${BASE}1.ttl`, seal(1, AT, GENESIS, record()))),
    );
  const io: AuditFetch = (url, init) => {
    const head = String(url) === HEAD;
    const put = init?.method === "PUT";
    if (
      (where === "head-get" && head && !put) ||
      (where === "entry-put" && !head && put) ||
      (where === "entry-get" && !head && !put) ||
      (where === "head-put" && head && put)
    )
      return Promise.resolve(new Response(null, { status: 307 }));
    return pod.fetch(url, init);
  };
  await expect(new PodChain(io, BASE).append(record(), AT)).rejects.toThrow(
    where === "entry-get" ? "Audit chain integrity failure" : "Audit redirect refused",
  );
});
it("stops after five CAS losses and hides arbitrary thrown transport values", async () => {
  const pod = createMemoryAuditPod();
  let attempts = 0;
  const io: AuditFetch = (url, init) => {
    if (String(url) === HEAD && init?.method === "PUT") {
      attempts++;
      return Promise.resolve(new Response(null, { status: 412 }));
    }
    return pod.fetch(url, init);
  };
  await expect(new PodChain(io, BASE).append(record(), AT)).rejects.toThrow(
    "Audit chain retry limit exceeded",
  );
  expect(attempts).toBe(5);
  for (const thrown of [new Error("https://secret.example/"), "secret"])
    await expect(
      new PodChain(async () => {
        throw thrown;
      }, BASE).append(record(), AT),
    ).rejects.toThrow("Audit chain append failed");
});
it("rejects missing/weak ETags, failed writes, exhausted ranges and invalid containers", async () => {
  const pod = createMemoryAuditPod();
  await new PodChain(pod.fetch, BASE).append(record(), AT);
  for (const etag of [null, 'W/"weak"']) {
    const io: AuditFetch = async (url, init) => {
      const res = await pod.fetch(url, init);
      if (String(url) === HEAD) {
        if (etag === null) res.headers.delete("etag");
        else res.headers.set("etag", etag);
      }
      return res;
    };
    await expect(new PodChain(io, BASE).append(record(), AT)).rejects.toThrow(
      "Audit chain append failed",
    );
  }
  await expect(
    new PodChain(
      (url, init) =>
        init?.method === "PUT"
          ? Promise.resolve(new Response(null, { status: 403 }))
          : pod.fetch(url, init),
      BASE,
    ).append(record(), AT),
  ).rejects.toThrow("Audit chain append failed");
  pod.put(HEAD, await turtle(headGraph(HEAD, MAX_AUDIT_SEQ, `sha-256:${"a".repeat(64)}`)));
  await expect(new PodChain(pod.fetch, BASE).append(record(), AT)).rejects.toThrow(
    "Audit chain append failed",
  );
  for (const base of [
    "invalid",
    "https://pod.example",
    BASE.slice(0, -1),
    `${BASE}?query=1`,
    `${BASE}#frag`,
  ])
    expect(() => new PodChain(pod.fetch, base)).toThrow("Invalid audit storage root");
  await expect(
    new PodChain(pod.fetch, BASE).append({ ...record(), body: "private" } as AuditRecord, AT),
  ).rejects.toThrow("Invalid audit record");
});
it.each([
  "replaced-history",
  "invalid-hash",
])("detects %s while another writer helps our entry", async (mode) => {
  const pod = createMemoryAuditPod();
  let changed = false;
  const io: AuditFetch = async (url, init) => {
    if (String(url) === HEAD && init?.method === "PUT" && !changed) {
      changed = true;
      const bad = seal(1, AT, GENESIS, record("forged-history"));
      if (mode === "invalid-hash") bad.hash = `sha-256:${"f".repeat(64)}`;
      pod.put(`${BASE}1.ttl`, await turtle(entryGraph(`${BASE}1.ttl`, bad)));
      pod.put(HEAD, await turtle(headGraph(HEAD, 1, bad.hash)));
      return new Response(null, { status: 412 });
    }
    return pod.fetch(url, init);
  };
  await expect(new PodChain(io, BASE).append(record(), AT)).rejects.toThrow(
    "Audit chain integrity failure",
  );
});

it("returns its own entry when a second writer helps it and publishes a later head", async () => {
  const pod = createMemoryAuditPod();
  let helped = false;
  let otherSeq = 0;
  const io: AuditFetch = async (url, init) => {
    if (String(url) === HEAD && init?.method === "PUT" && !helped) {
      helped = true;
      otherSeq = (await new PodChain(pod.fetch, BASE).append(record("helper"), AT)).seq;
      return new Response(null, { status: 412 });
    }
    return pod.fetch(url, init);
  };
  const own = await new PodChain(io, BASE).append(record("original"), AT);
  expect(own.seq).toBe(1);
  expect(otherSeq).toBe(2);
  expect((await loadChain(pod.fetch, BASE)).entries).toHaveLength(2);
});
