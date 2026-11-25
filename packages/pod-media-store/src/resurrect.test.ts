// AUTHORED-BY Claude Sonnet 5.5
// Found against a real CSS 7.2.0: a conditional write (`If-Match: "<etag>"`) to a resource that
// was deleted after it was read is a create (201), not a 412. The memory pod answers 412, so
// the server's behaviour is reproduced here by a storage that turns the write into a create.
import type { StorageClient } from "@jeswr/storage-client";
import { describe, expect, it } from "vitest";
import { allResources, harness, must, putInput } from "../test/support.js";

type Write = StorageClient["write"];

/** CSS-like: an `ifMatch` write to a missing resource creates it; `etag` overrides the answer. */
function lenient(
  storage: StorageClient,
  seen: { writes: number; deletes: unknown[] },
  options: { etag?: string | null; deleteFails?: boolean } = {},
): StorageClient {
  return new Proxy(storage, {
    get(target, property) {
      const value = Reflect.get(target, property, target) as unknown;
      if (typeof value !== "function") return value;
      if (property === "write") {
        return async (url: string, body: never, opts: Parameters<Write>[2]) => {
          if (opts?.ifMatch === undefined || opts.ifMatch === "*")
            return target.write(url, body, opts);
          seen.writes++;
          const exists = await target.head(url).then(
            () => true,
            () => false,
          );
          if (exists) return target.write(url, body, opts);
          const created = await target.write(url, body, {
            ...opts,
            ifMatch: "*",
          });
          // Like CSS, which answers the create without an ETag: take it from a follow-up HEAD.
          const etag = options.etag === undefined ? (await target.head(url)).etag : options.etag;
          return { ...created, etag, etagSource: "follow-up" as const };
        };
      }
      if (property === "delete") {
        return async (url: string, opts?: unknown) => {
          seen.deletes.push(opts);
          if (options.deleteFails) throw new Error("delete refused");
          return (value as (...a: unknown[]) => Promise<unknown>).call(target, url, opts);
        };
      }
      return value.bind(target);
    },
  });
}

// LWS: the memory pod answers a write to a missing resource with 404, so only Solid can resurrect.
describe("an update that races a delete (solid)", () => {
  const protocol = "solid";
  const race = async (options: Parameters<typeof lenient>[2]) => {
    const seen = { writes: 0, deletes: [] as unknown[] };
    const h = await harness(protocol);
    const out = must(await h.store.put(putInput()));
    const racing = await h.reopen({ storage: lenient(h.storage, seen, options) });
    const result = await racing.update(out.descriptionUrl, async (current) => {
      // Another writer deletes the description between the store's read and its write.
      const head = await h.storage.head(out.descriptionUrl);
      await h.storage.delete(out.descriptionUrl, { ifMatch: head.etag as string });
      return { body: current.body, contentType: current.contentType };
    });
    return { h, out, result, seen };
  };

  it("does not report success, and takes the resurrected description down again", async () => {
    const { h, out, result, seen } = await race({});
    expect(result).toEqual({ ok: false, error: { kind: "not-found", reason: "storage" } });
    expect(seen.writes).toBe(1);
    // The take-down is conditional on the version the write returned.
    expect(seen.deletes).toEqual([expect.objectContaining({ ifMatch: expect.any(String) })]);
    expect(await allResources(h.storage)).not.toContain(out.descriptionUrl);
  });

  it("still reports the item gone when the take-down is refused or no validator came back", async () => {
    const refused = await race({ deleteFails: true });
    expect(refused.result).toEqual({ ok: false, error: { kind: "not-found", reason: "storage" } });
    expect(refused.seen.deletes).toHaveLength(1);
    const bare = await race({ etag: null });
    expect(bare.result).toEqual({ ok: false, error: { kind: "not-found", reason: "storage" } });
    expect(bare.seen.deletes).toEqual([]);
  });
});
