// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { createRegistry, IntegrationError } from "@jeswr/pod-connectors";
import { describe, expect, it } from "vitest";
import {
  catalogue,
  destinationsFor,
  filterCatalogue,
} from "../src/apps/home/lib/connect/catalogue";
import {
  addedCopy,
  connectorErrorCopy,
  progressCopy,
  relativeSync,
  scopeLabel,
  skippedCopy,
  stepCopy,
} from "../src/apps/home/lib/connect/copy";

describe("connector catalogue", () => {
  it("uses configured registry status, file metadata and the coming-soon flag", () => {
    const entries = catalogue(createRegistry());
    expect(entries.find((entry) => entry.id === "spotify")).toMatchObject({
      status: "demo",
      tier: "A",
      domains: ["media"],
      logoId: "spotify",
    });
    expect(entries.find((entry) => entry.id === "netflix")).toMatchObject({
      status: "import",
      tier: "C",
      whatYouGet: "Your viewing history, saved as watch records in Media.",
    });
    expect(entries.some((entry) => entry.tier === "B" && entry.status !== "cli-only")).toBe(false);
    expect(
      catalogue(createRegistry(), true)
        .filter((entry) => entry.tier === "B" && entry.status !== "cli-only")
        .every((entry) => entry.status === "soon"),
    ).toBe(true);
    expect(
      catalogue(createRegistry({ spotify: { clientId: "public" } })).find(
        (entry) => entry.id === "spotify",
      )?.status,
    ).toBe("connect");
    expect(
      catalogue(createRegistry({ github: { clientId: "public" } })).find(
        (entry) => entry.id === "github",
      )?.status,
    ).toBe("demo");
    const registry = createRegistry();
    const unknown = {
      id: "new-file-adapter",
      name: "New file adapter",
      whatYouGet: "New data",
      tier: "C" as const,
      authKind: "export-file" as const,
      scopes: [],
      categories: [],
      requirements: [],
    };
    expect(catalogue({ ...registry, allCatalogEntries: () => [unknown] })[0]).toMatchObject({
      domains: ["other"],
      status: "import",
    });
  });
  it("maps written classes, including categories that changed in Home", () => {
    const entries = catalogue(createRegistry());
    expect(entries.find((entry) => entry.id === "goodreads")?.domains).toEqual(["media"]);
    expect(entries.find((entry) => entry.id === "strava")?.domains).toEqual([
      "body-health",
      "mobility",
    ]);
    expect(entries.find((entry) => entry.id === "bank-statements")?.domains).toEqual(["financial"]);
    expect(entries.find((entry) => entry.id === "whoop")?.domains).toEqual(["body-health"]);
    expect(destinationsFor("netflix")).toEqual([{ domain: "media", label: "Media › Streaming" }]);
    expect(destinationsFor("future-adapter")).toEqual([{ domain: "other", label: "Other" }]);
    expect(scopeLabel("read:recovery")).toBe("Recovery and daily vitals");
    expect(scopeLabel("read:sleep")).toBe("Sleep and stages");
  });
  it("uses source-aware destinations for Discord and Steam, retaining GitHub in Work", () => {
    expect(destinationsFor("discord")).toEqual([
      { domain: "socials", label: "Socials › Following" },
    ]);
    expect(destinationsFor("steam")).toEqual([
      { domain: "media", label: "Media › Streaming" },
      { domain: "socials", label: "Socials › Following" },
    ]);
    expect(destinationsFor("github")).toEqual([
      { domain: "work-study", label: "Work & Study › Work experience" },
    ]);
    expect(catalogue(createRegistry()).find((entry) => entry.id === "discord")?.domains).toEqual([
      "socials",
    ]);
  });
  it("filters by domain and by name or description without case sensitivity", () => {
    const entries = catalogue(createRegistry());
    expect(filterCatalogue(entries, ["media"], "SPOTIFY").map((entry) => entry.id)).toEqual([
      "spotify",
    ]);
    expect(filterCatalogue(entries, [], "  viewing history  ").map((entry) => entry.id)).toEqual([
      "netflix",
    ]);
    expect(filterCatalogue(entries, ["mobility"], "spotify")).toEqual([]);
    expect(filterCatalogue(entries, [], "")).toEqual(entries);
  });
});

