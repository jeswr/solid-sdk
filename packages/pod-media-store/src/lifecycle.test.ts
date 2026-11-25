// AUTHORED-BY Claude Sonnet 5.5
import { type Entry, type StorageClient, StorageError } from "@jeswr/storage-client";
import { describe, expect, it } from "vitest";
import {
  allResources,
  CLASS,
  harness,
  intercept,
  jpeg,
  lwsTypeIndex,
  must,
  type Protocol,
  putInput,
  ROOT,
  shardOf,
  text,
} from "../test/support.js";
import { exposureFromOwnerOnly, openMediaStore } from "./index.js";

const OTHER_CLASS = "https://example.org/ns#Other";
const taken = () => new StorageError("conflict", { url: "x:", method: "PUT", status: 412 });
const denied = () => new StorageError("forbidden", { url: "x:", method: "POST" });

/** A listing that reports nothing for the given containers (a server that hides or lags). */
function blind(storage: StorageClient, ...containers: string[]): StorageClient {
  return new Proxy(storage, {
    get(target, property) {
      const value = Reflect.get(target, property) as unknown;
      if (typeof value !== "function") return value;
      if (property !== "listAll") return value.bind(target);
      return (container: string, options: never) =>
        containers.includes(container)
          ? (async function* (): AsyncGenerator<Entry> {})()
          : target.listAll(container, options);
    },
  });
}

describe("openMediaStore", () => {
  it("validates its options and reports a typed error", async () => {
    const h = await harness("solid");
    const bad: Array<Record<string, unknown>> = [
      { classes: [] },
      { defaultContainerName: "" },
      { defaultContainerName: "." },
      { defaultContainerName: ".." },
      { defaultContainerName: "a/b" },
      { defaultContainerName: "a?b" },
      { defaultContainerName: "a\nb" },
      { maxBytes: 0 },
      { maxThumbnailBytes: 1.5 },
      { maxDescriptionBytes: -1 },
      { concurrency: 0 },
      { updateAttempts: 0 },
    ];
    for (const override of bad) {
      expect(await openMediaStore({ ...h.options, ...override })).toEqual({
        ok: false,
        error: { kind: "failed", reason: "invalid-input" },
      });
    }
    const lws = await harness("lws");
    expect(await openMediaStore({ ...h.options, features: lws.storage.features })).toEqual({
      ok: false,
      error: { kind: "failed", reason: "invalid-input" },
    });
  });

  it("reports discovery failures and honours an aborted signal", async () => {
    const h = await harness("solid");
    const typeIndex = {
      ...h.options.typeIndex,
      findAll: async () => {
        throw new StorageError("network", { url: "x:", method: "GET" });
      },
    };
    expect(await openMediaStore({ ...h.options, typeIndex })).toEqual({
      ok: false,
      error: { kind: "offline", reason: "storage" },
    });
    const controller = new AbortController();
    controller.abort();
    expect(await openMediaStore({ ...h.options, signal: controller.signal })).toEqual({
      ok: false,
      error: { kind: "failed", reason: "aborted" },
    });
  });

  it("takes only credible containers from the index, the first class that has one, sorted", async () => {
    const h = await harness("solid");
    await h.storage.create(ROOT, null, { kind: "container", name: "b-lib" });
    await h.storage.create(ROOT, null, { kind: "container", name: "a-lib" });
    const answers = new Map<string, string[]>([
      [
        CLASS,
        [
          `${ROOT}x.png`,
          ROOT,
          "https://evil.example/alice/lib/",
          `${ROOT}lib/?x=1`,
          `${ROOT}b-lib/`,
          `${ROOT}a-lib/`,
        ],
      ],
      [OTHER_CLASS, [`${ROOT}b-lib/`]],
    ]);
    const typeIndex = { ...h.options.typeIndex, findAll: async () => answers };
    const store = must(await openMediaStore({ ...h.options, typeIndex }));
    expect(store.library).toBe(`${ROOT}a-lib/`);
    answers.set(CLASS, [`${ROOT}x.png`]);
    const second = must(
      await openMediaStore({ ...h.options, typeIndex, classes: [CLASS, OTHER_CLASS] }),
    );
    expect(second.library).toBe(`${ROOT}b-lib/`);
    answers.clear();
    expect(must(await openMediaStore({ ...h.options, typeIndex })).library).toBeNull();
  });
});

