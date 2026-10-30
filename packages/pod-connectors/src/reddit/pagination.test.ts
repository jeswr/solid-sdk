// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import type { RunLimits } from "../core/budget.js";
import { fixtureFetch } from "../core/fixture-fetch.js";
import { runImport } from "../core/import-runner.js";
import { createFetchPodWriter } from "../core/pod-writer.js";
import {
  createMemoryPod,
  demoImport,
  TEST_POD_ROOT,
  TEST_PROFILE_DOC,
  TEST_WEBID,
} from "../core/testing.js";
import type { ConnectorState, FixtureRoute } from "../core/types.js";
import { createRedditAdapter, redditAdapter } from "./adapter.js";
import { ME, SAVED, SUBSCRIBED } from "./fixtures.js";

const api = "https://oauth.reddit.com";
const savedUrl = `${api}/user/${ME.name}/saved`;
const subsUrl = `${api}/subreddits/mine/subscriber`;
const identity = { url: `${api}/api/v1/me`, json: ME };
const listing = (children: unknown[], after: string | null = null) => ({
  data: { children, after },
});
const jsonBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const previous: ConnectorState = {
  connectedAt: "2026-01-01T00:00:00.000Z",
  lastSync: "2026-01-02T00:00:00.000Z",
  cursor: "t3_previous",
  lastOutcome: "success",
  counts: { documents: 2, items: 7, skipped: 0 },
};

async function expectFailure(
  limits: RunLimits | undefined,
  routes: readonly FixtureRoute[],
  error: string,
  requests: number,
) {
  const pod = createMemoryPod();
  const fetch = vi.fn(fixtureFetch("reddit", routes));
  let state: ConnectorState | undefined;
  await expect(
    runImport({
      adapter: createRedditAdapter(limits),
      mode: "live",
      state: previous,
      onState: (value) => {
        state = value;
      },
      sourceAuth: { fetch },
      podWriter: createFetchPodWriter({
        adapterId: "reddit",
        webId: TEST_WEBID,
        profileDocumentUrl: TEST_PROFILE_DOC,
        podRoot: TEST_POD_ROOT,
        fetch: pod.fetch,
      }),
    }),
  ).rejects.toThrow(error);
  expect(fetch).toHaveBeenCalledTimes(requests);
  expect(state).toEqual({ ...previous, lastOutcome: "error" });
  expect(pod.get(`${TEST_POD_ROOT}integrations/reddit/social/communities.ttl`)).toBeUndefined();
}

describe.each(["saved posts", "communities"])("Reddit %s pagination bounds", (target) => {
  const saved = target === "saved posts";
  const url = saved ? savedUrl : subsUrl;
  const child = saved ? SAVED.data.children[0] : SUBSCRIBED.data.children[0];
  const prefix: FixtureRoute[] = saved
    ? [identity]
    : [identity, { url: savedUrl, json: listing([SAVED.data.children[0]]) }];
  const suffix: FixtureRoute[] = saved ? [{ url: subsUrl, json: SUBSCRIBED }] : [];
  const pages: FixtureRoute[] = [
    { url, json: listing([child, null], "page-2") },
    { url, json: listing([child, null], "page-3") },
    { url, json: listing([]) },
  ];
  const prefixBytes = prefix.reduce((total, route) => total + jsonBytes(route.json), 0);

  it.each([
    {
      limits: { maxRequests: prefix.length + 2, maxItems: 100 },
      error: "request budget",
    },
    {
      limits: { maxRequests: 10, maxItems: prefix.length + 2 },
      error: "item budget",
    },
    {
      limits: {
        maxRequests: 10,
        maxItems: 100,
        maxBytes: prefixBytes + jsonBytes(pages[0].json) + jsonBytes(pages[1].json) - 1,
      },
      error: "data budget",
    },
  ])("retains the checkpoint on $error with distinct cursors", async ({ limits, error }) => {
    await expectFailure(limits, [...prefix, ...pages, ...suffix], error, prefix.length + 2);
  });

  it("still rejects repeated cursors", async () => {
    await expectFailure(
      undefined,
      [...prefix, { url, json: listing([], "loop") }, ...suffix],
      "missing or repeated page cursor",
      prefix.length + 2,
    );
  });
});

describe("Reddit shared run budget", () => {
  it.each([
    { limits: { maxRequests: 0, maxItems: 10 }, error: "request budget", requests: 0 },
    { limits: { maxRequests: 10, maxItems: 0 }, error: "item budget", requests: 1 },
    {
      limits: { maxRequests: 10, maxItems: 10, maxBytes: jsonBytes(ME) - 1 },
      error: "data budget",
      requests: 1,
    },
  ])("charges the identity lookup to the $error", async ({ limits, error, requests }) => {
    await expectFailure(limits, redditAdapter.fixtures(), error, requests);
  });

  it("counts all page entries before filtering at the saved checkpoint", async () => {
    await expectFailure(
      { maxRequests: 10, maxItems: 3 },
      [
        identity,
        {
          url: savedUrl,
          json: listing([
            SAVED.data.children[0],
            {
              ...SAVED.data.children[0],
              data: { ...SAVED.data.children[0].data, name: previous.cursor },
            },
            null,
          ]),
        },
        { url: subsUrl, json: listing([]) },
      ],
      "item budget",
      2,
    );
  });

  it("accepts exact limits and starts a fresh budget each run of the same adapter", async () => {
    const maxBytes = redditAdapter
      .fixtures()
      .reduce((total, route) => total + jsonBytes(route.json), 0);
    const adapter = createRedditAdapter({ maxRequests: 3, maxItems: 5, maxBytes });
    const first = await demoImport(adapter);
    const second = await demoImport(adapter, { pod: first.pod });
    expect(first.report.state?.counts.items).toBe(4);
    expect(second.report.state?.counts.items).toBe(4);
    expect(second.report.cursor).toBe(SAVED.data.children[0].data.name);
  });
});
