// AUTHORED-BY Codex (GPT-6.1 Sol)
import { dailySeries, insights } from "@jeswr/suite-insights";
import { describe, expect, it, vi } from "vitest";
import { ensureSample as seedHealth } from "../src/apps/health/demo/sample";
import { ensureSample, sampleDays } from "../src/apps/insights/demo/sample";
import { availableSeries } from "../src/apps/insights/lib/presentation";
import {
  healthSource,
  loadSources,
  moneySource,
  musicSource,
} from "../src/apps/insights/lib/sources";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import type { PodSession } from "../src/lib/session/pod-session";

const now = new Date("2026-11-11T12:00:00Z");
function setup() {
  const pod = createDemoPod({ root: "https://insights.test/", latency: 0 });
  const session: PodSession = {
    mode: "demo",
    storageUrl: pod.root,
    webId: `${pod.root}profile#me`,
    displayName: "Fictional sample",
    fetch: pod.fetch,
    subscribe: pod.subscribe,
    reset: async () => {},
  };
  return { pod, session };
}
describe("Insights demo pod", { timeout: 90_000 }, () => {
  it("builds 120 coherent days and finds connections through the production adapters", async () => {
    const { session } = setup();
    expect(sampleDays(now)).toHaveLength(120);
    expect(sampleDays(now)[119]?.day).toBe("2026-11-10");
    const first = ensureSample(session, now);
    expect(ensureSample(session, now)).toBe(first);
    await first;
    const sources = await loadSources({ session, now, timeZone: "UTC" }, [
      healthSource,
      moneySource,
      musicSource,
    ]);
    expect(sources.slice(0, 3).map((s) => s.status)).toEqual(["found", "found", "found"]);
    expect(sources.slice(0, 3).every((s) => s.days >= 120)).toBe(true);
    const series = availableSeries(sources);
    const found = insights(series, { timeZone: "UTC" });
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((f) => f.correlation.n >= 14)).toBe(true);
    const before = series.map((s) => s.points.length);
    await ensureSample({ ...session }, new Date("2026-11-12T12:00:00Z"));
    const after = availableSeries(
      await loadSources({ session, now, timeZone: "UTC" }, [
        healthSource,
        moneySource,
        musicSource,
      ]),
    );
    expect(after.map((s) => s.points.length)).toEqual(before);
  });
  it("preserves existing Health totals and its clinical demo rather than doubling daily readings", async () => {
    const { session } = setup();
    await seedHealth(session, now);
    const context = { session, now, timeZone: "UTC" };
    const prior = await healthSource.read(context);
    const sleepBefore = dailySeries(
      prior.find((s) => s.id === "health.sleep")?.points ?? [],
      "UTC",
      "sum",
    );
    await ensureSample(session, now);
    const after = await healthSource.read(context);
    const sleepAfter = dailySeries(
      after.find((s) => s.id === "health.sleep")?.points ?? [],
      "UTC",
      "sum",
    );
    for (const point of sleepBefore)
      expect(sleepAfter.find((p) => p.day === point.day)).toEqual(point);
    expect(
      (await session.fetch(new URL("health/medications/sample-vitamin.ttl", session.storageUrl)))
        .ok,
    ).toBe(true);
    expect((await session.fetch(new URL("music/sample-complete.ttl", session.storageUrl))).ok).toBe(
      true,
    );
  });
  it("never seeds real or extension sessions", async () => {
    const { session } = setup();
    const fetch = vi.fn();
    await ensureSample({ ...session, mode: "solid", fetch, publicFetch: fetch }, now);
    await ensureSample(
      { ...session, mode: "extension", fetch, publicFetch: fetch, disconnect: async () => {} },
      now,
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it("clears failed flights so a transient failure can be retried", async () => {
    const { session } = setup();
    const fetch = vi.fn(session.fetch).mockResolvedValueOnce(new Response(null, { status: 503 }));
    const transient = { ...session, fetch };
    await expect(ensureSample(transient, now)).rejects.toThrow("check");
    await ensureSample(transient, now);
    expect((await transient.fetch(new URL(".insights-demo-v1.json", session.storageUrl))).ok).toBe(
      true,
    );
  });
});
