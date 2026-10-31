// AUTHORED-BY Codex GPT-6.1-Sol
import { isDeepStrictEqual } from "node:util";
import { CapabilitiesError, capabilities, type Features } from "@jeswr/storage-capabilities";
import { createMemoryCache } from "@jeswr/storage-capabilities/cache";
import type {
  ConformanceCase,
  ConformanceTarget,
  FeatureName,
  ReportRow,
  RunningTarget,
  TargetReport,
} from "./types.js";

/** Compare independent target claims with discovery; evidence strings are diagnostics only. */
export function compareClaims(claims: Partial<Features>, features: Features): ReportRow[] {
  return (Object.keys(claims) as (keyof Features)[]).sort().map((key) => {
    const expected = claims[key];
    const actual = features[key];
    const matches =
      typeof expected === "string" || typeof actual === "string"
        ? expected === actual
        : expected !== undefined &&
          expected.state === actual.state &&
          isDeepStrictEqual(expected.detail, actual.detail);
    return {
      test: `claims:${key}`,
      status: matches ? "pass" : "fail",
      feature: key === "protocol" ? null : key,
      reason: matches ? null : `claims-mismatch:${key}`,
    };
  });
}

/** Apply ADR-009 D3. Absence checks fail closed on missing probes and unexpected errors. */
export async function evaluateCase(
  scenario: ConformanceCase,
  target: RunningTarget,
  features: Features,
): Promise<ReportRow[]> {
  const missing = [...new Set(scenario.requires)].filter(
    (key) => features[key].state !== "available",
  );
  if (missing.length) {
    const rows: ReportRow[] = [];
    for (const feature of missing) {
      const check = scenario.checks?.[feature];
      let reason: string | null = null;
      if (!check) reason = `absence-check-missing:${feature}`;
      else {
        try {
          const supported = await check(target);
          if (supported !== false) reason = `advertisement-missing:${feature}`;
        } catch {
          reason = `absence-check-failed:${feature}`;
        }
      }
      rows.push({
        test: `${scenario.id}:absence:${feature}`,
        status: reason ? "fail" : "pass",
        feature,
        reason,
      });
    }
    rows.push({
      test: scenario.id,
      status: rows.some((row) => row.status === "fail") ? "fail" : "skip",
      feature: missing[0] as FeatureName,
      reason: `target-lacks:${missing.join(",")}`,
    });
    return rows;
  }
  try {
    // No skip return value is accepted for an advertised capability.
    const result: unknown = await scenario.run(target);
    if (result !== undefined) throw new Error("Invalid scenario result");
    return [
      { test: scenario.id, status: "pass", feature: scenario.requires[0] ?? null, reason: null },
    ];
  } catch {
    return [
      {
        test: scenario.id,
        status: "fail",
        feature: scenario.requires[0] ?? null,
        reason: "assertion-failed",
      },
    ];
  }
}

/** Start, discover, execute all scenarios, and stop even after discovery/assertion failures. */
export async function runTarget(
  target: ConformanceTarget,
  scenarios: readonly ConformanceCase[],
): Promise<TargetReport> {
  const report: TargetReport = { target: target.name, results: [] };
  let running: RunningTarget;
  try {
    running = await target.start();
  } catch (error) {
    report.results.push({
      test: "start",
      status: "fail",
      feature: null,
      reason: error instanceof CapabilitiesError ? `start-failed:${error.code}` : "start-failed",
    });
    return report;
  }
  try {
    const features = running.resolveFeatures
      ? await running.resolveFeatures()
      : await capabilities(running.root, { fetch: running.fetch, cache: createMemoryCache() });
    report.results.push(...compareClaims(running.claims, features));
    for (const scenario of scenarios) {
      report.results.push(...(await evaluateCase(scenario, running, features)));
    }
  } catch {
    report.results.push({
      test: "discovery",
      status: "fail",
      feature: null,
      reason: "discovery-failed",
    });
  } finally {
    try {
      await running.stop();
    } catch {
      report.results.push({ test: "stop", status: "fail", feature: null, reason: "stop-failed" });
    }
  }
  return report;
}
