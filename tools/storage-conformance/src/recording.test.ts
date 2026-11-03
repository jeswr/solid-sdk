// AUTHORED-BY Codex GPT-6.1-Sol
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createReplayFetch, loadFixtures } from "@jeswr/storage-client/testing";
import { afterEach, expect, test, vi } from "vitest";
import { recordingSession } from "./recording.js";

afterEach(() => vi.unstubAllEnvs());

test.each([
  "css",
  "sparq-solid",
] as const)("%s recording isolates runs/scenarios, redacts and replays storage exchanges", async (target) => {
  vi.stubEnv("RECORD", "1");
  const directory = await mkdtemp(join(tmpdir(), "conformance-recording-"));
  const transport = vi.fn<typeof fetch>(async (input) => {
    expect(new Request(input).headers.get("authorization")).toBe("test-only");
    return new Response("public fixture", { headers: { "Set-Cookie": "test-only" } });
  });
  try {
    for (let i = 0; i < 2; i++) {
      const session = recordingSession(target, transport, directory);
      await session.fetch("https://pod.example/", { headers: { Authorization: "test-only" } });
      session.recordScenario("SC-PATCH-rdf");
      await session.fetch("https://pod.example/graph", { headers: { Authorization: "test-only" } });
      expect(session.requestCount()).toBe(2);
      expect(() => session.recordScenario("../escape")).toThrow("Invalid fixture scenario");
    }
    const runs = await readdir(directory);
    expect(runs).toHaveLength(2);
    for (const run of runs) {
      for (const scenario of ["setup", "SC-PATCH-rdf"]) {
        const fixtures = await loadFixtures(join(directory, run, scenario));
        expect(fixtures).toHaveLength(1);
        expect(JSON.stringify(fixtures)).not.toContain("test-only");
        const replay = createReplayFetch(fixtures);
        expect(await (await replay(fixtures[0]?.request.url)).text()).toBe("public fixture");
        replay.assertDone();
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("normal runs count storage calls without creating fixture files", async () => {
  vi.stubEnv("RECORD", "0");
  const directory = await mkdtemp(join(tmpdir(), "conformance-no-recording-"));
  try {
    const transport = vi.fn<typeof fetch>(async () => new Response(null));
    const session = recordingSession("css", transport, directory);
    session.recordScenario("SC-CAP");
    await session.fetch("https://pod.example/");
    expect(transport).toHaveBeenCalledWith("https://pod.example/", undefined);
    expect(session.requestCount()).toBe(1);
    expect(await readdir(directory)).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
