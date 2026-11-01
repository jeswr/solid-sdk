// AUTHORED-BY Codex GPT-6.1-Sol
import { DataFactory } from "n3";
import { describe, expect, it, vi } from "vitest";
import { fixtureFetch } from "../core/fixture-fetch.js";
import { runImport } from "../core/import-runner.js";
import { createFetchPodWriter } from "../core/pod-writer.js";
import {
  type MemoryPod,
  sparseImport,
  TEST_POD_ROOT,
  TEST_PROFILE_DOC,
  TEST_WEBID,
} from "../core/testing.js";
import type { ConnectorState } from "../core/types.js";
import { CLASSES, SoftwareSourceCode } from "../core/vocab.js";
import { createGithubAdapter } from "./adapter.js";
import { type GitHubRepo, REPOS, USER } from "./fixtures.js";

const API = "https://api.github.com";
const DOC = `${TEST_POD_ROOT}integrations/github/work/repositories.ttl`;
const jsonBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const writer = (pod: MemoryPod) =>
  createFetchPodWriter({
    adapterId: "github",
    webId: TEST_WEBID,
    profileDocumentUrl: TEST_PROFILE_DOC,
    podRoot: TEST_POD_ROOT,
    fetch: pod.fetch,
  });

describe("GitHub snapshot verification", () => {
  it("keeps repository 101 when a deletion shifts it behind the page boundary", async () => {
    const repos = Array.from({ length: 101 }, (_, index) => ({
      ...REPOS[0],
      id: index + 1,
      full_name: `synthetic/repository-${index + 1}`,
    }));
    const adapter = createGithubAdapter();
    const initial = await sparseImport(adapter, [
      { url: `${API}/user`, json: USER },
      { url: `${API}/user/repos`, json: repos.slice(0, 100) },
      { url: `${API}/user/repos`, json: repos.slice(100) },
    ]);
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/user") return Response.json(USER);
      if (url.pathname === "/repositories/101") return Response.json(repos[99]);
      if (url.pathname !== "/user/repos") throw new Error(`Unexpected request: ${url}`);
      const page = Number(url.searchParams.get("page"));
      if (page === 2) {
        repos.shift();
        repos[99] = {
          ...repos[99],
          full_name: "synthetic/renamed-repository-101",
          description: null,
          language: null,
          private: true,
          html_url: "https://github.com/synthetic/renamed-repository-101",
          pushed_at: "2026-10-26T12:00:00Z",
        };
      }
      return Response.json(repos.slice((page - 1) * 100, page * 100));
    });
    const report = await runImport({
      adapter,
      mode: "live",
      podWriter: writer(initial.pod),
      state: initial.report.state,
      sourceAuth: { fetch },
    });
    expect(fetch.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
      "/user",
      "/user/repos",
      "/user/repos",
      "/repositories/101",
    ]);
    const dataset = initial.pod.dataset(DOC);
    const survivor = new SoftwareSourceCode(`${DOC}#repo-101`, dataset, DataFactory);
    expect(survivor.types.has(CLASSES.SoftwareSourceCode)).toBe(true);
    expect(survivor.identifier).toBe("101");
    expect(survivor.name).toBe("synthetic/renamed-repository-101");
    expect(survivor.description).toBeUndefined();
    expect(survivor.programmingLanguage).toBeUndefined();
    expect(survivor.codeRepository).toBe("https://github.com/synthetic/renamed-repository-101");
    expect(survivor.sourceUrl).toBe(survivor.codeRepository);
    expect(survivor.dateModified?.toISOString()).toBe("2026-10-26T12:00:00.000Z");
    expect(report.state.counts.items).toBe(102);
  });

  it("removes only missing repositories individually confirmed with 404", async () => {
    const adapter = createGithubAdapter();
    const initial = await sparseImport(adapter, [
      { url: `${API}/user`, json: USER },
      { url: `${API}/user/repos`, json: REPOS },
    ]);
    const routes = fixtureFetch("github", [
      { url: `${API}/user`, json: USER },
      { url: `${API}/user/repos`, json: [REPOS[0]] },
      { url: `${API}/repositories/${REPOS[1].id}`, status: 404, json: null },
      { url: `${API}/repositories/${REPOS[2].id}`, json: REPOS[2] },
    ]);
    const fetch = vi.fn(routes);
    await runImport({
      adapter,
      mode: "live",
      podWriter: writer(initial.pod),
      state: initial.report.state,
      sourceAuth: { fetch },
    });
    const dataset = initial.pod.dataset(DOC);
    expect(new SoftwareSourceCode(`${DOC}#repo-${REPOS[0].id}`, dataset, DataFactory).name).toBe(
      REPOS[0].full_name,
    );
    expect(
      new SoftwareSourceCode(`${DOC}#repo-${REPOS[1].id}`, dataset, DataFactory).types.size,
    ).toBe(0);
    expect(new SoftwareSourceCode(`${DOC}#repo-${REPOS[2].id}`, dataset, DataFactory).name).toBe(
      REPOS[2].full_name,
    );
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  const repo = REPOS[0];
  const baseBytes = jsonBytes(USER) + jsonBytes([]);
  it.each([
    ...[201, 204, 301, 401, 403, 429, 503].map((status) => ({
      name: `HTTP ${status}`,
      status,
      json: repo as GitHubRepo | null,
      limits: undefined,
      requests: 3,
      error: status === 429 ? "Rate limited" : String(status),
    })),
    { name: "invalid JSON shape", status: 200, json: null, requests: 3, error: "repository" },
    {
      name: "mismatched repository ID",
      status: 200,
      json: REPOS[1],
      requests: 3,
      error: "repository",
    },
    {
      name: "request budget",
      status: 200,
      json: repo,
      limits: { maxRequests: 2, maxItems: 10 },
      requests: 2,
      error: "request budget",
    },
    {
      name: "item budget",
      status: 200,
      json: repo,
      limits: { maxRequests: 3, maxItems: 1 },
      requests: 3,
      error: "item budget",
    },
    {
      name: "cumulative byte budget",
      status: 200,
      json: repo,
      limits: { maxRequests: 3, maxItems: 10, maxBytes: baseBytes + jsonBytes(repo) - 1 },
      requests: 3,
      error: "data budget",
    },
  ])("preserves the snapshot and checkpoint on $name during verification", async ({
    status,
    json,
    limits,
    requests,
    error,
  }) => {
    const initial = await sparseImport(createGithubAdapter(), [
      { url: `${API}/user`, json: USER },
      { url: `${API}/user/repos`, json: [repo] },
    ]);
    const previous = { ...initial.report.state, cursor: "previous-checkpoint" };
    const before = initial.pod.get(DOC);
    let state: ConnectorState | undefined;
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/user") return Response.json(USER);
      if (url.pathname === "/user/repos") return Response.json([]);
      expect(url.pathname).toBe(`/repositories/${repo.id}`);
      return status === 204 ? new Response(null, { status }) : Response.json(json, { status });
    });
    await expect(
      runImport({
        adapter: createGithubAdapter(limits),
        mode: "live",
        podWriter: writer(initial.pod),
        state: previous,
        onState: (value) => {
          state = value;
        },
        sourceAuth: { fetch },
      }),
    ).rejects.toThrow(error);
    expect(fetch).toHaveBeenCalledTimes(requests);
    expect(state).toEqual({ ...previous, lastOutcome: "error" });
    expect(initial.pod.get(DOC)).toBe(before);
  });
});
