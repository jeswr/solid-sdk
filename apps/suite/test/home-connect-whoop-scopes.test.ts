// AUTHORED-BY Claude Opus 5.5
import { runImport } from "@jeswr/pod-connectors";
import { createWhoopAdapter } from "@jeswr/pod-connectors/adapters/whoop";
import { createMemoryPod, TEST_POD_ROOT, TEST_WEBID } from "@jeswr/pod-connectors/testing";
import { NS } from "@jeswr/suite-vocab";
import { expect, it } from "vitest";
import { createImportWriter } from "../src/apps/home/components/connect/import-service";
import { withSelectedScopes } from "../src/apps/home/components/connect/scopes";

const ROOT = TEST_POD_ROOT;
const API = "https://api.prod.whoop.com/developer/v2";
const sleeps = Array.from({ length: 3 }, (_, index) => ({
  id: `night-${index}`,
  start: `2026-06-0${index + 1}T22:00:00.000Z`,
  end: `2026-06-0${index + 2}T06:00:00.000Z`,
  score_state: "SCORED",
  score: { respiratory_rate: 14 },
}));
const cycles = sleeps.map((sleep, index) => ({
  id: index + 1,
  start: sleep.end,
  end: sleep.end.replace(/T06/, "T23"),
  score_state: "SCORED",
  score: { kilojoule: 4184 },
}));

function setup() {
  const pod = createMemoryPod();
  const session = { webId: TEST_WEBID, storageUrl: ROOT, fetch: pod.fetch };
  const requests: URL[] = [];
  const fetch: typeof globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    requests.push(url);
    const records =
      url.pathname === new URL(`${API}/activity/sleep`).pathname
        ? sleeps
        : url.pathname === new URL(`${API}/cycle`).pathname
          ? cycles
          : [];
    return Response.json({ records });
  };
  // One source item per run: every run is a bounded batch.
  const adapter = createWhoopAdapter({ maxItems: 1, maxRequests: 50, maxBytes: 1_000_000 });
  const run = (scopes: readonly string[], cursor?: string) =>
    runImport({
      adapter: withSelectedScopes(adapter, scopes),
      mode: "live",
      sourceAuth: { fetch },
      podWriter: createImportWriter(session, "whoop", new AbortController().signal),
      ...(cursor ? { cursor } : {}),
    });
  const count = (type: string) =>
    pod
      .dataset(`${ROOT}integrations/whoop/health/observations/2026-06.ttl`)
      .getQuads(null, `${NS.RDF}type`, type, null).length;
  return { run, count, requests };
}

it("advances WHOOP batches under a partial scope selection and pins only the completed checkpoint", async () => {
  const { run, count, requests } = setup();
  // Workouts withheld: the run is partial, but each batch must still advance.
  const scopes = ["read:cycles", "read:sleep"];
  let cursor: string | undefined;
  const warnings: boolean[] = [];
  for (let i = 0; i < 6; i++) {
    const report = await run(scopes, cursor);
    warnings.push(Boolean(report.warnings?.length));
    cursor = report.cursor;
  }
  expect(warnings).toEqual([true, true, true, true, true, false]);
  expect(count(`${NS.HEALTH}Observation`)).toBe(6);
  expect(requests.some((url) => url.pathname.endsWith("/workout"))).toBe(false);
  // The traversal began without a checkpoint, so the shared high-water mark is not advanced.
  expect(cursor).toBeUndefined();
});

it("restores the starting high-water cursor when a partial-scope traversal completes", async () => {
  const { run } = setup();
  const scopes = ["read:sleep"];
  let cursor: string | undefined = "2026-05-30T00:00:00.000Z";
  const warnings: boolean[] = [];
  for (let i = 0; i < 3; i++) {
    const report = await run(scopes, cursor);
    warnings.push(Boolean(report.warnings?.length));
    cursor = report.cursor;
  }
  expect(warnings).toEqual([true, true, false]);
  expect(cursor).toBe("2026-05-30T00:00:00.000Z");
});

it("advances the checkpoint when every WHOOP scope is selected, ignoring a stale offline scope", async () => {
  const { run } = setup();
  const scopes = ["read:recovery", "read:cycles", "read:sleep", "read:workout", "offline"];
  let cursor: string | undefined;
  for (let i = 0; i < 7; i++) cursor = (await run(scopes, cursor)).cursor;
  // The newest imported start is the last cycle's.
  expect(cursor).toBe("2026-06-04T06:00:00.000Z");
});
