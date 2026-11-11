// AUTHORED-BY Codex GPT-6.1-Sol
import { fileAdapterById, runFileImport } from "@jeswr/pod-connectors";
import { describe, expect, it } from "vitest";
import { createImportWriter } from "../src/apps/home/components/connect/import-service";
import { loadHistory } from "../src/apps/music/lib/data/history";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";

describe("Spotify history in Music", () => {
  it("reads monthly imported songs unchanged, and re-import adds no plays", async () => {
    const pod = createDemoPod({
      root: DEMO_ROOT,
      seed: await buildDemoSeed(Date.parse("2026-11-01T12:00:00Z")),
    });
    const adapter = fileAdapterById("spotify");
    if (!adapter) throw new Error("Missing Spotify file adapter");
    const rows = [
      {
        endTime: "2026-10-03 13:00",
        msPlayed: 1000,
        artistName: "Fixture Artist",
        trackName: "Fixture Song",
      },
    ];
    const file = new File([JSON.stringify(rows)], "StreamingHistory_music_0.json");
    const session = {
      mode: "demo" as const,
      webId: DEMO_WEBID,
      storageUrl: DEMO_ROOT,
      fetch: pod.fetch,
      displayName: "Fixture",
      subscribe: () => () => {},
      reset: async () => {},
    };
    const run = () =>
      runFileImport({
        adapter,
        file,
        podWriter: createImportWriter(session, "spotify", new AbortController().signal),
      });
    await run();
    const history = await loadHistory(pod.fetch, DEMO_ROOT, new Date("2026-11-01T12:00:00Z"));
    expect(history).toContainEqual(
      expect.objectContaining({
        title: "Fixture Song",
        artist: "Fixture Artist",
        startTime: new Date("2026-10-03T13:00:00.000Z"),
      }),
    );
    await run();
    const again = await loadHistory(pod.fetch, DEMO_ROOT, new Date("2026-11-01T12:00:00Z"));
    expect(again).toHaveLength(history.length);
  });
});
