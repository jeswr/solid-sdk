// AUTHORED-BY Claude Sonnet 5.5
import { describe, expect, it } from "vitest";
import { FILE_ADAPTERS } from "../file-adapters.js";
import { ALL_ADAPTERS } from "../registry.js";
import {
  CONNECTOR_PRIVACY,
  isClassifiedConnector,
  requiresPrivateDestination,
} from "./pod-writer-policy.js";

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

  it("keeps the connectors that carry health, location, finance and messages private", () => {
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
    ])
      expect(requiresPrivateDestination(id), id).toBe(true);
  });

  it("does not claim an unregistered id is classified", () => {
    expect(isClassifiedConnector("not-registered")).toBe(false);
    expect(isClassifiedConnector("toString")).toBe(false);
    expect(requiresPrivateDestination("toString")).toBe(false);
  });
});
