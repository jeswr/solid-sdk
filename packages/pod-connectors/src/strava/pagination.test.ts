// AUTHORED-BY Codex GPT-6.1-Sol
import { DataFactory } from "n3";
import { describe, expect, it, vi } from "vitest";
import { runImport } from "../core/import-runner.js";
import { createFetchPodWriter } from "../core/pod-writer.js";
import {
  createMemoryPod,
  demoImport,
  sparseImport,
  TEST_POD_ROOT,
  TEST_PROFILE_DOC,
  TEST_WEBID,
} from "../core/testing.js";
import type { ConnectorState } from "../core/types.js";
import { ExerciseAction } from "../core/vocab.js";
import { createStravaAdapter, stravaAdapter } from "./adapter.js";

const url = "https://www.strava.com/api/v3/athlete/activities";
const doc = `${TEST_POD_ROOT}integrations/strava/fitness/activities.ttl`;
const first = [
  { id: 1, name: "Newest", start_date: "2026-06-06T00:00:00Z" },
  { id: 2, name: "Boundary", start_date: "2026-06-05T00:00:00Z" },
];
const previous: ConnectorState = {
  connectedAt: "2026-01-01T00:00:00.000Z",
  lastSync: "2026-06-01T00:00:00.000Z",
  cursor: String(Date.parse("2026-06-01T00:00:00Z") / 1000),
  lastOutcome: "success",
  counts: { documents: 2, items: 7, skipped: 0 },
};
const writer = (pod: ReturnType<typeof createMemoryPod>) =>
  createFetchPodWriter({
    adapterId: "strava",
    webId: TEST_WEBID,
    profileDocumentUrl: TEST_PROFILE_DOC,
    podRoot: TEST_POD_ROOT,
    fetch: pod.fetch,
  });

describe("Strava timestamp windows", () => {
  it("deduplicates overlap and includes unseen activities tied at the boundary", async () => {
    const { pod, report } = await sparseImport(stravaAdapter, [
      { url, json: first },
      { url, json: [first[1], { ...first[1], id: 3, name: "Timestamp tie" }] },
      { url, json: [{ id: 4, name: "Older", start_date: "2026-06-04T00:00:00Z" }] },
      { url, json: [] },
    ]);
    expect(report.state?.counts.items).toBe(4);
    expect(report.cursor).toBe(String(Date.parse(first[0].start_date) / 1000));
    const dataset = pod.dataset(doc);
    expect(new ExerciseAction(`${doc}#activity-3`, dataset, DataFactory).name).toBe(
      "Timestamp tie",
    );
    expect(new ExerciseAction(`${doc}#activity-4`, dataset, DataFactory).name).toBe("Older");
  });

  it("fetches the 101st activity despite deletion between requests and never checkpoints past an unresolved overlap", async () => {
    const activities = Array.from({ length: 101 }, (_, i) => ({
      id: i + 1,
      start_date: new Date(Date.UTC(2026, 5, 6, 0, 0, 101 - i)).toISOString(),
    }));
    const pod = createMemoryPod();
    const requests: URL[] = [];
    const returned: number[][] = [];
    let state: ConnectorState | undefined;
    await expect(
      runImport({
        adapter: stravaAdapter,
        mode: "live",
        podWriter: writer(pod),
        state: previous,
        onState: (value) => {
          state = value;
        },
        sourceAuth: {
          fetch: async (input) => {
            const request = new URL(String(input));
            requests.push(request);
            if (requests.length === 2) activities.shift(); // Delete an activity from the first response.
            const before = Number(request.searchParams.get("before") ?? Number.POSITIVE_INFINITY);
            const after = Number(request.searchParams.get("after") ?? 0);
            const page = Number(request.searchParams.get("page") ?? 1);
            const batch = activities
              .filter((a) => {
                const epoch = Date.parse(a.start_date) / 1000;
                return epoch < before && epoch > after;
              })
              .slice((page - 1) * 100, page * 100);
            returned.push(batch.map((a) => a.id));
            return Response.json(batch);
          },
        },
      }),
    ).rejects.toThrow("non-advancing activity window");
    expect(returned[0]).toHaveLength(100);
    expect(returned[1]).toEqual([100, 101]);
    expect(requests[1].searchParams.get("before")).toBe(
      String(Date.parse(activities[98].start_date) / 1000 + 1),
    );
    expect(requests.every((request) => !request.searchParams.has("page"))).toBe(true);
    expect(state).toEqual({ ...previous, lastOutcome: "error" });
    expect(pod.get(doc)).toBeUndefined();
  });

  it.each([
    {
      limits: { maxRequests: 1, maxItems: 10 },
      second: [{ id: 3 }],
      error: "request budget",
      requests: 1,
    },
    {
      limits: { maxRequests: 3, maxItems: 2 },
      second: [{ id: 3 }],
      error: "item budget",
      requests: 2,
    },
    { limits: undefined, second: first, error: "non-advancing activity window", requests: 2 },
    { limits: undefined, second: [first[1]], error: "non-advancing activity window", requests: 2 },
    {
      limits: undefined,
      second: [{ id: 3, start_date: "2026-06-07T00:00:00Z" }],
      error: "non-advancing activity window",
      requests: 2,
    },
  ])("retains the checkpoint on $error ($requests requests)", async ({
    limits,
    second,
    error,
    requests,
  }) => {
    const adapter = createStravaAdapter(limits);
    const pod = createMemoryPod();
    let state: ConnectorState | undefined;
    let page = 0;
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json(page++ === 0 ? first : second),
    );
    await expect(
      runImport({
        adapter,
        mode: "live",
        podWriter: writer(pod),
        state: previous,
        onState: (value) => {
          state = value;
        },
        sourceAuth: { fetch },
      }),
    ).rejects.toThrow(error);
    expect(fetch).toHaveBeenCalledTimes(requests);
    expect(state).toEqual({ ...previous, lastOutcome: "error" });
    expect(pod.get(doc)).toBeUndefined();
  });

  it("starts a fresh budget each run of the same adapter", async () => {
    const adapter = createStravaAdapter({ maxRequests: 2, maxItems: 3 });
    const first = await demoImport(adapter);
    const second = await demoImport(adapter, { pod: first.pod });
    expect(second.report.state?.counts.items).toBe(3);
  });

  it("still skips a malformed record before an empty window", async () => {
    const { report } = await sparseImport(stravaAdapter, [
      { url, json: [null] },
      { url, json: [] },
    ]);
    expect(report.skipped).toBe(1);
    expect(report.cursor).toBeUndefined();
  });
});
