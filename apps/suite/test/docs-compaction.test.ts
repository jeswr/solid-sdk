// AUTHORED-BY Codex
// AUTHORED-BY Codex GPT-6
import { describe, expect, it, vi } from "vitest";
import { applyUpdate, Doc, encodeStateAsUpdate, mergeUpdates } from "yjs";
import { compactDocumentLog } from "../src/apps/docs/editor/compact";
import { createSolidDriveClient } from "../src/apps/drive/lib/client/client";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { mapConcurrent } from "../src/lib/parallel";

const ROOT = "https://compact.test/";
const LOG = `${ROOT}docs/plan/updates/`;
function edits(count = 3) {
  const doc = new Doc();
  const updates: Uint8Array[] = [];
  doc.on("update", (update: Uint8Array) => updates.push(update));
  for (let index = 0; index < count; index++) doc.getText("body").insert(index, "x");
  doc.destroy();
  return updates;
}
function fixture(updates = edits()) {
  const pod = createDemoPod({
    root: ROOT,
    seed: updates.map((body, index) => ({
      path: `docs/plan/updates/${index}`,
      body,
      contentType: "application/octet-stream",
    })),
  });
  const originals = updates.map((_, index) => `${LOG}${index}`);
  let intercept: ((url: string, init?: RequestInit) => Promise<Response | undefined>) | undefined;
  const http = vi.fn<typeof fetch>(
    async (input, init) => (await intercept?.(String(input), init)) ?? pod.fetch(input, init),
  );
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: http });
  return {
    pod,
    http,
    client,
    originals,
    compact: () => compactDocumentLog(client, LOG, http),
    intercept: (hook: typeof intercept) => {
      intercept = hook;
    },
    copies: () =>
      pod.snapshot().resources.filter(([url]) => url.startsWith(LOG) && !originals.includes(url)),
    deletes: () => http.mock.calls.filter(([, init]) => init?.method === "DELETE"),
  };
}