describe("library creation (Solid)", () => {
  it("adopts a container that exists under the default name but was never registered", async () => {
    const h = await harness("solid");
    const existing = await h.storage.create(ROOT, null, { kind: "container", name: "media" });
    const out = must(await h.store.put(putInput()));
    expect(h.store.library).toBe(existing.url);
    expect(out.descriptionUrl.startsWith(existing.url)).toBe(true);
    expect((await h.reopen()).library).toBe(existing.url);
  });

  it("fails closed when the default name is taken but the container cannot be found", async () => {
    const h = await harness("solid");
    await h.storage.create(ROOT, null, { kind: "container", name: "media" });
    const hidden = await h.reopen({ storage: blind(h.storage, ROOT) });
    expect(await hidden.put(putInput())).toEqual({
      ok: false,
      error: { kind: "failed", reason: "name-unavailable" },
    });
  });

  it("passes other create failures through as typed errors", async () => {
    const h = await harness("solid", {}, (s) =>
      intercept(s, (call) => {
        if (call.method === "create" && (call.args[2] as { kind?: string })?.kind === "container") {
          throw denied();
        }
      }),
    );
    expect(await h.store.put(putInput())).toEqual({
      ok: false,
      error: { kind: "forbidden", reason: "storage" },
    });
    expect(await allResources(h.storage)).toEqual([]);
  });

  it("settles a race on a new shard by using the container the other writer made", async () => {
    let raced = false;
    const h = await harness("solid", {}, (s) =>
      intercept(s, async (call) => {
        const opts = (call.args[2] ?? {}) as { kind?: string; name?: string };
        if (call.method === "create" && opts.name === "2026" && !raced) {
          raced = true;
          await s.create(call.args[0] as string, null, { kind: "container", name: "2026" });
        }
      }),
    );
    expect((await h.store.put(putInput())).ok).toBe(true);
  });

  it("fails when a shard name is taken and cannot be found, and on any other shard error", async () => {
    const h = await harness("solid");
    must(await h.store.put(putInput({ createdAt: new Date("2026-05-01T00:00:00Z") })));
    const library = h.store.library as string;
    const lying = await h.reopen({
      storage: intercept(blind(h.storage, `${library}2026/`), (call) => {
        if (call.method === "create" && (call.args[2] as { name?: string })?.name === "06") {
          throw taken();
        }
      }),
    });
    expect(
      await lying.put(putInput({ seed: 2, createdAt: new Date("2026-06-01T00:00:00Z") })),
    ).toEqual({
      ok: false,
      error: { kind: "failed", reason: "name-unavailable" },
    });
    const refusing = await h.reopen({
      storage: intercept(h.storage, (call) => {
        if (call.method === "create" && (call.args[2] as { name?: string })?.name === "07") {
          throw denied();
        }
      }),
    });
    expect(
      await refusing.put(putInput({ seed: 3, createdAt: new Date("2026-07-01T00:00:00Z") })),
    ).toEqual({ ok: false, error: { kind: "forbidden", reason: "storage" } });
  });
});

describe("library creation (LWS)", () => {
  it("declares the class when it creates the container, and tolerates a hint-less index", async () => {
    const h = await harness("lws");
    must(await h.store.put(putInput()));
    const entries: Entry[] = [];
    for await (const entry of h.storage.listAll(ROOT)) entries.push(entry);
    expect(entries.find((entry) => entry.url === h.store.library)?.types).toContain(CLASS);
    expect((await h.reopen()).library).toBe(h.store.library);

    const bare = await harness("lws", {
      typeIndex: { ...lwsTypeIndex(await harnessStorage()), register: async () => undefined },
    });
    expect((await bare.store.put(putInput())).ok).toBe(true);
  });
});

async function harnessStorage(): Promise<StorageClient> {
  return (await harness("lws")).storage;
}

