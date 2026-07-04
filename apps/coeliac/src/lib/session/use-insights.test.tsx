// AUTHORED-BY Claude Sonnet 5
/**
 * The session-race guard on the background trigger-class persist (roborev
 * finding, health-data-critical): `useInsights` reads the cache asynchronously,
 * then (best-effort, unawaited) persists any newly-learned per-user lag profile.
 * If the session signs out — running `DiaryStore.purge`, the mandatory
 * privacy wipe — WHILE those reads are still in flight, the stale persist must
 * NOT resurrect data into the just-purged account's scope. This test forces
 * exactly that race with a gated `Kv` and asserts the persist is abandoned.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { DiaryStore } from "../cache/diary-store";
import type { Kv } from "../cache/kv";
import { MemoryKv } from "../cache/kv";
import { anonymousSession, SessionContext, type SessionValue } from "./context";
import { useInsights } from "./use-insights";

const DAY_MS = 24 * 3_600_000;
const BASE = Date.parse("2026-01-01T08:00:00.000Z");

function lactoseMeal(dayOffset: number) {
  const t = new Date(BASE + dayOffset * DAY_MS);
  return {
    kind: "meal" as const,
    ulid: `meal-${dayOffset}`,
    url: `https://alice.example/meals/${dayOffset}.ttl`,
    startTime: t.toISOString(),
    createdAt: t.toISOString(),
    items: [{ name: "latte" }],
    exposures: [{ trigger: "lactose" as const, exposureLevel: "present" as const }],
    signature: "n:latte",
    label: "latte",
    sync: "synced" as const,
  };
}

function symptomAfter(dayOffset: number, hours: number) {
  const t = new Date(BASE + dayOffset * DAY_MS + hours * 3_600_000);
  return {
    kind: "symptom" as const,
    ulid: `sym-${dayOffset}`,
    url: `https://alice.example/symptoms/${dayOffset}.ttl`,
    symptomType: "bloating" as const,
    onset: t.toISOString(),
    createdAt: t.toISOString(),
    severity: 5,
    sync: "synced" as const,
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/**
 * A Kv whose per-key `get` pauses on `gate` — `keys`/`set`/`del` are immediate.
 * Gating only `get` (not `keys`) is deliberate: `DiaryStore.purge` calls
 * `kv.keys` + `kv.del` (never `get`), so it can run to completion independently
 * of a `refresh()` in flight that is blocked reading actual record CONTENT via
 * `get` — exactly the interleaving the session-race guard must handle.
 */
class GatedReadKv implements Kv {
  constructor(
    private readonly inner: Kv,
    private readonly gate: Promise<void>,
  ) {}
  async get<T>(key: string): Promise<T | undefined> {
    await this.gate;
    return this.inner.get<T>(key);
  }
  async set<T>(key: string, value: T): Promise<void> {
    return this.inner.set(key, value);
  }
  async del(key: string): Promise<void> {
    return this.inner.del(key);
  }
  async keys(prefix?: string): Promise<string[]> {
    return this.inner.keys(prefix);
  }
}

