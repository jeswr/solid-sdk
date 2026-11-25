// AUTHORED-BY Claude Sonnet 5.5
import { describe, expect, it } from "vitest";
import { allResources, harness, intercept, must, putInput, ROOT } from "../test/support.js";

const aborted = { ok: false, error: { kind: "failed", reason: "aborted" } };

describe.each(["solid", "lws"] as const)("ensureLibrary (%s)", (protocol) => {
  /** Mutating calls that reached the pod, recorded by an interceptor. */
  const writes = (log: string[]) => (storage: Parameters<typeof intercept>[0]) =>
    intercept(storage, ({ method, args }) => {
      if (method === "create" || method === "write" || method === "delete") {
        log.push(`${method} ${String(args[0])}`);
      }
    });

  it("creates the library under a private root, writes no media and reports the probe", async () => {
    const asked: string[] = [];
    const h = await harness(protocol, {
      exposure: async (url) => {
        asked.push(url);
        return "private";
      },
    });
    const status = must(await h.store.ensureLibrary());
    expect(status.created).toBe(true);
    expect(status.url).toBe(h.store.library);
    expect(status.url?.startsWith(ROOT)).toBe(true);
    expect(status.exposure).toBe("private");
    expect(status.probed).toBe(status.url);
    // The root first (to decide whether to create), then the new library.
    expect(asked).toEqual([ROOT, status.url]);
    expect(await allResources(h.storage)).toEqual([]);
    // The private answer is cached: the first put does not ask about the library again.
    must(await h.store.put(putInput()));
    expect(asked.filter((url) => url === status.url)).toHaveLength(1);
  });

  it("finds an existing library without creating anything and returns its probe", async () => {
    const first = await harness(protocol);
    must(await first.store.put(putInput()));
    const log: string[] = [];
    const reopened = await first.reopen({
      storage: writes(log)(first.storage),
      exposure: async () => "exposed",
    });
    const status = must(await reopened.ensureLibrary());
    expect(status).toEqual({
      url: first.store.library,
      created: false,
      exposure: "exposed",
      probed: first.store.library,
    });
    expect(log).toEqual([]);
    // Reporting is not enforcing: the put still refuses.
    const refused = await reopened.put(putInput({ seed: 9 }));
    expect(refused).toMatchObject({ ok: false, error: { kind: "exposed" } });
  });

  it("is idempotent: the second call finds what the first created", async () => {
    const h = await harness(protocol);
    const one = must(await h.store.ensureLibrary());
    const log: string[] = [];
    const again = await h.reopen({ storage: writes(log)(h.storage) });
    const two = must(await again.ensureLibrary());
    expect(two.url).toBe(one.url);
    expect(two.created).toBe(false);
    expect(log).toEqual([]);
    // The same store again answers from the library it already knows.
    expect(must(await h.store.ensureLibrary())).toMatchObject({ url: one.url, created: false });
  });

  it("creates nothing when the storage root is exposed, and says so", async () => {
    const log: string[] = [];
    const asked: string[] = [];
    const allow: string[] = [];
    const h = await harness(protocol, {
      exposure: async (url) => {
        asked.push(url);
        return "exposed";
      },
      // An exposed container is never overridable, so this must not even be asked.
      allowUnknownExposureFor: async (url) => {
        allow.push(url);
        return true;
      },
    });
    const guarded = await h.reopen({ storage: writes(log)(h.storage) });
    const status = must(await guarded.ensureLibrary());
    expect(status).toEqual({ url: null, created: false, exposure: "exposed", probed: ROOT });
    expect(guarded.library).toBeNull();
    expect(log).toEqual([]);
    expect(asked).toEqual([ROOT]);
    expect(allow).toEqual([]);
  });

  it("creates nothing under an unknown root unless the caller allows that root", async () => {
    const log: string[] = [];
    const denied = await harness(protocol, { exposure: async () => "unknown" });
    const guarded = await denied.reopen({ storage: writes(log)(denied.storage) });
    expect(must(await guarded.ensureLibrary())).toEqual({
      url: null,
      created: false,
      exposure: "unknown",
      probed: ROOT,
    });
    expect(log).toEqual([]);

    const asked: string[] = [];
    const allowed = await harness(protocol, {
      exposure: async () => "unknown",
      allowUnknownExposureFor: async (url) => {
        asked.push(url);
        return url === ROOT;
      },
    });
    const status = must(await allowed.store.ensureLibrary());
    expect(status.created).toBe(true);
    // The library is a different container: the root's approval does not carry over.
    expect(status.exposure).toBe("unknown");
    expect(status.probed).toBe(status.url);
    expect(asked).toEqual([ROOT]);
  });

  it("never creates under a root whose probe failed, whatever the override says", async () => {
    const failing = [
      undefined,
      async (): Promise<"private"> => {
        throw new Error("probe down");
      },
      (async () => "maybe") as never,
    ];
    for (const exposure of failing) {
      const h = await harness(protocol, { exposure, allowUnknownExposureFor: async () => true });
      const log: string[] = [];
      const guarded = await h.reopen({ storage: writes(log)(h.storage) });
      expect(must(await guarded.ensureLibrary())).toEqual({
        url: null,
        created: false,
        exposure: "unknown",
        probed: ROOT,
      });
      expect(log).toEqual([]);
    }
  });

  it("reads a failed probe of an existing library as unknown", async () => {
    const first = await harness(protocol);
    must(await first.store.put(putInput()));
    const reopened = await first.reopen({
      exposure: async () => {
        throw new Error("probe down");
      },
    });
    expect(must(await reopened.ensureLibrary())).toMatchObject({
      created: false,
      exposure: "unknown",
    });
  });

  it("reports an exposed library after creating it under a private root", async () => {
    const h = await harness(protocol, {
      exposure: async (url) => (url === ROOT ? "private" : "exposed"),
    });
    const status = must(await h.store.ensureLibrary());
    expect(status).toMatchObject({ created: true, exposure: "exposed" });
    expect(await h.store.put(putInput())).toMatchObject({ ok: false, error: { kind: "exposed" } });
  });

  it("honours an abort at every storage call, on the create path and the find path", async () => {
    for (const seeded of [false, true]) {
      const seed = async () => {
        const h = await harness(protocol);
        if (seeded) must(await h.store.put(putInput()));
        return h;
      };
      const counter = await seed();
      let total = 0;
      const counting = await counter.reopen({
        storage: intercept(counter.storage, () => {
          total++;
        }),
      });
      must(await counting.ensureLibrary());
      for (let n = 1; n <= total; n++) {
        const controller = new AbortController();
        const h = await seed();
        let calls = 0;
        const store = await h.reopen({
          storage: intercept(h.storage, () => {
            if (++calls === n) controller.abort();
          }),
        });
        expect(await store.ensureLibrary({ signal: controller.signal }), `n=${n}`).toEqual(aborted);
      }
    }
  });

  it("reports a storage failure as a failed result, never a throw", async () => {
    const h = await harness(protocol);
    const broken = await h.reopen({
      storage: intercept(h.storage, ({ method }) => {
        if (method === "create") throw new Error("disk full");
      }),
    });
    expect(await broken.ensureLibrary()).toMatchObject({ ok: false, error: { kind: "failed" } });
  });
});