describe("exposure", () => {
  const exposure =
    (answer: "private" | "exposed" | "unknown", urls: string[] = []) =>
    async (url: string) => {
      urls.push(url);
      return answer;
    };
  const refused = (reason: string) => ({
    ok: false,
    error: { kind: "exposed", reason },
  });

  it.each([
    "solid",
    "lws",
  ] as const)("refuses to write when the library is exposed (%s)", async (protocol: Protocol) => {
    const seen: string[] = [];
    const h = await harness(protocol, { exposure: exposure("exposed", seen) });
    expect(await h.store.put(putInput())).toEqual(refused("library-exposed"));
    // The library is probed after it is created (empty) and before anything is written into it.
    expect(seen).toEqual([h.store.library]);
    expect(await allResources(h.storage)).toEqual([]);
  });

  it("probes each shard before writing into it, and refuses an exposed one", async () => {
    const seen: string[] = [];
    const h = await harness("solid", {
      exposure: async (url) => {
        seen.push(url);
        return url.endsWith("/2026/05/") ? "exposed" : "private";
      },
    });
    expect(await h.store.put(putInput())).toEqual(refused("library-exposed"));
    expect(seen).toEqual([h.store.library, `${h.store.library}2026/05/`]);
    expect(await allResources(h.storage)).toEqual([]);
    must(await h.store.put(putInput({ createdAt: new Date("2026-04-02T00:00:00Z") })));
  });

  it("caches a private answer per container, for the ttl only", async () => {
    const seen: string[] = [];
    let clock = 0;
    const h = await harness("solid", { exposure: exposure("private", seen), now: () => clock });
    must(await h.store.put(putInput()));
    must(await h.store.put(putInput({ seed: 2 })));
    const library = h.store.library as string;
    expect(seen).toEqual([library, `${library}2026/05/`]);
    must(await h.store.put(putInput({ seed: 3, createdAt: new Date("2026-04-02T00:00:00Z") })));
    expect(seen).toEqual([library, `${library}2026/05/`, `${library}2026/04/`]);
    clock = 120_000;
    must(await h.store.put(putInput({ seed: 4 })));
    expect(seen).toHaveLength(5);
    expect(must(await h.store.checkExposure())).toBe("private");
    expect(seen).toHaveLength(6);
  });

  it("stops writing as soon as the library is later found to be exposed", async () => {
    let answer: "private" | "exposed" = "private";
    let clock = 0;
    const h = await harness("solid", { exposure: async () => answer, now: () => clock });
    must(await h.store.put(putInput()));
    answer = "exposed";
    clock = 61_000;
    expect(await h.store.put(putInput({ seed: 2 }))).toEqual(refused("library-exposed"));
    expect(await allResources(h.storage)).toHaveLength(2);
  });

  it("F-09: anything but a clear private answer refuses", async () => {
    for (const probe of [
      exposure("unknown"),
      async () => {
        throw new Error("probe failed with token=secret");
      },
      async () => "public" as never,
      async () => undefined as never,
    ]) {
      const strict = await harness("solid", { exposure: probe });
      const result = await strict.store.put(putInput());
      expect(result).toEqual(refused("exposure-unknown"));
      expect(JSON.stringify(result)).not.toContain("secret");
      expect(must(await strict.store.checkExposure())).toBe("unknown");
      expect(await allResources(strict.storage)).toEqual([]);
    }
    const none = await harness("solid", { exposure: undefined });
    expect(await none.store.put(putInput())).toEqual(refused("exposure-unknown"));
    expect(must(await none.store.checkExposure())).toBe("unknown");
  });

  describe.each(["solid", "lws"] as const)("allowUnknownExposureFor (%s)", (protocol) => {
    it("lets only an exact unknown answer through, for the containers it approves", async () => {
      const asked: string[] = [];
      const h = await harness(protocol, {
        exposure: exposure("unknown"),
        allowUnknownExposureFor: (url) => {
          asked.push(url);
          return true;
        },
      });
      expect(must(await h.store.put(putInput())).existed).toBe(false);
      // The library and the month shard were each asked about, by their own URL.
      expect(asked).toHaveLength(2);
      expect(new Set(asked).size).toBe(2);
      expect(asked[0]).toBe(h.store.library);
    });

    it("accepts an asynchronous override", async () => {
      const h = await harness(protocol, {
        exposure: exposure("unknown"),
        allowUnknownExposureFor: async () => true,
      });
      expect((await h.store.put(putInput())).ok).toBe(true);
    });

    it("can never override an exposed answer, and is not even asked", async () => {
      const asked: string[] = [];
      const h = await harness(protocol, {
        exposure: exposure("exposed"),
        allowUnknownExposureFor: (url) => {
          asked.push(url);
          return true;
        },
      });
      expect(await h.store.put(putInput())).toEqual(refused("library-exposed"));
      expect(asked).toEqual([]);
      expect(await allResources(h.storage)).toEqual([]);
    });

    it("is not asked about a missing, failing or nonsensical probe, which stay refused", async () => {
      for (const probe of [
        undefined,
        async () => {
          throw new Error("probe failed");
        },
        async () => "public" as never,
      ]) {
        const asked: string[] = [];
        const h = await harness(protocol, {
          exposure: probe,
          allowUnknownExposureFor: (url) => {
            asked.push(url);
            return true;
          },
        });
        expect(await h.store.put(putInput())).toEqual(refused("exposure-unknown"));
        expect(asked).toEqual([]);
        expect(await allResources(h.storage)).toEqual([]);
      }
    });

    it("counts a throw, a rejection or any non-boolean answer as false", async () => {
      for (const override of [
        () => {
          throw new Error("override failed with token=secret");
        },
        async () => {
          throw new Error("override rejected");
        },
        () => "yes" as never,
        () => 1 as never,
        () => undefined as never,
        () => null as never,
        () => ({}) as never,
        async () => "true" as never,
        () => false,
      ]) {
        const h = await harness(protocol, {
          exposure: exposure("unknown"),
          allowUnknownExposureFor: override,
        });
        const result = await h.store.put(putInput());
        expect(result).toEqual(refused("exposure-unknown"));
        expect(JSON.stringify(result)).not.toContain("secret");
        expect(await allResources(h.storage)).toEqual([]);
      }
    });

    it("the shipped adapter: a throwing or rejecting check is not overridable, a completed unknown is", async () => {
      const asked: string[] = [];
      const allow = (url: string) => {
        asked.push(url);
        return true;
      };
      for (const check of [
        () => {
          throw new Error("sync failure");
        },
        async () => {
          throw new Error("network down");
        },
      ]) {
        const h = await harness(protocol, {
          exposure: exposureFromOwnerOnly(check),
          allowUnknownExposureFor: allow,
        });
        expect(await h.store.put(putInput())).toEqual(refused("exposure-unknown"));
        expect(asked).toEqual([]);
        expect(await allResources(h.storage)).toEqual([]);
        // The on-demand check reports the failure as unknown, never private.
        expect(must(await h.store.checkExposure())).toBe("unknown");
      }
      const completed = await harness(protocol, {
        exposure: exposureFromOwnerOnly(async () => ({
          private: false,
          reasons: [{ reason: "unknown" }],
        })),
        allowUnknownExposureFor: allow,
      });
      expect((await completed.store.put(putInput())).ok).toBe(true);
      expect(asked.length).toBeGreaterThan(0);
      const exposedByAdapter = await harness(protocol, {
        exposure: exposureFromOwnerOnly(async () => ({
          private: false,
          reasons: [{ reason: "non-owner" }],
        })),
        allowUnknownExposureFor: allow,
      });
      asked.length = 0;
      expect(await exposedByAdapter.store.put(putInput())).toEqual(refused("library-exposed"));
      expect(asked).toEqual([]);
    });

    it("is decided per container and never carried from one to the next", async () => {
      const asked: string[] = [];
      let approved = (_url: string) => true;
      const h = await harness(protocol, {
        exposure: exposure("unknown"),
        allowUnknownExposureFor: (url) => {
          asked.push(url);
          return approved(url);
        },
      });
      // The library is approved but the shard below it is not: the answer for one does not
      // extend to the other.
      let library = "";
      approved = (url) => {
        library ||= url;
        return url === library;
      };
      expect(await h.store.put(putInput())).toEqual(refused("exposure-unknown"));
      expect(asked).toHaveLength(2);
      expect(asked[0]).toBe(library);
      expect(asked[1]).not.toBe(library);
      expect(await allResources(h.storage)).toEqual([]);
      // And the other way round: a shard approval does not approve the library.
      asked.length = 0;
      approved = (url) => url !== library;
      expect(await h.store.put(putInput({ seed: 2 }))).toEqual(refused("exposure-unknown"));
      expect(asked).toEqual([library]);
    });

    it("is asked again for every write: an approval is never cached", async () => {
      const asked: string[] = [];
      const h = await harness(protocol, {
        exposure: exposure("unknown"),
        allowUnknownExposureFor: (url) => {
          asked.push(url);
          return true;
        },
      });
      must(await h.store.put(putInput()));
      const first = asked.length;
      must(await h.store.put(putInput({ seed: 2 })));
      expect(asked.length).toBe(first * 2);
    });

    it("stops waiting for the override when the call is aborted", async () => {
      const controller = new AbortController();
      const h = await harness(protocol, {
        exposure: exposure("unknown"),
        allowUnknownExposureFor: () =>
          new Promise<boolean>(() => {
            controller.abort();
          }),
      });
      expect(await h.store.put(putInput({ signal: controller.signal }))).toEqual({
        ok: false,
        error: { kind: "failed", reason: "aborted" },
      });
    });
  });

  it("M43: an unknown answer is never cached as private", async () => {
    const seen: string[] = [];
    const h = await harness("solid", {
      exposure: exposure("unknown", seen),
      allowUnknownExposureFor: () => true,
    });
    must(await h.store.put(putInput()));
    const first = seen.length;
    must(await h.store.put(putInput({ seed: 2 })));
    expect(seen.length).toBe(first * 2);
  });

  it("probes the storage root when there is no library yet", async () => {
    const seen: string[] = [];
    const h = await harness("solid", { exposure: exposure("private", seen) });
    expect(must(await h.store.checkExposure())).toBe("private");
    expect(seen).toEqual([ROOT]);
  });

  it("propagates an abort that happens during the probe", async () => {
    const controller = new AbortController();
    const h = await harness("solid", {
      exposure: async () => {
        controller.abort();
        throw new Error("late");
      },
    });
    expect(await h.store.put(putInput({ signal: controller.signal }))).toEqual({
      ok: false,
      error: { kind: "failed", reason: "aborted" },
    });
  });
});

