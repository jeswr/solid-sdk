// AUTHORED-BY Claude Sonnet 5.5
// Content-named copies are shared by every record that saved the same bytes. These tests pin
// the hazard (an interrupted delete, the same bytes saved again, then a resume that destroys a
// copy in use) and its three defences: the `shouldResume` veto, `withdrawPending`, and the
// store's own withdrawal when `put` adopts a copy.
import { StorageError } from "@jeswr/storage-client";
import { describe, expect, it } from "vitest";
import {
  allResources,
  deferred,
  flush,
  gate,
  type Harness,
  harness,
  intercept,
  jpeg,
  must,
  putInput,
  raced,
  shardOf,
} from "../test/support.js";
import { createMemoryJournal, type DeleteJournal, type DeleteJournalEntry } from "./journal.js";
import type { PendingDelete, PutOutcome } from "./types.js";

const offline = () => new StorageError("network", { url: "x:", method: "DELETE" });

describe.each(["solid", "lws"] as const)("shared copies (%s)", (protocol) => {
  /** A harness whose store can reach the same pod through a hooked storage. */
  async function seeded(journal: DeleteJournal = createMemoryJournal(), thumb = true) {
    const h = await harness(protocol, {
      journal,
      // Signals "a put has reached its copy's lock": on Solid its shard exposure check is the
      // last request-free step before the lock; on LWS the caller's lookup is.
      ...(protocol === "lws"
        ? {
            findByHash: async () => {
              reached();
              return found;
            },
          }
        : {
            exposureTtlMs: 0,
            exposure: async (url: string) => {
              if (url.endsWith("/2026/05/")) reached();
              return "private" as const;
            },
          }),
    });
    const out = must(await h.store.put(putInput(thumb ? { thumbnail: { bytes: jpeg(1) } } : {})));
    found = { descriptionUrl: out.descriptionUrl };
    return { h, out, journal };
  }
  let found: { descriptionUrl: string } | undefined;
  let fire: (() => void) | undefined;
  const reached = () => {
    const f = fire;
    fire = undefined;
    f?.();
  };
  /** Resolves when the next put reaches its copy's lock; `flush()` after it lets it queue. */
  const arm = () => {
    const d = deferred();
    fire = d.fire;
    return d.promise;
  };
  /** A started put is queued at the lock once its signal fired and the microtasks ran. */
  const queued = async (promise: Promise<void>) => {
    await promise;
    await flush();
  };

  /** Interrupt `remove` after its intent is journalled and before anything is deleted. */
  async function interrupt(h: Harness, descriptionUrl: string) {
    const crashing = await h.reopen({
      storage: intercept(h.storage, (call) => {
        if (call.method === "delete") throw offline();
      }),
    });
    expect(await crashing.remove(descriptionUrl)).toEqual({
      ok: false,
      error: { kind: "offline", reason: "storage" },
    });
  }

  /** The destructive requests, in order, as the veto and the pod see them. */
  function traced(h: Harness, log: string[]) {
    return intercept(h.storage, (call) => {
      if (call.method === "delete") log.push(`delete ${String(call.args[0])}`);
    });
  }

  describe("shouldResume", () => {
    it("is consulted immediately before every destructive request, in order", async () => {
      const { h, out, journal } = await seeded();
      await interrupt(h, out.descriptionUrl);
      const log: string[] = [];
      const store = await h.reopen({ storage: traced(h, log) });
      const result = must(
        await store.resumePending({
          shouldResume: (entry) => {
            log.push(`veto ${entry.descriptionUrl}`);
            return true;
          },
        }),
      );
      expect(result).toMatchObject({ completed: 1, skipped: 0, failed: 0, rejected: 0 });
      expect(log).toEqual([
        `veto ${out.descriptionUrl}`,
        `delete ${out.descriptionUrl}`,
        `veto ${out.descriptionUrl}`,
        `delete ${out.binaryUrl}`,
        `veto ${out.descriptionUrl}`,
        `delete ${out.thumbnailUrl}`,
      ]);
      expect(await allResources(h.storage)).toEqual([]);
      expect(await journal.list()).toEqual([]);
    });

    it("is not asked about the description once it is already gone (phase deleted)", async () => {
      const { h, out, journal } = await seeded(undefined, false);
      await journal.put({
        descriptionUrl: out.descriptionUrl,
        shardUrl: shardOf(h.store),
        binaryUrl: out.binaryUrl,
        phase: "deleted",
      });
      await h.storage.delete(out.descriptionUrl, {
        ifMatch: (await h.storage.head(out.descriptionUrl)).etag as string,
      });
      const seen: PendingDelete[] = [];
      const result = must(
        await h.store.resumePending({
          shouldResume: (entry) => {
            seen.push(entry);
            return true;
          },
        }),
      );
      expect(result.completed).toBe(1);
      expect(seen).toHaveLength(1);
      expect(seen[0]?.phase).toBe("deleted");
    });

    it("false before the description delete skips the entry and leaves it untouched", async () => {
      const { h, out, journal } = await seeded();
      await interrupt(h, out.descriptionUrl);
      const before = await journal.list();
      const before1 = await allResources(h.storage);
      const log: string[] = [];
      const store = await h.reopen({ storage: traced(h, log) });
      const result = must(await store.resumePending({ shouldResume: () => false }));
      expect(result).toEqual({
        completed: 0,
        failed: 0,
        rejected: 0,
        skipped: 1,
        entries: [{ descriptionUrl: out.descriptionUrl, outcome: "skipped", reason: "vetoed" }],
      });
      expect(log).toEqual([]);
      expect(await journal.list()).toEqual(before);
      expect(await allResources(h.storage)).toEqual(before1);
      expect(must(await store.get(out.descriptionUrl)).binaryUrl).toBe(out.binaryUrl);
    });

    it("false before the binary delete leaves the entry and the remaining media", async () => {
      const { h, out, journal } = await seeded();
      await interrupt(h, out.descriptionUrl);
      let asked = 0;
      const log: string[] = [];
      const store = await h.reopen({ storage: traced(h, log) });
      const result = must(await store.resumePending({ shouldResume: () => ++asked === 1 }));
      expect(result).toMatchObject({ completed: 0, skipped: 1 });
      expect(log).toEqual([`delete ${out.descriptionUrl}`]);
      const left = await journal.list();
      expect(left).toHaveLength(1);
      expect(left[0]?.descriptionUrl).toBe(out.descriptionUrl);
      expect(await allResources(h.storage)).toEqual(
        expect.arrayContaining([out.binaryUrl, out.thumbnailUrl as string]),
      );
      // A later resume with the veto lifted finishes the delete.
      expect(must(await store.resumePending())).toMatchObject({ completed: 1, skipped: 0 });
      expect(await allResources(h.storage)).toEqual([]);
    });

    it("false before the thumbnail delete leaves the thumbnail and the entry", async () => {
      const { h, out, journal } = await seeded();
      await interrupt(h, out.descriptionUrl);
      let asked = 0;
      const result = must(await h.store.resumePending({ shouldResume: () => ++asked < 3 }));
      expect(result.skipped).toBe(1);
      expect(await allResources(h.storage)).toEqual([out.thumbnailUrl]);
      expect(await journal.list()).toHaveLength(1);
    });

    it("a throw, a rejection or a non-true answer counts as false, without aborting others", async () => {
      const journal = createMemoryJournal();
      const h = await harness(protocol, { journal });
      const outs: PutOutcome[] = [];
      for (const seed of [1, 2, 3, 4]) {
        outs.push(must(await h.store.put(putInput({ seed }))));
      }
      for (const out of outs) await interrupt(h, out.descriptionUrl);
      const answers = new Map<string, () => unknown>([
        [outs[0]?.descriptionUrl as string, () => Promise.reject(new Error("no"))],
        [
          outs[1]?.descriptionUrl as string,
          () => {
            throw new Error("sync");
          },
        ],
        [outs[2]?.descriptionUrl as string, () => 1],
        [outs[3]?.descriptionUrl as string, async () => true],
      ]);
      const result = must(
        await h.store.resumePending({
          shouldResume: (entry) => answers.get(entry.descriptionUrl)?.() as boolean,
        }),
      );
      expect(result).toMatchObject({ completed: 1, skipped: 3, failed: 0, rejected: 0 });
      const byOutcome = (url: string) => result.entries.find((e) => e.descriptionUrl === url);
      expect(byOutcome(outs[0]?.descriptionUrl as string)).toMatchObject({
        outcome: "skipped",
        reason: "veto-error",
      });
      expect(byOutcome(outs[1]?.descriptionUrl as string)?.reason).toBe("veto-error");
      expect(byOutcome(outs[2]?.descriptionUrl as string)?.reason).toBe("vetoed");
      expect(byOutcome(outs[3]?.descriptionUrl as string)?.outcome).toBe("completed");
      expect(await journal.list()).toHaveLength(3);
      for (const out of outs.slice(0, 3)) {
        expect(await allResources(h.storage)).toContain(out.binaryUrl);
      }
    });

    it("shows the veto the journal's record and nothing else", async () => {
      const { h, out, journal } = await seeded();
      await interrupt(h, out.descriptionUrl);
      const seen: PendingDelete[] = [];
      await h.store.resumePending({
        shouldResume: (entry) => {
          seen.push(entry);
          return false;
        },
      });
      const [entry] = seen;
      expect(Object.isFrozen(entry)).toBe(true);
      expect(entry).toEqual({
        descriptionUrl: out.descriptionUrl,
        shardUrl: shardOf(h.store),
        binaryUrl: out.binaryUrl,
        thumbnailUrl: out.thumbnailUrl,
        phase: "intent",
        ...(protocol === "solid" ? { sha256: out.sha256 } : {}),
      });
      expect(await journal.list()).toHaveLength(1);
    });

    it("tolerates a bare record: no phase, no binary", async () => {
      const journal = createMemoryJournal();
      const h = await harness(protocol, { journal });
      const out = must(await h.store.put(putInput({ thumbnail: { bytes: jpeg(1) } })));
      await h.storage.delete(out.descriptionUrl, {
        ifMatch: (await h.storage.head(out.descriptionUrl)).etag as string,
      });
      await journal.put({
        descriptionUrl: out.descriptionUrl,
        shardUrl: shardOf(h.store),
        thumbnailUrl: out.thumbnailUrl as string,
      });
      const seen: PendingDelete[] = [];
      await h.store.resumePending({
        shouldResume: (entry) => {
          seen.push(entry);
          return false;
        },
      });
      expect(seen).toHaveLength(1);
      expect(seen[0]).not.toHaveProperty("binaryUrl");
      // The description was already gone, so the point of no return is recorded before the veto.
      expect(seen[0]?.phase).toBe("deleted");
      expect(seen[0]?.thumbnailUrl).toBe(out.thumbnailUrl);
    });

    it("keeps every existing call form: none, a signal, or an options object", async () => {
      const { h } = await seeded();
      expect(must(await h.store.resumePending())).toMatchObject({ completed: 0, skipped: 0 });
      expect(must(await h.store.resumePending(new AbortController().signal))).toMatchObject({
        completed: 0,
      });
      expect(must(await h.store.resumePending({}))).toMatchObject({ completed: 0 });
      expect(
        must(await h.store.resumePending({ signal: new AbortController().signal })),
      ).toMatchObject({ completed: 0 });
    });

    it("reports failed and rejected entries per entry too", async () => {
      const journal = createMemoryJournal();
      const h = await harness(protocol, { journal });
      must(await h.store.put(putInput()));
      await journal.put({
        descriptionUrl: "https://evil.example/x",
        shardUrl: "https://evil.example/",
      });
      const result = must(await h.store.resumePending({ shouldResume: () => true }));
      expect(result).toMatchObject({ rejected: 1 });
      expect(result.entries).toEqual([
        { descriptionUrl: "https://evil.example/x", outcome: "rejected" },
      ]);
    });

    it("an abort raised while the veto runs aborts the resume and leaves the entry", async () => {
      const { h, out, journal } = await seeded();
      await interrupt(h, out.descriptionUrl);
      const controller = new AbortController();
      const result = await h.store.resumePending({
        signal: controller.signal,
        shouldResume: () => {
          controller.abort();
          return true;
        },
      });
      expect(result).toEqual({ ok: false, error: { kind: "failed", reason: "aborted" } });
      expect(await journal.list()).toHaveLength(1);
      expect(await allResources(h.storage)).toContain(out.binaryUrl);
    });

    it("an abort stops a veto that never answers", async () => {
      const { h, out, journal } = await seeded();
      await interrupt(h, out.descriptionUrl);
      const controller = new AbortController();
      const asked = deferred();
      const pending = h.store.resumePending({
        signal: controller.signal,
        shouldResume: () => {
          asked.fire();
          return new Promise<boolean>(() => {});
        },
      });
      await asked.promise;
      controller.abort();
      expect(await pending).toEqual({ ok: false, error: { kind: "failed", reason: "aborted" } });
      expect(await journal.list()).toHaveLength(1);
    });

    it("an abort before any entry stops the resume", async () => {
      const { h, out } = await seeded();
      await interrupt(h, out.descriptionUrl);
      const controller = new AbortController();
      controller.abort();
      expect(
        await h.store.resumePending({ signal: controller.signal, shouldResume: () => true }),
      ).toEqual({ ok: false, error: { kind: "failed", reason: "aborted" } });
    });
  });

  describe("withdrawPending", () => {
    it("drops the pending delete of a copy and reports it", async () => {
      const { h, out, journal } = await seeded();
      await interrupt(h, out.descriptionUrl);
      expect(await journal.list()).toHaveLength(1);
      expect(await h.store.withdrawPending(out.descriptionUrl)).toEqual({
        ok: true,
        value: "withdrawn",
      });
      expect(await journal.list()).toEqual([]);
      expect(must(await h.store.resumePending())).toMatchObject({ completed: 0 });
      expect(await allResources(h.storage)).toContain(out.binaryUrl);
      expect(must(await h.store.get(out.descriptionUrl)).binaryUrl).toBe(out.binaryUrl);
    });

    it("is safe when none exists, and leaves other copies' intents alone", async () => {
      const { h, out, journal } = await seeded();
      expect(await h.store.withdrawPending(out.descriptionUrl)).toEqual({
        ok: true,
        value: "none",
      });
      await interrupt(h, out.descriptionUrl);
      expect(await h.store.withdrawPending(`${out.descriptionUrl}-other`)).toEqual({
        ok: true,
        value: "none",
      });
      expect(await journal.list()).toHaveLength(1);
    });

    it("rejects a non-string url and honours an aborted signal", async () => {
      const { h, out } = await seeded();
      expect(await h.store.withdrawPending(undefined as never)).toEqual({
        ok: false,
        error: { kind: "failed", reason: "invalid-input" },
      });
      const controller = new AbortController();
      controller.abort();
      expect(await h.store.withdrawPending(out.descriptionUrl, controller.signal)).toEqual({
        ok: false,
        error: { kind: "failed", reason: "aborted" },
      });
    });

    it("reports a journal that fails as a typed error", async () => {
      const broken: DeleteJournal = {
        put: async () => {},
        delete: async () => {
          throw new Error("disk");
        },
        list: async () => [{ descriptionUrl: "https://x/", shardUrl: "https://x/" }],
      };
      const h = await harness(protocol, { journal: broken });
      expect(await h.store.withdrawPending("https://x/")).toEqual({
        ok: false,
        error: { kind: "failed", reason: "journal" },
      });
    });
  });

  describe("put adopts a copy with a pending delete", () => {
    it("withdraws the intent before it reports success (interrupted delete, saved again, resumed)", async () => {
      const { h, out, journal } = await seeded();
      // 1. a delete of the copy is interrupted
      await interrupt(h, out.descriptionUrl);
      expect(await journal.list()).toHaveLength(1);
      // 2. the same bytes are saved again under another record: the copy is adopted
      const again = must(await h.store.put(putInput({ thumbnail: { bytes: jpeg(1) } })));
      expect(again).toMatchObject({
        descriptionUrl: out.descriptionUrl,
        binaryUrl: out.binaryUrl,
        existed: true,
      });
      expect(await journal.list()).toEqual([]);
      // 3. the next start resumes: nothing is left to finish, and the copy survives
      const restarted = await h.reopen();
      expect(must(await restarted.resumePending())).toMatchObject({ completed: 0, skipped: 0 });
      expect(must(await restarted.get(out.descriptionUrl)).binaryUrl).toBe(out.binaryUrl);
      expect(await allResources(h.storage)).toEqual(
        expect.arrayContaining([out.descriptionUrl, out.binaryUrl, out.thumbnailUrl as string]),
      );
    });

    it("withdraws before success: a journal that cannot withdraw fails the put", async () => {
      const { h, out, journal } = await seeded();
      await interrupt(h, out.descriptionUrl);
      const stuck = await h.reopen({
        journal: {
          put: (entry: DeleteJournalEntry) => journal.put(entry),
          list: () => journal.list(),
          delete: async () => {
            throw new Error("disk");
          },
        },
      });
      const result = await stuck.put(putInput({ thumbnail: { bytes: jpeg(1) } }));
      expect(result).toMatchObject({ ok: false, error: { kind: "failed", reason: "journal" } });
      expect(await journal.list()).toHaveLength(1);
    });

    it.runIf(protocol === "solid")(
      "a put after a delete that got past the description does not lose the new copy",
      async () => {
        const { h, out, journal } = await seeded(undefined, false);
        // The description delete went through but the media delete was interrupted.
        const crashing = await h.reopen({
          storage: intercept(h.storage, (call) => {
            if (call.method === "head") throw offline();
          }),
        });
        await crashing.remove(out.descriptionUrl);
        expect((await journal.list())[0]?.phase).toBe("deleted");
        const again = must(await h.store.put(putInput()));
        expect(await journal.list()).toEqual([]);
        expect(must(await h.store.resumePending())).toMatchObject({ completed: 0 });
        expect(must(await h.store.get(again.descriptionUrl)).binaryUrl).toBe(again.binaryUrl);
        expect(await allResources(h.storage)).toContain(again.binaryUrl);
      },
    );
  });

  describe("remove racing put of the same bytes", () => {
    /** A store whose description delete blocks at the gate; LWS ids are warmed so no lookup waits. */
    async function blocked(
      h: Harness,
      out: PutOutcome,
      log: string[],
      hold: ReturnType<typeof gate>,
    ) {
      const store = await h.reopen({
        storage: intercept(h.storage, async (call) => {
          const url = String(call.args[0]);
          if (call.method === "delete") {
            log.push(`delete ${url}`);
            if (url === out.descriptionUrl) await hold.wait();
          }
          if (call.method === "create") log.push(`create ${url}`);
        }),
      });
      must(await store.get(out.descriptionUrl));
      return store;
    }

    it("serialises them: never a description without its binary, never a false success", async () => {
      const { h, out } = await seeded(undefined, false);
      const hold = gate();
      const log: string[] = [];
      const store = await blocked(h, out, log, hold);
      const removing = store.remove(out.descriptionUrl);
      await hold.hit;
      const arrived = arm();
      const saving = store.put(putInput());
      await queued(arrived);
      // The put has not touched the pod while the remove holds the copy.
      expect(log).toEqual([`delete ${out.descriptionUrl}`]);
      expect(await raced(saving)).toBe("waiting");
      hold.open();
      expect(await removing).toEqual({ ok: true, value: undefined });
      const saved = must(await saving);
      // Whatever the put reports, the pod holds exactly the pair it reports.
      expect(saved.existed).toBe(false);
      const item = must(await store.get(saved.descriptionUrl));
      expect(item.binaryUrl).toBe(saved.binaryUrl);
      expect(await allResources(h.storage)).toContain(saved.binaryUrl);
      expect(await allResources(h.storage)).toContain(saved.descriptionUrl);
      // and the journal is clean, so no later resume can destroy it
      expect(must(await store.resumePending())).toMatchObject({ completed: 0 });
      expect(await allResources(h.storage)).toContain(saved.binaryUrl);
    });

    it("a put that queued behind a remove can be aborted and leaves the others running", async () => {
      const { h, out } = await seeded(undefined, false);
      const hold = gate();
      const store = await blocked(h, out, [], hold);
      const removing = store.remove(out.descriptionUrl);
      await hold.hit;
      const controller = new AbortController();
      const first = arm();
      const aborted = store.put(putInput({ signal: controller.signal }));
      await queued(first);
      const second = arm();
      const third = store.put(putInput());
      await queued(second);
      controller.abort();
      expect(await aborted).toEqual({ ok: false, error: { kind: "failed", reason: "aborted" } });
      hold.open();
      expect(await removing).toEqual({ ok: true, value: undefined });
      const saved = must(await third);
      expect(must(await store.get(saved.descriptionUrl)).binaryUrl).toBe(saved.binaryUrl);
    });

    it("an aborted LAST waiter does not release the copy: a later put still waits for the remove", async () => {
      const { h, out } = await seeded(undefined, false);
      const hold = gate();
      const log: string[] = [];
      const store = await blocked(h, out, log, hold);
      const removing = store.remove(out.descriptionUrl);
      await hold.hit;
      const controller = new AbortController();
      const first = arm();
      const aborted = store.put(putInput({ signal: controller.signal }));
      await queued(first);
      controller.abort();
      expect(await aborted).toEqual({ ok: false, error: { kind: "failed", reason: "aborted" } });
      const second = arm();
      const saving = store.put(putInput());
      await queued(second);
      // It must not have adopted the description the remove is about to delete.
      expect(log).toEqual([`delete ${out.descriptionUrl}`]);
      expect(await raced(saving)).toBe("waiting");
      hold.open();
      expect(await removing).toEqual({ ok: true, value: undefined });
      const saved = must(await saving);
      expect(saved.existed).toBe(false);
      expect(must(await store.get(saved.descriptionUrl)).binaryUrl).toBe(saved.binaryUrl);
      expect(await allResources(h.storage)).toContain(saved.binaryUrl);
    });

    it("withdrawPending waits for the copy's lock too", async () => {
      const { h, out } = await seeded(undefined, false);
      const hold = gate();
      const store = await blocked(h, out, [], hold);
      const removing = store.remove(out.descriptionUrl);
      await hold.hit;
      const withdrawing = store.withdrawPending(out.descriptionUrl);
      expect(await raced(withdrawing)).toBe("waiting");
      hold.open();
      expect(await removing).toEqual({ ok: true, value: undefined });
      // The remove finished and cleared its own entry first.
      expect(await withdrawing).toEqual({ ok: true, value: "none" });
    });

    it("a resume that listed an entry before a put adopted the copy does not act on it", async () => {
      const { h, out, journal } = await seeded(undefined, false);
      await interrupt(h, out.descriptionUrl);
      const hold = gate();
      const listed = deferred();
      let armed = false;
      const store = await h.reopen({
        journal: {
          put: (entry: DeleteJournalEntry) => journal.put(entry),
          // The put's withdrawal is held at the gate while it owns the copy.
          delete: async (url: string) => {
            if (armed) {
              armed = false;
              await hold.wait();
            }
            await journal.delete(url);
          },
          list: async () => {
            const entries = await journal.list();
            listed.fire();
            return entries;
          },
        },
      });
      must(await store.get(out.descriptionUrl));
      armed = true;
      const saving = store.put(putInput());
      await hold.hit;
      // The put holds the copy mid-adoption; the resume lists the journal and queues behind it.
      const resuming = store.resumePending();
      await listed.promise;
      await flush();
      hold.open();
      expect(must(await saving)).toMatchObject({ descriptionUrl: out.descriptionUrl });
      expect(must(await resuming)).toMatchObject({
        completed: 0,
        skipped: 1,
        entries: [{ descriptionUrl: out.descriptionUrl, outcome: "skipped", reason: "withdrawn" }],
      });
      expect(await journal.list()).toEqual([]);
      expect(must(await store.get(out.descriptionUrl)).binaryUrl).toBe(out.binaryUrl);
      expect(await allResources(h.storage)).toContain(out.binaryUrl);
    });
  });
});

