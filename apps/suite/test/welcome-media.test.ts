// AUTHORED-BY Codex GPT-6.1-Sol
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { durationLabel, emptyManifest, parseManifest } from "../src/welcome/media";

const clip = {
  id: "try-drive",
  title: "Try Drive",
  summary: "Find a file.",
  file: "drive.mp4",
  captions: "drive.vtt",
  duration: 32,
};
describe("welcome media manifest", () => {
  it("loads the supplied tour, captions and narrated feature clips, leaving the feedback video pending", () => {
    const manifest = parseManifest(
      JSON.parse(readFileSync(new URL("../public/media/manifest.json", import.meta.url), "utf8")),
    );
    expect(manifest.videos.tour?.file).toBe("suite-walkthrough.mp4");
    expect(manifest.videos.tour?.captions).toBe("suite-walkthrough.vtt");
    expect(manifest.videos.feedback?.file).toBeUndefined();
    expect(manifest.clips.map((c) => c.id)).toEqual(["notes", "chat", "search"]);
    for (const c of manifest.clips) expect(c.captions).toBe(`suite-clip-${c.id}.vtt`);
  });
  it("admits only listed clips with local files, distinct safe ids and text", () => {
    const manifest = parseManifest({
      videos: { tour: { ...clip, file: "https://other.example/video.mp4" } },
      clips: [
        clip,
        clip,
        { ...clip, id: "../../bad" },
        { ...clip, id: "missing", file: "" },
        { ...clip, id: "external", file: "//example.org/video" },
        { ...clip, id: "bad-title", title: null },
        null,
      ],
    });
    expect(manifest.clips).toEqual([clip]);
    expect(manifest.videos.tour?.file).toBeUndefined();
    expect(parseManifest(null)).toEqual(emptyManifest);
    expect(parseManifest({ clips: "invalid" })).toEqual({
      videos: { tour: undefined, feedback: undefined },
      clips: [],
    });
  });
  it("formats loaded durations in plain English", () => {
    expect(durationLabel(32)).toBe("32 seconds");
    expect(durationLabel(201)).toBe("3 minutes");
  });
});