describe("Docs log compaction before trash", () => {
  it("bounds parallel requests and verifies the durable merged copy before conditional deletes", async () => {
    const updates = edits(65);
    const f = fixture(updates);
    let active = 0;
    let peak = 0;
    const verified = new Set<string>();
    f.intercept(async (url, init) => {
      if (init?.method === "HEAD" && new Headers(init.headers).has("if-match")) {
        const response = await f.pod.fetch(url, init);
        expect(response.ok).toBe(true);
        expect(new Headers(init.headers).get("if-match")).toBe(response.headers.get("etag"));
        verified.add(url);
        return response;
      }
      if (init?.method === "DELETE") {
        expect(f.copies()).toHaveLength(1);
        expect(verified.has(f.copies()[0]?.[0] as string)).toBe(true);
        const source = await f.pod.fetch(url, { method: "HEAD" });
        expect(new Headers(init.headers).get("if-match")).toBe(source.headers.get("etag"));
      }
      if (f.originals.includes(url) && (init?.method ?? "GET") === "GET") {
        peak = Math.max(peak, ++active);
        await Promise.resolve();
        active--;
      }
      return undefined;
    });
    await f.compact();
    expect(peak).toBe(64);
    expect(f.http).toHaveBeenCalledTimes(3 * 65 + 4);
    expect(f.deletes()).toHaveLength(65);
    expect(f.copies()).toHaveLength(1);
    expect(f.copies()[0]?.[1].body).toEqual(mergeUpdates(updates));
    expect(f.originals.every((url) => !f.pod.has(url))).toBe(true);
  });

  it("retains pending CRDT structs and deletion sets, including updates that arrive later", async () => {
    const author = new Doc();
    const updates: Uint8Array[] = [];
    author.on("update", (update: Uint8Array) => updates.push(update));
    author.getText("body").insert(0, "abc");
    author.getText("body").insert(3, "def");
    author.getText("body").delete(1, 2);
    const f = fixture(updates.slice(1));
    await f.compact();
    const replay = new Doc();
    applyUpdate(replay, f.copies()[0]?.[1].body as Uint8Array);
    applyUpdate(replay, updates[0] as Uint8Array);
    expect(encodeStateAsUpdate(replay)).toEqual(encodeStateAsUpdate(author));
    replay.destroy();
    author.destroy();
  });

  it.each([0, 1])("leaves a log with %s updates alone", async (count) => {
    const f = fixture(edits(count));
    await f.compact();
    expect(f.http).toHaveBeenCalledTimes(1);
    expect(f.deletes()).toEqual([]);
  });
  it("leaves unexpected nested containers and corrupt updates available for Drive recovery", async () => {
    const nested = fixture();
    await nested.pod.fetch(`${LOG}nested/`, { method: "PUT" });
    await nested.compact();
    expect(nested.http).toHaveBeenCalledTimes(1);
    const corrupt = fixture([new Uint8Array([255]), new Uint8Array([255])]);
    await corrupt.compact();
    expect(corrupt.copies()).toEqual([]);
    expect(corrupt.deletes()).toEqual([]);
  });

  it.each([
    "listing",
    "read",
    "missing",
    "weak",
    "no-validator",
    "write",
    "write-validator",
  ])("keeps every original when the %s stage fails", async (stage) => {
    const f = fixture();
    f.intercept(async (url, init) => {
      const method = init?.method ?? "GET";
      if (stage === "listing" && url === LOG) return new Response(null, { status: 403 });
      if (["read", "missing"].includes(stage) && url === f.originals[0])
        return new Response(null, { status: stage === "read" ? 503 : 404 });
      if (stage === "write" && method === "PUT") return new Response(null, { status: 503 });
      if (
        (["weak", "no-validator"].includes(stage) && f.originals.includes(url)) ||
        (stage === "write-validator" && method === "PUT")
      ) {
        const response = await f.pod.fetch(url, init);
        const headers = new Headers(response.headers);
        if (stage === "weak") headers.set("etag", 'W/"weak"');
        else headers.delete("etag");
        return new Response(await response.arrayBuffer(), { status: response.status, headers });
      }
      return undefined;
    });
    await expect(f.compact()).rejects.toBeDefined();
    expect(f.deletes()).toEqual([]);
    expect(f.originals.every((url) => f.pod.has(url))).toBe(true);
  });

  it.each([
    "short",
    "changed",
    "missing",
    "unreadable",
    "replaced",
    "deleted",
  ])("never removes originals when the merged copy is %s", async (failure) => {
    const f = fixture();
    f.intercept(async (url, init) => {
      if (url === LOG || f.originals.includes(url)) return undefined;
      const method = init?.method ?? "GET";
      const response = await f.pod.fetch(url, init);
      if (method === "GET") {
        if (failure === "missing") return new Response(null, { status: 404 });
        if (failure === "unreadable") return new Response(null, { status: 503 });
        const body = new Uint8Array(await response.arrayBuffer());
        if (failure === "short") return new Response(body.slice(1), { headers: response.headers });
        if (failure === "changed") body[body.length - 1] = 255;
        return new Response(body, { headers: response.headers });
      }
      if (method === "HEAD") {
        if (failure === "deleted") return new Response(null, { status: 404 });
        if (failure === "replaced") return new Response(null, { headers: { etag: '"reused"' } });
      }
      return response;
    });
    await expect(f.compact()).rejects.toBeDefined();
    expect(f.deletes()).toEqual([]);
    expect(f.originals.every((url) => f.pod.has(url))).toBe(true);
  });

  it("preserves a concurrently replaced original and drains the group before reporting failure", async () => {
    const f = fixture();
    const replacement = new Uint8Array([0, 0]);
    f.intercept(async (_url, init) => {
      if (init?.method === "PUT")
        await f.pod.fetch(f.originals[0] as string, { method: "PUT", body: replacement });
      return undefined;
    });
    await expect(f.compact()).rejects.toMatchObject({ status: 412 });
    expect(f.copies()).toHaveLength(1);
    expect(
      new Uint8Array(await (await f.pod.fetch(f.originals[0] as string)).arrayBuffer()),
    ).toEqual(replacement);
    expect(f.deletes()).toHaveLength(3);
    const calls = f.http.mock.calls.length;
    await Promise.resolve();
    expect(f.http).toHaveBeenCalledTimes(calls);
  });

  it("keeps concurrent appends outside the captured log snapshot", async () => {
    const f = fixture();
    const extra = `${LOG}concurrent`;
    f.intercept(async (_url, init) => {
      if (init?.method === "PUT")
        await f.pod.fetch(extra, {
          method: "PUT",
          body: new Uint8Array(edits(1)[0] as Uint8Array),
        });
      return undefined;
    });
    await f.compact();
    expect(f.pod.has(extra)).toBe(true);
    expect(f.deletes().every(([url]) => String(url) !== extra)).toBe(true);
  });
});

it("drains a failed parallel group without starting the next group", async () => {
  let finish: (() => void) | undefined;
  const work = vi.fn(async (index: number) => {
    if (index === 0) throw new Error("failed");
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return index;
  });
  const pending = mapConcurrent([0, 1, 2], work, 2);
  const settled = vi.fn();
  void pending.catch(settled);
  await Promise.resolve();
  expect(settled).not.toHaveBeenCalled();
  finish?.();
  await expect(pending).rejects.toThrow("failed");
  expect(work.mock.calls).toEqual([[0], [1]]);
});
