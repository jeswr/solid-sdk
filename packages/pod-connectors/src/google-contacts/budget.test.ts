// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { MAX_JSON_BYTES } from "../core/budget.js";
import { runImport } from "../core/import-runner.js";
import { createFetchPodWriter } from "../core/pod-writer.js";
import {
  createMemoryPod,
  fixtureFetch,
  TEST_POD_ROOT,
  TEST_PROFILE_DOC,
  TEST_WEBID,
} from "../core/testing.js";
import type { FixtureRoute } from "../core/types.js";
import { googleContactsAdapter } from "./adapter.js";
import { CONNECTIONS, PEOPLE, PEOPLE_API } from "./fixtures.js";

// Exercise real budget accounting with small limits, without thousands of requests or records.
vi.mock("../core/budget.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../core/budget.js")>();
  return {
    ...actual,
    RunBudget: class extends actual.RunBudget {
      constructor(id: string) {
        super(id, { maxRequests: 3, maxItems: 3 });
      }
    },
  };
});

const ROOT = `${TEST_POD_ROOT}integrations/google-contacts/`;
const route = (json: unknown, status = 200): FixtureRoute => ({ url: PEOPLE_API, json, status });

async function setup() {
  const pod = createMemoryPod();
  const podFetch = vi.fn(pod.fetch);
  const podWriter = createFetchPodWriter({
    adapterId: "google-contacts",
    webId: TEST_WEBID,
    profileDocumentUrl: TEST_PROFILE_DOC,
    podRoot: TEST_POD_ROOT,
    fetch: podFetch,
  });
  const initial = await runImport({ adapter: googleContactsAdapter, mode: "demo", podWriter });
  const before = pod
    .urls()
    .filter((url) => url.startsWith(`${ROOT}contacts/`))
    .map((url) => [url, pod.get(url)] as const);
  podFetch.mockClear();
  const onState = vi.fn();
  function run(fetch: typeof globalThis.fetch) {
    return runImport({
      adapter: googleContactsAdapter,
      mode: "live",
      podWriter,
      state: initial.state,
      onState,
      sourceAuth: { fetch },
    });
  }
  function unchanged() {
    for (const [url, body] of before) expect(pod.get(url)).toBe(body);
    expect(
      podFetch.mock.calls.filter(
        ([url, init]) =>
          String(url).startsWith(`${ROOT}contacts/`) &&
          ["PUT", "DELETE"].includes(init?.method ?? "GET"),
      ),
    ).toHaveLength(0);
    expect(onState.mock.calls[0]?.[0]).toMatchObject({
      cursor: initial.cursor,
      lastOutcome: "error",
      counts: initial.state?.counts,
    });
  }
  return { run, unchanged };
}

describe("Google Contacts source budgets", () => {
  it("bounds pages even when every token is distinct", async () => {
    const { run, unchanged } = await setup();
    const api = vi.fn(
      fixtureFetch("google-contacts", [
        route({ nextPageToken: "one" }),
        route({ nextPageToken: "two" }),
        route({ nextPageToken: "three" }),
      ]),
    );
    await expect(run(api)).rejects.toThrow("request budget");
    expect(api).toHaveBeenCalledTimes(3);
    unchanged();
  });

  it("counts buffered people across pages before deduplication or mutations", async () => {
    const { run, unchanged } = await setup();
    const api = fixtureFetch("google-contacts", [
      route({ connections: [PEOPLE[0], PEOPLE[0]], nextPageToken: "next" }),
      route({
        connections: [PEOPLE[0], { resourceName: "people/c102", metadata: { deleted: true } }],
        nextSyncToken: "unused",
      }),
    ]);
    await expect(run(api)).rejects.toThrow("item budget");
    unchanged();
  });

  it("retains item accounting when an expired token discards partial pages", async () => {
    const { run, unchanged } = await setup();
    const api = vi.fn(
      fixtureFetch("google-contacts", [
        route({ connections: PEOPLE, nextPageToken: "expired" }),
        route({}, 410),
        route(CONNECTIONS),
      ]),
    );
    await expect(run(api)).rejects.toThrow("item budget");
    expect(api).toHaveBeenCalledTimes(3);
    unchanged();
  });

  it("retains request accounting across the full-sync retry", async () => {
    const { run, unchanged } = await setup();
    const api = vi.fn(
      fixtureFetch("google-contacts", [
        route({ nextPageToken: "expired" }),
        route({}, 410),
        route({ nextPageToken: "full" }),
      ]),
    );
    await expect(run(api)).rejects.toThrow("request budget");
    expect(api).toHaveBeenCalledTimes(3);
    unchanged();
  });

  it("accepts a completed import at the request and item limits", async () => {
    const { run } = await setup();
    const api = vi.fn(
      fixtureFetch("google-contacts", [
        route({ connections: [PEOPLE[0]], nextPageToken: "one" }),
        route({ connections: [PEOPLE[1]], nextPageToken: "two" }),
        route({ connections: [{ resourceName: "people/new" }], nextSyncToken: "bounded" }),
      ]),
    );
    expect((await run(api)).cursor).toBe("bounded");
    expect(api).toHaveBeenCalledTimes(3);
  });

  it.each([200, 400])("caps JSON bytes including error-detail responses (%s)", async (status) => {
    const { run, unchanged } = await setup();
    const api = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ...CONNECTIONS,
            error: { details: [{ reason: "EXPIRED_SYNC_TOKEN" }] },
          }),
          { status, headers: { "content-length": String(MAX_JSON_BYTES + 1) } },
        ),
    );
    await expect(run(api)).rejects.toThrow("too large");
    expect(api).toHaveBeenCalledTimes(1);
    unchanged();
  });
});
