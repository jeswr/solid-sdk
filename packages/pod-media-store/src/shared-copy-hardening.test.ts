// AUTHORED-BY Claude Sonnet 5.5
// Review findings S-03 to S-11 on the shared-copy change: the journal is never a reason for a put
// to leave a complete pair behind, a half-finished delete survives a veto and a restart, the
// sweep respects pending deletes and the copy lock, and the new calls fail with typed errors.
import { StorageError } from "@jeswr/storage-client";
import { describe, expect, it } from "vitest";
import {
  allResources,
  deferred,
  gate,
  type Harness,
  harness,
  intercept,
  jpeg,
  must,
  putInput,
  ROOT,
  raced,
  shardOf,
} from "../test/support.js";
import { createMemoryJournal, type DeleteJournal } from "./journal.js";

const offline = () => new StorageError("network", { url: "x:", method: "DELETE" });
const brokenDelete = (journal: DeleteJournal): DeleteJournal => ({
  put: (entry) => journal.put(entry),
  list: () => journal.list(),
  delete: async () => {
    throw new Error("disk");
  },
});

describe.each(["solid", "lws"] as const)("shared-copy hardening (%s)", (protocol) => {
  let found: { descriptionUrl: string } | undefined;
  async function seeded(thumb = true, journal: DeleteJournal = createMemoryJournal()) {
    found = undefined;
    const h = await harness(protocol, {
      journal,
      ...(protocol === "lws" ? { findByHash: async () => found } : {}),
    });
    const out = must(await h.store.put(putInput(thumb ? { thumbnail: { bytes: jpeg(1) } } : {})));
    found = { descriptionUrl: out.descriptionUrl };
    return { h, out, journal };
  }

  async function interrupt(h: Harness, descriptionUrl: string) {
    const crashing = await h.reopen({
      storage: intercept(h.storage, (call) => {
        if (call.method === "delete") throw offline();
      }),
    });
    expect((await crashing.remove(descriptionUrl)).ok).toBe(false);
  }

  describe("a put and the journal (S-03)", () => {
    it("does not depend on the journal when nothing is pending: a fresh copy succeeds", async () => {
      const journal = brokenDelete(createMemoryJournal());
      const h = await harness(protocol, { journal });
      const out = must(await h.store.put(putInput()));
      expect(out.existed).toBe(false);
      expect(must(await h.store.list()).items).toHaveLength(1);
      expect(await allResources(h.storage)).toHaveLength(2);
    });

    it("fails closed for an adopted copy, with no orphans and nothing written", async () => {
      const { h, out } = await seeded(false);
      const stuck = await h.reopen({ journal: brokenDelete(createMemoryJournal()) });
      const before = await allResources(h.storage);
      const result = await stuck.put(putInput());
      // A bare typed error: it names no orphans, because the pair it adopted is complete.
      expect(result).toEqual({ ok: false, error: { kind: "failed", reason: "journal" } });
      expect(await allResources(h.storage)).toEqual(before);
      expect(must(await h.store.get(out.descriptionUrl)).binaryUrl).toBe(out.binaryUrl);
      // A retry adopts again and fails the same way: no duplicate pair appears.
      expect(await stuck.put(putInput())).toEqual(result);
      expect(await allResources(h.storage)).toEqual(before);
    });

    it.runIf(protocol === "solid")("withdraws before the first write", async () => {
      const log: string[] = [];
      const inner = createMemoryJournal();
      const h = await harness("solid", {
        journal: {
          put: (entry) => inner.put(entry),
          list: () => inner.list(),
          delete: async (url) => {
            log.push("journal.delete");
            await inner.delete(url);
          },
        },
      });
      const store = await h.reopen({
        storage: intercept(h.storage, (call) => {
          const name = (call.args[2] as { name?: string } | undefined)?.name ?? "";
          if (call.method === "create" && /^[0-9a-f]{64}/.test(name)) log.push("create");
        }),
      });
      must(await store.put(putInput()));
      expect(log.indexOf("journal.delete")).toBeLessThan(log.indexOf("create"));
      expect(log.indexOf("journal.delete")).toBeGreaterThanOrEqual(0);
    });
  });

  describe("a veto in the middle of an entry (S-04)", () => {
    async function halfDeleted() {
      const ctx = await seeded();
      await interrupt(ctx.h, ctx.out.descriptionUrl);
      let asked = 0;
      const result = must(await ctx.h.store.resumePending({ shouldResume: () => ++asked === 1 }));
      expect(result).toMatchObject({ completed: 0, skipped: 1 });
      return ctx;
    }

    it("keeps the entry, as phase deleted, and a fresh start still finishes it", async () => {
      const { h, out, journal } = await halfDeleted();
      const left = await journal.list();
      expect(left).toHaveLength(1);
      expect(left[0]?.phase).toBe("deleted");
      expect(await allResources(h.storage)).toEqual(
        expect.arrayContaining([out.binaryUrl, out.thumbnailUrl as string]),
      );
      const restarted = await h.reopen();
      // Still vetoed on the new start: skipped, never rejected or dropped.
      expect(must(await restarted.resumePending({ shouldResume: () => false }))).toMatchObject({
        skipped: 1,
        rejected: 0,
      });
      expect(await journal.list()).toHaveLength(1);
      expect(must(await restarted.resumePending())).toMatchObject({ completed: 1 });
      expect(await allResources(h.storage)).toEqual([]);
      expect(await journal.list()).toEqual([]);
    });

    it("a record without a phase is shown to the veto as an intent", async () => {
      const { h, out, journal } = await seeded(false);
      await journal.put({
        descriptionUrl: out.descriptionUrl,
        shardUrl: shardOf(h.store),
        binaryUrl: out.binaryUrl,
      });
      const phases: unknown[] = [];
      must(
        await h.store.resumePending({
          shouldResume: (entry) => {
            phases.push(entry.phase);
            return false;
          },
        }),
      );
      expect(phases).toEqual(["intent"]);
    });

    it("sweepOrphans leaves the media a pending entry names", async () => {
      const { h, out, journal } = await halfDeleted();
      expect(must(await h.store.sweepOrphans({ minAgeMs: 0 }))).toMatchObject({ deleted: 0 });
      expect(await allResources(h.storage)).toEqual(
        expect.arrayContaining([out.binaryUrl, out.thumbnailUrl as string]),
      );
      expect(must(await h.store.resumePending())).toMatchObject({ completed: 1 });
      expect(await journal.list()).toEqual([]);
      expect(await allResources(h.storage)).toEqual([]);
    });
  });

  describe("sweepOrphans and a put that adopts an old binary (S-05)", () => {
    it.runIf(protocol === "solid")(
      "does not delete what the put adopted since the listing",
      async () => {
        const { h, out } = await seeded(false);
        const etag = (await h.storage.head(out.descriptionUrl)).etag as string;
        await h.storage.delete(out.descriptionUrl, { ifMatch: etag });
        const hold = gate();
        const racing = new Proxy(h.storage, {
          get(target, property) {
            if (property === "listAll") {
              return async function* (...args: Parameters<typeof target.listAll>) {
                yield* target.listAll(...args);
                if (String(args[0]).endsWith("/2026/05/")) await hold.wait();
              };
            }
            const value = Reflect.get(target, property, target) as unknown;
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
        const store = await h.reopen({ storage: racing });
        const sweeping = store.sweepOrphans({ minAgeMs: 0 });
        await hold.hit;
        // The listing is stale from here on: the binary looks unreferenced.
        const saved = must(await store.put(putInput()));
        hold.open();
        expect(must(await sweeping)).toMatchObject({ deleted: 0 });
        expect(must(await store.get(saved.descriptionUrl)).binaryUrl).toBe(out.binaryUrl);
        expect(await allResources(h.storage)).toContain(out.binaryUrl);
      },
    );

    it.runIf(protocol === "solid")("reports a pod that fails during the re-check", async () => {
      const { h, out } = await seeded(false);
      const etag = (await h.storage.head(out.descriptionUrl)).etag as string;
      await h.storage.delete(out.descriptionUrl, { ifMatch: etag });
      const store = await h.reopen({
        storage: intercept(h.storage, (call) => {
          if (call.method === "read" && String(call.args[0]) === out.descriptionUrl)
            throw offline();
        }),
      });
      expect(await store.sweepOrphans({ minAgeMs: 0 })).toEqual({
        ok: false,
        error: { kind: "offline", reason: "storage" },
      });
      expect(await allResources(h.storage)).toContain(out.binaryUrl);
    });

    it.runIf(protocol === "solid")(
      "keeps media next to an empty description a put is filling",
      async () => {
        const { h, out } = await seeded(false);
        const etag = (await h.storage.head(out.descriptionUrl)).etag as string;
        await h.storage.write(out.descriptionUrl, "", {
          contentType: "text/turtle",
          ifMatch: etag,
        });
        expect(must(await h.store.sweepOrphans({ minAgeMs: 0 })).deleted).toBe(1);
        expect(await allResources(h.storage)).toContain(out.binaryUrl);
      },
    );
  });

  describe("the veto's answers and re-entrancy (S-06)", () => {
    it('"withdraw" skips the entry and drops it from the journal', async () => {
      const { h, out, journal } = await seeded();
      await interrupt(h, out.descriptionUrl);
      const result = must(await h.store.resumePending({ shouldResume: () => "withdraw" }));
      expect(result).toMatchObject({ completed: 0, skipped: 1 });
      expect(result.entries[0]).toMatchObject({ outcome: "skipped", reason: "withdrawn" });
      expect(await journal.list()).toEqual([]);
      expect(must(await h.store.get(out.descriptionUrl)).binaryUrl).toBe(out.binaryUrl);
      expect(must(await h.store.resumePending())).toMatchObject({ completed: 0 });
    });

    it('"withdraw" after the description was allowed drops the entry too', async () => {
      const { h, out, journal } = await seeded();
      await interrupt(h, out.descriptionUrl);
      let asked = 0;
      const result = must(
        await h.store.resumePending({ shouldResume: () => (++asked === 1 ? true : "withdraw") }),
      );
      expect(result).toMatchObject({ skipped: 1 });
      expect(await journal.list()).toEqual([]);
      expect(await allResources(h.storage)).toContain(out.binaryUrl);
    });

    it("a store call for the veto's own copy fails fast instead of hanging", async () => {
      const { h, out, journal } = await seeded();
      await interrupt(h, out.descriptionUrl);
      const seen: unknown[] = [];
      const result = must(
        await h.store.resumePending({
          shouldResume: async (entry) => {
            seen.push(await h.store.withdrawPending(entry.descriptionUrl));
            seen.push(await h.store.put(putInput({ thumbnail: { bytes: jpeg(1) } })));
            seen.push(await h.store.remove(entry.descriptionUrl));
            return false;
          },
        }),
      );
      expect(result).toMatchObject({ skipped: 1 });
      for (const one of seen) {
        expect(one).toEqual({ ok: false, error: { kind: "conflict", reason: "reentrant" } });
      }
      expect(seen).toHaveLength(3);
      // The copy is not stuck: the entry is still there, and the lock was released.
      expect(await journal.list()).toHaveLength(1);
      expect(await h.store.withdrawPending(out.descriptionUrl)).toEqual({
        ok: true,
        value: "withdrawn",
      });
    });
  });

  describe("update and attachThumbnail take the copy's lock (S-07)", () => {
    it("wait for a remove of the same copy, then report not-found", async () => {
      const { h, out } = await seeded(false);
      const hold = gate();
      const store = await h.reopen({
        storage: intercept(h.storage, async (call) => {
          if (call.method === "delete" && String(call.args[0]) === out.descriptionUrl) {
            await hold.wait();
          }
        }),
      });
      const removing = store.remove(out.descriptionUrl);
      await hold.hit;
      const updating = store.update(out.descriptionUrl, async () => undefined);
      const attaching = store.attachThumbnail(out.descriptionUrl, {
        bytes: jpeg(1),
        mutate: async (current) => ({ body: current.body, contentType: current.contentType }),
      });
      expect(await raced(updating)).toBe("waiting");
      expect(await raced(attaching)).toBe("waiting");
      hold.open();
      expect(await removing).toEqual({ ok: true, value: undefined });
      expect((await updating).ok).toBe(false);
      expect((await attaching).ok).toBe(false);
      expect(await allResources(h.storage)).toEqual([]);
    });
  });

  describe("bad arguments to resumePending are typed errors (S-08)", () => {
    it("null is no argument; anything else that is not a signal or options is invalid", async () => {
      const { h } = await seeded();
      expect(must(await h.store.resumePending(null as never))).toMatchObject({ completed: 0 });
      for (const bad of [5, "x", () => 1, { signal: 5 }, { signal: null }, { shouldResume: "x" }]) {
        expect(await h.store.resumePending(bad as never)).toEqual({
          ok: false,
          error: { kind: "failed", reason: "invalid-input" },
        });
      }
    });
  });

  describe("the journal entry is re-read before each destructive request (S-09)", () => {
    it("a withdrawal while the description is being deleted keeps the media", async () => {
      const { h, out, journal } = await seeded();
      await interrupt(h, out.descriptionUrl);
      const store = await h.reopen({
        storage: intercept(
          h.storage,
          () => {},
          async (call) => {
            // Another instance sharing the journal adopts the copy as the delete lands.
            if (call.method === "delete" && String(call.args[0]) === out.descriptionUrl) {
              await journal.delete(out.descriptionUrl);
            }
          },
        ),
      });
      const result = must(await store.resumePending());
      expect(result).toMatchObject({ completed: 0, skipped: 1 });
      expect(result.entries[0]).toMatchObject({ outcome: "skipped", reason: "withdrawn" });
      expect(await allResources(h.storage)).toEqual(
        expect.arrayContaining([out.binaryUrl, out.thumbnailUrl as string]),
      );
    });

    it("a withdrawal between the binary and the thumbnail delete keeps the thumbnail", async () => {
      const { h, out, journal } = await seeded();
      await interrupt(h, out.descriptionUrl);
      const store = await h.reopen({
        storage: intercept(
          h.storage,
          () => {},
          async (call) => {
            if (call.method === "delete" && String(call.args[0]) === out.binaryUrl) {
              await journal.delete(out.descriptionUrl);
            }
          },
        ),
      });
      expect(must(await store.resumePending())).toMatchObject({ completed: 0, skipped: 1 });
      expect(await allResources(h.storage)).toEqual([out.thumbnailUrl]);
    });
  });

  describe("withdrawPending on a half-finished delete (S-10)", () => {
    it("says incomplete for phase deleted, keeps the entry, and the media are still cleaned up", async () => {
      const { h, out, journal } = await seeded();
      const crashing = await h.reopen({
        storage: intercept(h.storage, (call) => {
          if (call.method === "head") throw offline();
        }),
      });
      await crashing.remove(out.descriptionUrl);
      expect((await journal.list())[0]?.phase).toBe("deleted");
      expect(await h.store.withdrawPending(out.descriptionUrl)).toEqual({
        ok: true,
        value: "incomplete",
      });
      expect((await journal.list())[0]?.phase).toBe("deleted");
      expect(must(await h.store.resumePending())).toMatchObject({ completed: 1 });
      expect(await allResources(h.storage)).toEqual([]);
    });

    it("converts an intent whose description is already gone", async () => {
      const { h, out, journal } = await seeded(false);
      await journal.put({
        descriptionUrl: out.descriptionUrl,
        shardUrl: shardOf(h.store),
        binaryUrl: out.binaryUrl,
        phase: "intent",
      });
      const etag = (await h.storage.head(out.descriptionUrl)).etag as string;
      await h.storage.delete(out.descriptionUrl, { ifMatch: etag });
      expect(await h.store.withdrawPending(out.descriptionUrl)).toEqual({
        ok: true,
        value: "incomplete",
      });
      expect((await journal.list())[0]?.phase).toBe("deleted");
      expect(must(await h.store.resumePending())).toMatchObject({ completed: 1 });
      expect(await allResources(h.storage)).toEqual([]);
    });

    it("drops a record that points outside the storage, and reports a failing check", async () => {
      const { h, out, journal } = await seeded(false);
      await journal.put({
        descriptionUrl: "https://evil.example/x",
        shardUrl: "https://evil.example/",
      });
      expect(await h.store.withdrawPending("https://evil.example/x")).toEqual({
        ok: true,
        value: "withdrawn",
      });
      expect(await journal.list()).toEqual([]);
      await interrupt(h, out.descriptionUrl);
      const failing = await h.reopen({
        storage: intercept(h.storage, (call) => {
          if (call.method === "head") throw offline();
        }),
      });
      expect(await failing.withdrawPending(out.descriptionUrl)).toEqual({
        ok: false,
        error: { kind: "offline", reason: "storage" },
      });
      expect(await journal.list()).toHaveLength(1);
    });
  });

  describe("keys are canonical (S-11)", () => {
    const loud = (url: string) => url.replace("https://pod.example", "https://POD.EXAMPLE");

    it("a differently spelled URL is the same copy for remove and withdrawPending", async () => {
      const { h, out, journal } = await seeded(false);
      await interrupt(h, out.descriptionUrl);
      expect((await journal.list())[0]?.descriptionUrl).toBe(out.descriptionUrl);
      expect(await h.store.withdrawPending(loud(out.descriptionUrl))).toEqual({
        ok: true,
        value: "withdrawn",
      });
      expect(await h.store.remove(loud(out.descriptionUrl))).toEqual({
        ok: true,
        value: undefined,
      });
      expect(await allResources(h.storage)).toEqual([]);
    });

    it("a string that is not a URL is a typed refusal, never a throw", async () => {
      const { h } = await seeded(false);
      const result = await h.store.remove("not a url");
      expect(result.ok).toBe(false);
      expect(await h.store.withdrawPending("not a url")).toEqual({ ok: true, value: "none" });
      expect(ROOT).toContain("pod.example");
    });
  });
});

describe("a hung wait can be left (nit)", () => {
  it("a waiter aborts out of the queue behind a request that never settles", async () => {
    const h = await harness("solid");
    const out = must(await h.store.put(putInput()));
    const hold = gate();
    const store = await h.reopen({
      storage: intercept(h.storage, async (call) => {
        if (call.method === "delete" && String(call.args[0]) === out.descriptionUrl) {
          await hold.wait();
        }
      }),
    });
    const removing = store.remove(out.descriptionUrl);
    await hold.hit;
    const controller = new AbortController();
    const waiting = store.withdrawPending(out.descriptionUrl, controller.signal);
    const seen = deferred();
    void raced(waiting).then(seen.fire);
    await seen.promise;
    controller.abort();
    expect(await waiting).toEqual({ ok: false, error: { kind: "failed", reason: "aborted" } });
    hold.open();
    await removing;
  });
});