describe.each(["solid", "lws"] as const)("odd storage behaviour (%s)", (protocol) => {
  it("works when the server sends no content type for a description", async () => {
    const h = await harness(protocol);
    const out = must(await h.store.put(putInput()));
    const noType = await h.reopen({
      storage: new Proxy(h.storage, {
        get(target, property) {
          const value = Reflect.get(target, property) as unknown;
          if (typeof value !== "function") return value;
          if (property !== "read") return value.bind(target);
          return async (...args: never[]) => ({
            ...(await target.read(...args)),
            contentType: null,
          });
        },
      }),
    });
    expect(must(await noType.get(out.descriptionUrl)).value.name).toBe("first");
  });

  it("counts a description whose locate throws as unparseable", async () => {
    const h = await harness(protocol);
    must(await h.store.put(putInput()));
    const strict = await h.reopen({
      locate: () => {
        throw new Error("bad");
      },
    });
    expect(must(await strict.list()).skipped.unparseable).toBe(1);
  });

  it("an unreadable parent never makes a foreign URL look like part of the library", async () => {
    const h = await harness(protocol);
    const out = must(await h.store.put(putInput()));
    const secret = await h.storage.create(ROOT, "x", { name: "secret", contentType: "text/plain" });
    expect(await h.store.get(secret.url)).toEqual({
      ok: false,
      error: { kind: "not-found", reason: "out-of-scope" },
    });
    expect(await h.store.get(`${ROOT}nothing`)).toEqual({
      ok: false,
      error: { kind: "not-found", reason: "out-of-scope" },
    });
    expect(h.store.isInsideLibrary(secret.url)).toBe(false);
    expect(h.store.isInsideLibrary(out.binaryUrl)).toBe(true);
    expect(await text(h.storage, out.descriptionUrl)).toContain("first");
  });

  it("adoption fails loudly when the existing description cannot be read", async () => {
    if (protocol === "lws") return;
    const h = await harness(protocol);
    const first = must(await h.store.put(putInput({ thumbnail: { bytes: jpeg(1) } })));
    await h.storage.delete(first.descriptionUrl, {
      ifMatch: (await h.storage.head(first.descriptionUrl)).etag as string,
    });
    await h.storage.create(shardOf(h.store), "", {
      name: first.sha256,
      contentType: "text/turtle",
    });
    const forbidden = await h.reopen({
      storage: intercept(h.storage, (call) => {
        if (call.method === "read" && String(call.args[0]).endsWith(`/${first.sha256}`)) {
          throw denied();
        }
      }),
    });
    expect(await forbidden.put(putInput({ thumbnail: { bytes: jpeg(1) } }))).toEqual({
      ok: false,
      error: { kind: "forbidden", reason: "storage" },
    });
  });

  it("falls back to If-Match * when the create response carries no usable ETag", async () => {
    const h = await harness(
      protocol,
      {},
      (s) =>
        new Proxy(s, {
          get(target, property) {
            const value = Reflect.get(target, property) as unknown;
            if (typeof value !== "function") return value;
            if (property !== "create") return value.bind(target);
            return async (...args: Parameters<StorageClient["create"]>) => ({
              ...(await target.create(...args)),
              etag: null,
            });
          },
        }),
    );
    const out = must(await h.store.put(putInput()));
    expect(must(await h.store.get(out.descriptionUrl)).value.name).toBe("first");
  });
});