describe("plain connect copy", () => {
  it("handles singular, plural and progress without inventing totals", () => {
    expect(addedCopy(1, "Media")).toBe("Added 1 item to Media");
    expect(addedCopy(3, "Media")).toBe("Added 3 items to Media");
    expect(skippedCopy(0)).toBe("");
    expect(skippedCopy(1)).toBe("1 item couldn't be read and was skipped");
    expect(skippedCopy(2)).toBe("2 items couldn't be read and were skipped");
    expect(progressCopy(2)).toBe("Imported 2 items");
    expect(progressCopy(1, 3, "tracks")).toBe("Imported 1 of 3 tracks");
    // Adapter totals count steps: name the current one, never a number of collections.
    expect(stepCopy(0, 4)).toBe("Step 1 of 4");
    expect(stepCopy(1, 4)).toBe("Step 2 of 4");
    expect(stepCopy(3, 4)).toBe("Step 4 of 4");
    expect(stepCopy(-1, 1)).toBe("Step 1 of 1");
    // A finished run, or an item-counting adapter's final report, never reads as a step.
    expect(stepCopy(4, 4)).toBe("Finishing…");
    expect(stepCopy(9, 4)).toBe("Finishing…");
    expect(stepCopy(5000, 5000)).toBe("Finishing…");
    expect(stepCopy(0, 0)).toBe("Finishing…");
    expect(stepCopy(0, Number.NaN)).toBe("Finishing…");
    expect(scopeLabel("user-follow-read")).toBe("Artists you follow");
    expect(scopeLabel("new-scope")).toBe("Service data");
    expect(
      connectorErrorCopy(
        new IntegrationError("netflix", "No importable records were found."),
        "Netflix",
      ),
    ).toBe("No importable records were found.");
    expect(
      connectorErrorCopy(
        new IntegrationError("spotify", "Error at https://private.example/"),
        "Spotify",
      ),
    ).toBe("Couldn't import your Spotify data. Please try again.");
    expect(connectorErrorCopy(new Error("private information"), "Spotify")).toBe(
      "Couldn't import your Spotify data. Please try again.",
    );
  });
  it("formats relative sync times", () => {
    const now = Date.parse("2026-11-01T12:00:00Z");
    expect(relativeSync(undefined, now)).toBe("Not synced yet");
    expect(relativeSync("invalid", now)).toBe("Not synced yet");
    expect(relativeSync("2026-11-01T12:00:00Z", now)).toBe("Synced just now");
    expect(relativeSync("2026-11-01T11:59:00Z", now)).toBe("Synced 1 minute ago");
    expect(relativeSync("2026-11-01T11:58:00Z", now)).toBe("Synced 2 minutes ago");
    expect(relativeSync("2026-11-01T11:00:00Z", now)).toBe("Synced 1 hour ago");
    expect(relativeSync("2026-11-01T10:00:00Z", now)).toBe("Synced 2 hours ago");
    expect(relativeSync("2026-10-31T12:00:00Z", now)).toBe("Synced 1 day ago");
    expect(relativeSync("2026-10-30T12:00:00Z", now)).toBe("Synced 2 days ago");
  });
});

// AUTHORED-BY Codex GPT-6.1-Sol
it("shows VeSync CLI instructions without the coming-soon flag", () => {
  expect(catalogue(createRegistry()).find(({ id }) => id === "vesync")).toMatchObject({
    status: "cli-only",
    name: "Levoit (VeSync)",
    howTo: expect.stringContaining("pod-connectors import vesync"),
  });
});
