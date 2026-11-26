// AUTHORED-BY Claude Sonnet 5.5
import { describe, expect, it, vi } from "vitest";
import { FILE_ADAPTERS } from "../file-adapters.js";
import { ALL_ADAPTERS } from "../registry.js";
import { runImport } from "./import-runner.js";
import { CONNECTOR_PRIVACY, isClassifiedConnector } from "./pod-writer-policy.js";
import type { PodWriter } from "./types.js";

// The package test setup treats a few fixture ids as public-ok. The gate itself is tested
// against the real policy.
const { requiresPrivateDestination } =
  await vi.importActual<typeof import("./pod-writer-policy.js")>("./pod-writer-policy.js");

const registered = [
  ...new Set([...ALL_ADAPTERS, ...FILE_ADAPTERS].map((adapter) => adapter.metadata.id)),
].sort();

describe("connector privacy classification", () => {
  it.each(registered)("registered adapter %s has an explicit privacy classification", (id) => {
    expect(
      isClassifiedConnector(id),
      `Adapter "${id}" is registered but missing from CONNECTOR_PRIVACY in core/pod-writer-policy.ts. Classify it "private" or "public-ok".`,
    ).toBe(true);
  });

  it("has no classification for an id that is not registered", () => {
    expect(Object.keys(CONNECTOR_PRIVACY).filter((id) => !registered.includes(id))).toEqual([]);
  });

  it("derives the requirement from the classification", () => {
    for (const [id, privacy] of Object.entries(CONNECTOR_PRIVACY))
      expect(requiresPrivateDestination(id), id).toBe(privacy === "private");
  });

  it("treats an import of a person's own account data as private", () => {
    for (const id of [
      "activity-files",
      "apple-health",
      "fitbit",
      "garmin",
      "strava",
      "whoop",
      "bank-statements",
      "amazon-orders",
      "uber",
      "gmail",
      "whatsapp",
      "google-contacts",
      "google-calendar",
      "google-takeout",
      "dropbox",
      "notion",
      "google-photos",
      "facebook",
      "instagram",
      "netflix",
      "spotify",
      "youtube",
      "reddit",
      "vesync",
      "slack",
      "discord",
      "pinterest",
      "tiktok",
      "twitch",
      "steam",
      "goodreads",
      "linkedin",
      "x-twitter",
      // The adapter requests the `repo` scope and lists private repositories.
      "github",
    ])
      expect(requiresPrivateDestination(id), id).toBe(true);
  });

  it("classifies no registered connector as public-ok", () => {
    expect(Object.values(CONNECTOR_PRIVACY).filter((privacy) => privacy !== "private")).toEqual([]);
  });

  it("does not claim an unregistered id is classified, and fails closed for it", () => {
    expect(isClassifiedConnector("not-registered")).toBe(false);
    expect(isClassifiedConnector("toString")).toBe(false);
    expect(requiresPrivateDestination("not-registered")).toBe(true);
    expect(requiresPrivateDestination("toString")).toBe(true);
    expect(requiresPrivateDestination("__proto__")).toBe(true);
  });

  it("refuses an unclassified host adapter before any write when no verifier is supplied", async () => {
    const write = vi.fn<PodWriter["write"]>();
    const adapter = { ...ALL_ADAPTERS[0], metadata: { ...ALL_ADAPTERS[0]?.metadata, id: "host" } };
    await expect(
      runImport({
        // biome-ignore lint/suspicious/noExplicitAny: a minimal host adapter shape
        adapter: adapter as any,
        mode: "demo",
        podWriter: {
          resolve: (slug) => new URL(slug, "https://pod.example/").href,
          read: async () => undefined,
          write,
          registerType: vi.fn(),
        },
      }),
    ).rejects.toMatchObject({ name: "PrivateDestinationError" });
    expect(write).not.toHaveBeenCalled();
  });
});