describe("LWS parent lookups", () => {
  it("a network failure while proving containment is offline, not a silent refusal", async () => {
    const h = await harness("lws");
    const out = must(await h.store.put(putInput()));
    const reopened = await h.reopen({
      storage: new Proxy(h.storage, {
        get(target, property) {
          const value = Reflect.get(target, property) as unknown;
          if (typeof value !== "function") return value;
          if (property !== "parentOf") return value.bind(target);
          return async () => {
            throw new StorageError("network", { url: "x:", method: "HEAD" });
          };
        },
      }),
    });
    expect(await reopened.get(out.descriptionUrl)).toEqual({
      ok: false,
      error: { kind: "offline", reason: "storage" },
    });
  });

  it("a container inside a shard is not a description", async () => {
    const h = await harness("lws");
    must(await h.store.put(putInput()));
    const nested = await h.storage.create(shardOf(h.store), null, {
      kind: "container",
      name: "nested",
    });
    expect(await h.store.get(nested.url)).toEqual({
      ok: false,
      error: { kind: "failed", reason: "not-a-document" },
    });
  });

  it("resume survives a failing containment proof and an abort mid-way", async () => {
    const h = await harness("lws");
    const out = must(await h.store.put(putInput()));
    const journal = (await import("./journal.js")).createMemoryJournal();
    await journal.put({
      descriptionUrl: out.descriptionUrl,
      shardUrl: shardOf(h.store),
      binaryUrl: out.binaryUrl,
    });
    const flaky = await h.reopen({
      journal,
      storage: new Proxy(h.storage, {
        get(target, property) {
          const value = Reflect.get(target, property) as unknown;
          if (typeof value !== "function") return value;
          if (property !== "parentOf") return value.bind(target);
          return async () => {
            throw new StorageError("network", { url: "x:", method: "HEAD" });
          };
        },
      }),
    });
    expect(must(await flaky.resumePending())).toMatchObject({
      completed: 0,
      failed: 1,
      rejected: 0,
    });
    const controller = new AbortController();
    const aborting = await h.reopen({
      journal,
      storage: new Proxy(h.storage, {
        get(target, property) {
          const value = Reflect.get(target, property) as unknown;
          if (typeof value !== "function") return value;
          if (property !== "parentOf") return value.bind(target);
          return async (...args: never[]) => {
            controller.abort();
            return target.parentOf(...args);
          };
        },
      }),
    });
    expect(await aborting.resumePending(controller.signal)).toEqual({
      ok: false,
      error: { kind: "failed", reason: "aborted" },
    });
  });
});