describe("useInsights — session-race guard on the background trigger-class persist", () => {
  it("abandons the persist when the session signs out while the cache reads are in flight", async () => {
    const gate = deferred<void>();
    const memKv = new MemoryKv();
    const gatedKv = new GatedReadKv(memKv, gate.promise);
    const webId = "https://alice.example/#me";
    const store = new DiaryStore(gatedKv, webId);

    // Six lactose exposures, each followed ~2h later — dense enough to reach the
    // "likely" tier once analysed (seeding uses the un-gated `set`, so this
    // resolves immediately, before the hook even mounts).
    for (let d = 0; d < 6; d++) {
      await store.putMeal(lactoseMeal(d));
      await store.putSymptom(symptomAfter(d, 2));
    }

    const sessionBox: { current: SessionValue } = {
      current: {
        ...anonymousSession,
        status: "authed",
        webId,
        storageRoot: "https://alice.example/",
        store,
        authedFetch: (...a) => globalThis.fetch(...a),
        publicFetch: (...a) => globalThis.fetch(...a),
      },
    };

    function Wrapper({ children }: { children: ReactNode }) {
      return <SessionContext.Provider value={sessionBox.current}>{children}</SessionContext.Provider>;
    }

    const { result, rerender } = renderHook(() => useInsights(), { wrapper: Wrapper });

    // The mount-effect's refresh() has started and is now awaiting the gated
    // reads — `loaded` is still false. Simulate a sign-out mid-flight: the
    // session's store goes to `null` (mirrors `session-provider.tsx` logout,
    // which nulls `store` in context AFTER `DiaryStore.purge` has already run).
    // Mutating `sessionBox` alone doesn't re-render anything — `rerender()`
    // forces the wrapper (and hence `useSession()`) to pick up the new value,
    // which flips `storeRef.current` via its effect.
    expect(result.current.loaded).toBe(false);
    act(() => {
      sessionBox.current = { ...sessionBox.current, status: "anonymous", webId: null, store: null };
      rerender();
    });

    // Now let the gated reads resolve.
    act(() => {
      gate.resolve();
    });

    await waitFor(() => expect(result.current.loaded).toBe(true));
    // The stale refresh's result must never land either — the session already
    // moved on, so the correctly-cleared anonymous state must not be clobbered
    // by a late-arriving PREVIOUS account's analysis.
    expect(result.current.result).toBeNull();

    // The guard must have skipped the persist: nothing was written back into the
    // (now signed-out) account's scope. (The "control case" test below confirms
    // this SAME seeded diary reaches "likely" and DOES persist when nothing
    // races — so an empty result here is the guard, not an under-powered setup.)
    expect(await store.allTriggerClasses()).toEqual([]);
  });

  it("abandons the persist when `store.purge()` runs mid-flight — even with NO context/re-render change at all", async () => {
    // The tightest reproduction of the roborev finding: `refreshStore.isPurged()`
    // is the PRIMARY guard precisely because it does not depend on React
    // re-rendering/effects at all. Here the session context NEVER changes —
    // only `store.purge()` is called directly, mid-flight, on the SAME store
    // instance/reference the in-flight refresh() captured. A ref-identity-only
    // guard would NOT catch this (the reference never changes); `isPurged()`
    // does.
    const gate = deferred<void>();
    const memKv = new MemoryKv();
    const gatedKv = new GatedReadKv(memKv, gate.promise);
    const webId = "https://alice.example/#me";
    const store = new DiaryStore(gatedKv, webId);
    for (let d = 0; d < 6; d++) {
      await store.putMeal(lactoseMeal(d));
      await store.putSymptom(symptomAfter(d, 2));
    }

    const value: SessionValue = {
      ...anonymousSession,
      status: "authed",
      webId,
      storageRoot: "https://alice.example/",
      store,
      authedFetch: (...a) => globalThis.fetch(...a),
      publicFetch: (...a) => globalThis.fetch(...a),
    };
    function Wrapper({ children }: { children: ReactNode }) {
      return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
    }

    const { result } = renderHook(() => useInsights(), { wrapper: Wrapper });
    expect(result.current.loaded).toBe(false);

    // Purge runs to completion WHILE the refresh's reads are still gated —
    // `purge()`'s own `keys`/`del` calls go through the un-gated `set`/`del`
    // path on `GatedReadKv`, so it completes immediately.
    await store.purge();
    expect(store.isPurged()).toBe(true);

    // Now let the gated reads resolve. The guard abandons the ENTIRE
    // completion (state update AND persist) once `isPurged()` is true, so
    // `loaded` correctly stays `false` forever here — there is no other
    // context/store change in this test to drive a fresh, un-abandoned refresh.
    act(() => {
      gate.resolve();
    });
    // Flush the microtask queue so the abandoned refresh's continuation runs.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.loaded).toBe(false);

    // Nothing was written back after the purge — the guard caught it purely via
    // `isPurged()`, with no context change and no re-render in the picture.
    expect(await store.allTriggerClasses()).toEqual([]);
  });

  it("still persists a learned trigger class when the session has NOT changed (control case)", async () => {
    const gate = deferred<void>();
    const memKv = new MemoryKv();
    const gatedKv = new GatedReadKv(memKv, gate.promise);
    const webId = "https://alice.example/#me";
    const store = new DiaryStore(gatedKv, webId);
    for (let d = 0; d < 6; d++) {
      await store.putMeal(lactoseMeal(d));
      await store.putSymptom(symptomAfter(d, 2));
    }

    const sessionBox: { current: SessionValue } = {
      current: {
        ...anonymousSession,
        status: "authed",
        webId,
        storageRoot: "https://alice.example/",
        store,
        authedFetch: (...a) => globalThis.fetch(...a),
        publicFetch: (...a) => globalThis.fetch(...a),
      },
    };
    function Wrapper({ children }: { children: ReactNode }) {
      return <SessionContext.Provider value={sessionBox.current}>{children}</SessionContext.Provider>;
    }

    const { result } = renderHook(() => useInsights(), { wrapper: Wrapper });
    act(() => {
      gate.resolve();
    });
    await waitFor(() => expect(result.current.loaded).toBe(true));

    const learned = await store.allTriggerClasses();
    expect(learned.map((t) => t.slug)).toContain("lactose");
  });
});
