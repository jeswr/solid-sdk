// AUTHORED-BY Codex GPT-6.1-Sol
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
import { createGithubAdapter } from "./adapter.js";
import { USER } from "./fixtures.js";

const first = Array.from({ length: 100 }, (_, id) => ({ id, name: `repository-${id}` }));

describe("GitHub pagination bounds", () => {
  it.each([
    {
      limits: { maxRequests: 2, maxItems: 200 },
      second: [{ id: 100 }],
      error: "request budget",
      requests: 2,
    },
    {
      limits: { maxRequests: 3, maxItems: 101 },
      second: [{ id: 100 }],
      error: "item budget",
      requests: 3,
    },
    { limits: { maxRequests: 3, maxItems: 0 }, second: [], error: "item budget", requests: 1 },
    { limits: undefined, second: first, error: "non-advancing repository page", requests: 3 },
    { limits: undefined, second: [first[0]], error: "non-advancing repository page", requests: 3 },
  ])("retains the checkpoint on $error ($requests requests)", async ({
    limits,
    second,
    error,
    requests,
  }) => {
    const adapter = createGithubAdapter(limits);
    const pod = createMemoryPod();
    const previous: ConnectorState = {
      connectedAt: "2026-01-01T00:00:00.000Z",
      lastSync: "2026-01-02T00:00:00.000Z",
      cursor: "previous-checkpoint",
      lastOutcome: "success",
      counts: { documents: 2, items: 7, skipped: 0 },
    };
    let state: ConnectorState | undefined;
    let page = 0;
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = new URL(String(input));
      const json = url.pathname === "/user" ? USER : page++ === 0 ? first : second;
      return Response.json(json);
    });
    await expect(
      runImport({
        adapter,
        mode: "live",
        state: previous,
        onState: (value) => {
          state = value;
        },
        sourceAuth: { fetch },
        podWriter: createFetchPodWriter({
          adapterId: "github",
          webId: TEST_WEBID,
          profileDocumentUrl: TEST_PROFILE_DOC,
          podRoot: TEST_POD_ROOT,
          fetch: pod.fetch,
        }),
      }),
    ).rejects.toThrow(error);
    expect(fetch).toHaveBeenCalledTimes(requests);
    expect(state).toEqual({ ...previous, lastOutcome: "error" });
    expect(pod.get(`${TEST_POD_ROOT}integrations/github/work/repositories.ttl`)).toBeUndefined();
  });

  it("starts a fresh budget each run of the same adapter", async () => {
    const adapter = createGithubAdapter({ maxRequests: 2, maxItems: 4 });
    const first = await demoImport(adapter);
    const second = await demoImport(adapter, { pod: first.pod });
    expect(second.report.state?.counts.items).toBe(4);
  });

  it("still skips a malformed record on a short final page", async () => {
    const { report } = await sparseImport(createGithubAdapter(), [
      { url: "https://api.github.com/user", json: USER },
      { url: "https://api.github.com/user/repos", json: [null] },
    ]);
    expect(report.skipped).toBe(1);
  });
});
