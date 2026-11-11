// AUTHORED-BY Codex (GPT-6.1 Sol)
import { afterEach, expect, it, vi } from "vitest";

const fixture = {
  semanticSegments: [
    {
      startTime: "2026-11-11T09:00:00Z",
      endTime: "2026-11-11T10:00:00Z",
      visit: { topCandidate: { placeName: "Park", placeLocation: { latLng: "50,-1" } } },
    },
  ],
};
afterEach(() => vi.unstubAllGlobals());
it("the worker returns structured-clone-safe results and friendly parse failures", async () => {
  const context = {
    postMessage: vi.fn(),
    onmessage: null as null | ((event: MessageEvent<File>) => Promise<void>),
  };
  vi.stubGlobal("self", context);
  await import("../src/apps/places/lib/timeline.worker");
  await context.onmessage?.(
    new MessageEvent("message", { data: new File([JSON.stringify(fixture)], "Timeline.json") }),
  );
  expect(context.postMessage.mock.lastCall?.[0].data.visits).toHaveLength(1);
  await context.onmessage?.(
    new MessageEvent("message", { data: new File(["{"], "Timeline.json") }),
  );
  expect(context.postMessage.mock.lastCall?.[0].error).toContain("valid JSON");
  await context.onmessage?.(
    new MessageEvent<File>("message", {
      data: { text: () => Promise.reject("Unreadable") } as File,
    }),
  );
  expect(context.postMessage.mock.lastCall?.[0].error).toBe("Could not read this file.");
});
