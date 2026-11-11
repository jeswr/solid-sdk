// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, test, vi } from "vitest";
import { compareClaims, evaluateCase, runTarget } from "./harness.js";
import { memoryTarget } from "./targets/memory.js";
import type { ConformanceCase, RunningTarget } from "./types.js";

async function fixture() {
  const running = await memoryTarget("lws", { versioning: false }).start();
  const features = await running.resolveFeatures?.();
  if (!features) throw new Error("Missing fixture features");
  return { running, features };
}

describe("capability gating", () => {
  test.each([
    "unknown",
    "unavailable",
  ] as const)("skips %s only after proving absence", async (state) => {
    const { running, features } = await fixture();
    features.move.state = state;
    const run = vi.fn();
    const check = vi.fn(async () => false);
    const rows = await evaluateCase(
      { id: "requires-move", requires: ["move"], checks: { move: check }, run },
      running,
      features,
    );
    expect(rows).toEqual([
      { test: "requires-move:absence:move", status: "pass", feature: "move", reason: null },
      { test: "requires-move", status: "skip", feature: "move", reason: "target-lacks:move" },
    ]);
    expect(check).toHaveBeenCalledWith(running);
    expect(run).not.toHaveBeenCalled();
  });

  test("an unadvertised operation that works fails the companion and scenario", async () => {
    const { running, features } = await fixture();
    const rows = await evaluateCase(
      {
        id: "missing-advertisement",
        requires: ["move"],
        checks: { move: async () => true },
        run: vi.fn(),
      },
      running,
      features,
    );
    expect(rows.map((row) => row.status)).toEqual(["fail", "fail"]);
    expect(rows[0]?.reason).toBe("advertisement-missing:move");
  });

  test("missing, throwing and non-boolean absence probes fail closed", async () => {
    const { running, features } = await fixture();
    const scenario: ConformanceCase = { id: "probe", requires: ["move"], run: vi.fn() };
    expect((await evaluateCase(scenario, running, features))[0]?.reason).toBe(
      "absence-check-missing:move",
    );
    scenario.checks = {
      move: async () => {
        throw new Error("secret must not escape");
      },
    };
    expect((await evaluateCase(scenario, running, features))[0]?.reason).toBe(
      "absence-check-failed:move",
    );
    scenario.checks = {
      move: (async () => undefined) as unknown as NonNullable<ConformanceCase["checks"]>["move"],
    };
    expect((await evaluateCase(scenario, running, features))[0]?.reason).toBe(
      "advertisement-missing:move",
    );
  });

  test("checks every missing requirement once and leaves available ones alone", async () => {
    const { running, features } = await fixture();
    const move = vi.fn(async () => false);
    const versioning = vi.fn(async () => true);
    const pagination = vi.fn(async () => true);
    const rows = await evaluateCase(
      {
        id: "multiple",
        requires: ["move", "versioning", "move", "pagination"],
        checks: { move, versioning, pagination },
        run: vi.fn(),
      },
      running,
      features,
    );
    expect(rows).toHaveLength(3);
    expect(move).toHaveBeenCalledTimes(1);
    expect(versioning).toHaveBeenCalledTimes(1);
    expect(pagination).not.toHaveBeenCalled();
    expect(rows[2]?.status).toBe("fail");
    expect(rows[2]?.reason).toBe("target-lacks:move,versioning");
  });

  test("advertised features must run and cannot return or throw a skip", async () => {
    const { running, features } = await fixture();
    features.move.state = "available";
    const scenario: ConformanceCase = {
      id: "available",
      requires: ["move"],
      run: vi.fn(async () => {}),
    };
    expect((await evaluateCase(scenario, running, features))[0]?.status).toBe("pass");
    scenario.run = async () => {
      throw new Error("skip");
    };
    expect((await evaluateCase(scenario, running, features))[0]?.status).toBe("fail");
    scenario.run = (async () => "skip") as unknown as ConformanceCase["run"];
    expect((await evaluateCase(scenario, running, features))[0]?.status).toBe("fail");
  });

  test("claims compare protocol, state and detail independently of evidence", async () => {
    const { features } = await fixture();
    expect(compareClaims({}, features)).toEqual([]);
    expect(
      compareClaims(
        { protocol: "lws", move: { ...features.move, evidence: "independent" } },
        features,
      ).every((row) => row.status === "pass"),
    ).toBe(true);
    expect(
      compareClaims(
        {
          protocol: "solid",
          move: { ...features.move, state: "available" },
          pagination: { ...features.pagination, detail: undefined },
        },
        features,
      )
        .filter((row) => row.status === "fail")
        .map((row) => row.reason),
    ).toEqual(["claims-mismatch:move", "claims-mismatch:protocol"]);
    expect(
      compareClaims(
        { move: { ...features.move, detail: { ...features.move.detail, native: true } } },
        features,
      )[0]?.status,
    ).toBe("fail");
    expect(compareClaims({ move: undefined }, features)[0]?.status).toBe("fail");
  });
});

describe("lifecycle", () => {
  test("records runner discovery separately and selects each scenario before executing it", async () => {
    const { running, features } = await fixture();
    const events: string[] = [];
    running.recordScenario = (name) => {
      events.push(name);
    };
    running.resolveFeatures = async () => {
      events.push("resolve");
      return features;
    };
    await runTarget({ name: "recording", start: async () => running }, [
      {
        id: "SC-first",
        requires: [],
        run: async () => {
          events.push("first");
        },
      },
      {
        id: "SC-second",
        requires: [],
        run: async () => {
          events.push("second");
        },
      },
    ]);
    expect(events).toEqual(["discovery", "resolve", "SC-first", "first", "SC-second", "second"]);
  });

  test("continues after an assertion failure, stops once and redacts errors", async () => {
    const { running } = await fixture();
    const stop = vi.fn(running.stop);
    const report = await runTarget({ name: "fake", start: async () => ({ ...running, stop }) }, [
      {
        id: "fails",
        requires: [],
        run: async () => {
          throw new Error("credential");
        },
      },
      { id: "passes", requires: [], run: async () => {} },
    ]);
    expect(report.results.slice(-2).map((row) => row.status)).toEqual(["fail", "pass"]);
    expect(JSON.stringify(report)).not.toContain("credential");
    expect(stop).toHaveBeenCalledTimes(1);
  });

  test("start, discovery and stop failures are reported", async () => {
    const { running } = await fixture();
    const failed = async () => {
      throw new Error("private error");
    };
    expect((await runTarget({ name: "bad", start: failed }, [])).results[0]?.reason).toBe(
      "start-failed",
    );
    const stop = vi.fn(failed);
    const report = await runTarget(
      { name: "bad", start: async () => ({ ...running, resolveFeatures: failed, stop }) },
      [],
    );
    expect(report.results.map((row) => row.reason)).toEqual(["discovery-failed", "stop-failed"]);
    expect(stop).toHaveBeenCalledOnce();
  });

  test("network targets use real capabilities discovery with an isolated cache", async () => {
    const { running } = await fixture();
    const transport: typeof fetch = vi.fn(async () => new Response(null, { status: 404 }));
    const network: RunningTarget = { ...running, fetch: transport, resolveFeatures: undefined };
    const report = await runTarget({ name: "network", start: async () => network }, []);
    expect(transport).toHaveBeenCalled();
    expect(report.results[0]?.reason).toBe("discovery-failed");
  });
});