describe("lookup adoption (lws)", () => {
  it("withdraws the intent of a copy a findByHash hit adopts", async () => {
    const journal = createMemoryJournal();
    let hit: { descriptionUrl: string } | undefined;
    const h = await harness("lws", { journal, findByHash: async () => hit });
    const out = must(await h.store.put(putInput()));
    hit = { descriptionUrl: out.descriptionUrl };
    await journal.put({
      descriptionUrl: out.descriptionUrl,
      shardUrl: shardOf(h.store),
      binaryUrl: out.binaryUrl,
      phase: "intent",
    });
    const again = must(await h.store.put(putInput()));
    expect(again).toMatchObject({ descriptionUrl: out.descriptionUrl, existed: true });
    expect(await journal.list()).toEqual([]);
    expect(must(await h.store.resumePending())).toMatchObject({ completed: 0 });
    expect(await allResources(h.storage)).toContain(out.binaryUrl);
  });

  it("a hit whose copy a remove is deleting waits, then sees it gone and saves anew", async () => {
    const lookedUp = deferred();
    let hit: { descriptionUrl: string } | undefined;
    const h = await harness("lws", {
      findByHash: async () => {
        if (hit !== undefined) lookedUp.fire();
        return hit;
      },
    });
    const out = must(await h.store.put(putInput()));
    hit = { descriptionUrl: out.descriptionUrl };
    const hold = gate();
    const store = await h.reopen({
      storage: intercept(h.storage, async (call) => {
        if (call.method === "delete" && String(call.args[0]) === out.descriptionUrl) {
          await hold.wait();
        }
      }),
    });
    must(await store.get(out.descriptionUrl));
    const removing = store.remove(out.descriptionUrl);
    await hold.hit;
    const saving = store.put(putInput());
    await lookedUp.promise;
    await flush();
    expect(await raced(saving)).toBe("waiting");
    hold.open();
    expect(await removing).toEqual({ ok: true, value: undefined });
    const saved = must(await saving);
    expect(saved.existed).toBe(false);
    expect(must(await store.get(saved.descriptionUrl)).binaryUrl).toBe(saved.binaryUrl);
    expect(await allResources(h.storage)).toContain(saved.binaryUrl);
  });

  it("fails closed when the adoption cannot withdraw the intent", async () => {
    let hit: { descriptionUrl: string } | undefined;
    const h = await harness("lws", { findByHash: async () => hit });
    const out = must(await h.store.put(putInput()));
    hit = { descriptionUrl: out.descriptionUrl };
    const stuck = await h.reopen({
      journal: {
        put: async () => {},
        list: async () => [],
        delete: async () => {
          throw new Error("disk");
        },
      },
    });
    expect(await stuck.put(putInput())).toMatchObject({
      ok: false,
      error: { kind: "failed", reason: "journal" },
    });
  });
});
