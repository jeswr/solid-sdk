// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex
import { describe, expect, it } from "vitest";
import { drivePreferencesSchema } from "../../src/apps/drive/lib/model/prefs.js";

describe("Drive preferences", () => {
  it("defaults a fresh account and round-trips the JSON blob", () => {
    const prefs = drivePreferencesSchema.parse({});
    expect(prefs).toEqual({
      starred: [],
      openedShared: [],
      view: "list",
      sort: { key: "name", dir: "asc" },
      columns: {},
    });
    expect(drivePreferencesSchema.parse(JSON.parse(JSON.stringify(prefs)))).toEqual(prefs);
    prefs.starred.push("https://other.example/file");
    expect(drivePreferencesSchema.parse({}).starred).toEqual([]);
  });

  it.each(["name", "size", "modified"])("preserves stored preferences sorted by %s", (key) => {
    const stored = {
      starred: ["https://other.example/file"],
      openedShared: [
        {
          url: "https://other.example/folder/",
          name: "Shared folder",
          type: "folder",
          modified: "2026-10-25T09:00:00Z",
          openedAt: "2026-10-25T10:00:00+01:00",
        },
        {
          url: "https://other.example/report",
          type: "file",
          contentType: "text/plain",
          size: 0,
          modified: "2026-10-25T09:00:00+01:00",
          openedAt: "2026-10-25T10:00:00+01:00",
        },
      ],
      view: "grid",
      sort: { key, dir: "desc" },
      columns: { name: 300, size: 80 },
    };
    expect(drivePreferencesSchema.parse(JSON.parse(JSON.stringify(stored)))).toEqual(stored);
  });

  it.each([
    { starred: ["javascript:alert(1)"] },
    { starred: ["relative/file"] },
    { openedShared: [{ url: "ftp://pod.example/file", openedAt: "2026-10-25T10:00:00Z" }] },
    { openedShared: [{ url: "https://pod.example/file", openedAt: "yesterday" }] },
    ...[
      { contentType: 7 },
      { size: -1 },
      { size: 0.5 },
      { size: Number.POSITIVE_INFINITY },
      { modified: "yesterday" },
    ].map((metadata) => ({
      openedShared: [
        { url: "https://pod.example/file", openedAt: "2026-10-25T10:00:00Z", ...metadata },
      ],
    })),
    { view: "tiles" },
    { sort: { key: "owner", dir: "asc" } },
    { sort: { key: "name", dir: "up" } },
    { columns: { name: -1 } },
    { columns: { name: 0 } },
    { columns: { name: Number.POSITIVE_INFINITY } },
  ])("rejects malformed stored preferences %j", (value) => {
    expect(drivePreferencesSchema.safeParse(value).success).toBe(false);
  });
});
