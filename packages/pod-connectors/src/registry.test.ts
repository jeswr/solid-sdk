import { describe, expect, it } from "vitest";
import { FILE_ADAPTERS, fileAdapterById } from "./file-adapters.js";
import {
  ADAPTERS,
  adapterById,
  allCatalogEntries,
  isLive,
  statusOf,
  TIER_B,
  TIER_B_ADAPTERS,
  TIER_C,
} from "./registry.js";

describe("integrations registry", () => {
  it("exposes exactly 31 catalog entries with unique, URL-safe ids", () => {
    const entries = allCatalogEntries();
    expect(entries).toHaveLength(31);
    const ids = entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(31);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  it("ships the 8 Tier-A adapters from the catalog", () => {
    expect(ADAPTERS.map((a) => a.metadata.id).sort()).toEqual([
      "discord",
      "dropbox",
      "github",
      "notion",
      "reddit",
      "spotify",
      "strava",
      "twitch",
    ]);
    for (const a of ADAPTERS) {
      expect(a.metadata.tier).toBe("A");
      expect(a.metadata.authKind).toBe("oauth-pkce");
      expect(a.oauth).toBeDefined();
      expect(a.fixtures().length).toBeGreaterThan(0);
      expect(a.metadata.requirements.length).toBeGreaterThan(0); // honest go-live list
      expect(adapterById(a.metadata.id)).toBe(a);
    }
  });

  it("ships the 13 Tier-B adapters, each demoable now with an honest blocker", () => {
    expect(TIER_B_ADAPTERS.map((a) => a.metadata.id).sort()).toEqual([
      "facebook",
      "fitbit",
      "garmin",
      "gmail",
      "google-calendar",
      "google-photos",
      "instagram",
      "linkedin",
      "pinterest",
      "slack",
      "tiktok",
      "x-twitter",
      "youtube",
    ]);
    for (const a of TIER_B_ADAPTERS) {
      expect(a.metadata.tier).toBe("B");
      expect(a.metadata.authKind).toBe("oauth-pkce");
      expect(a.oauth).toBeDefined();
      // A real, fixture-backed import drives the demo.
      expect(a.fixtures().length).toBeGreaterThan(0);
      // The first requirement is the specific platform-approval blocker.
      expect(a.metadata.requirements.length).toBeGreaterThan(0);
      expect(adapterById(a.metadata.id)).toBe(a);
      // Even with config they never auto-go-live: the catalog gates them.
      expect(statusOf({ ...a.metadata })).toBe("approval-needed");
    }
  });

  it("Tier-B catalog entries are derived from the adapters and carry a blocker", () => {
    expect(TIER_B).toHaveLength(TIER_B_ADAPTERS.length);
    for (const entry of TIER_B) {
      expect(entry.blocker).toBeTruthy();
      expect(adapterById(entry.id)).toBeDefined();
    }
  });

  it("proxy-requiring Tier-B platforms document their proxy env var", () => {
    for (const a of TIER_B_ADAPTERS) {
      if (a.oauth?.tokenExchange === "proxy") {
        expect(
          a.metadata.requirements.some((r) => r.includes("TOKEN_PROXY")),
          `${a.metadata.id} must document its proxy requirement`,
        ).toBe(true);
      }
    }
  });

  it("tier-honest statuses: A=demo without env config, B=approval, C=export-file", () => {
    // No NEXT_PUBLIC_* integration env vars are set in the test run.
    for (const entry of allCatalogEntries()) {
      const status = statusOf(entry);
      if (entry.tier === "A") expect(status).toBe("demo");
      if (entry.tier === "B") expect(status).toBe("approval-needed");
      if (entry.tier === "C") expect(status).toBe("export-file");
    }
    for (const a of ADAPTERS) expect(isLive(a)).toBe(false);
  });

  it("ships a working file-import adapter for every Tier-C catalog entry", () => {
    // All 10 Tier-C entries plus the Tier-B hybrid (Garmin, asserted below).
    expect(FILE_ADAPTERS).toHaveLength(TIER_C.length + 1);
    for (const entry of TIER_C) {
      const adapter = fileAdapterById(entry.id);
      expect(adapter, `missing file adapter for ${entry.id}`).toBeDefined();
      expect(adapter?.metadata.tier).toBe("C");
      expect(adapter?.metadata.authKind).toBe("export-file");
      expect(adapter?.accept.length).toBeGreaterThan(0);
      expect(adapter?.fileHint.length).toBeGreaterThan(0);
      // The adapter's categories must match the catalog entry's, and exist.
      expect([...adapter!.metadata.categories].sort()).toEqual([...entry.categories].sort());
    }
  });

  it("Garmin is a Tier-B hybrid: approval-gated OAuth plus a working file import", () => {
    // The OAuth adapter stays approval-gated…
    const oauth = adapterById("garmin");
    expect(oauth?.metadata.tier).toBe("B");
    expect(statusOf({ ...oauth!.metadata })).toBe("approval-needed");
    // …while the file adapter imports the user's own export today.
    const file = fileAdapterById("garmin");
    expect(file).toBeDefined();
    expect(file?.metadata.authKind).toBe("export-file");
    expect(file?.accept).toContain(".csv");
    expect(file?.accept).toContain(".gpx");
    expect(file?.accept).toContain(".tcx");
    // Honest guidance: both export options plus the full-archive alternative.
    expect(file?.fileHint).toMatch(/Export CSV/);
    expect(file?.fileHint).toMatch(/GPX or TCX/);
    expect(file?.fileHint).toMatch(/Export Your Data/);
    // Same id, same categories — the data lands in the same pod container.
    expect([...file!.metadata.categories].sort()).toEqual([...oauth!.metadata.categories].sort());
  });

  it("Tier-C export links: a real https URL where the platform has one, absent otherwise", () => {
    // Platforms with a single web page where the user requests/downloads the export.
    const ExportUrls: Record<string, string> = {
      "google-takeout": "https://takeout.google.com",
      netflix: "https://www.netflix.com/viewingactivity",
      "amazon-orders": "https://www.amazon.co.uk/hz/privacy-central/data-requests/preview.html",
      uber: "https://myprivacy.uber.com/privacy/exploreyourdata/download",
      goodreads: "https://www.goodreads.com/review/import",
      steam: "https://help.steampowered.com/en/accountdata",
      chatgpt: "https://chatgpt.com",
      garmin: "https://connect.garmin.com/modern/activities",
    };
    // In-app or institution-specific exports: no URL to send the user to —
    // the field must be ABSENT (the UI renders no link).
    const NoExportUrl = ["apple-health", "whatsapp", "bank-statements"];

    for (const a of FILE_ADAPTERS) {
      const expected = ExportUrls[a.metadata.id];
      if (expected) {
        expect(a.exportUrl, a.metadata.id).toBe(expected);
        expect(new URL(a.exportUrl!).protocol).toBe("https:");
      } else {
        expect(NoExportUrl).toContain(a.metadata.id);
        expect(a.exportUrl, `${a.metadata.id} must not carry an exportUrl`).toBeUndefined();
      }
    }
  });

  it("proxy-requiring platforms are honest about it in their requirements", () => {
    for (const a of ADAPTERS) {
      if (a.oauth?.tokenExchange === "proxy") {
        expect(
          a.metadata.requirements.some((r) => r.includes("TOKEN_PROXY")),
          `${a.metadata.id} must document its proxy requirement`,
        ).toBe(true);
      }
    }
  });
});

// AUTHORED-BY Codex GPT-6.1-Sol
// Configured registries are isolated from both each other and default adapters.
describe("injected public configuration", () => {
  it("keeps hosts isolated and preserves proxy/live gates and Twitch headers", async () => {
    const { createRegistry } = await import("./registry.js");
    const first = createRegistry({
      spotify: { clientId: "first" },
      github: { clientId: "id" },
      twitch: { clientId: "twitch-id", tokenProxyUrl: "https://proxy.test/token" },
    });
    const second = createRegistry({ spotify: { clientId: "second" } });
    expect(first.adapterById("spotify")?.oauth?.clientId).toBe("first");
    expect(second.adapterById("spotify")?.oauth?.clientId).toBe("second");
    expect(adapterById("spotify")?.oauth?.clientId).toBeUndefined();
    expect(first.statusOf(first.adapterById("spotify")!.metadata)).toBe("live");
    expect(first.statusOf(first.adapterById("github")!.metadata)).toBe("demo");
    expect(first.adapterById("twitch")?.apiHeaders?.["client-id"]).toBe("twitch-id");
    expect(first.statusOf(first.adapterById("twitch")!.metadata)).toBe("live");
    expect(first.statusOf(first.adapterById("google-calendar")!.metadata)).toBe("approval-needed");
    expect(first.statusOf(TIER_C[0]!)).toBe("export-file");
    expect(first.statusOf({ ...ADAPTERS[0]!.metadata, id: "unknown" })).toBe("demo");
    expect(first.adapterById("unknown")).toBeUndefined();
    expect(first.allCatalogEntries()).toHaveLength(31);
  });
});
