// AUTHORED-BY Claude Opus 5.5
import type { Feature, Features } from "@jeswr/storage-capabilities";
import { describe, expect, it } from "vitest";
import { deriveSuiteCaps, type SuiteCaps } from "./suite-caps.js";

const unknown = <T>(detail: T): Feature<T> => ({ state: "unknown", evidence: "none", detail });
const on = <T>(detail: T): Feature<T> => ({ state: "available", evidence: "test", detail });
const off = <T>(detail: T): Feature<T> => ({ state: "unavailable", evidence: "test", detail });

function features(overrides: Partial<Features> = {}): Features {
  return {
    protocol: "solid",
    liveUpdates: unknown({ channels: [] }),
    realtimeCollab: unknown({ protocols: [] }),
    serverSearch: unknown({}),
    typeIndex: unknown({ mode: "client" }),
    accessRequests: unknown({ profiles: [] }),
    accessGrants: unknown({ profiles: [] }),
    accessControl: unknown({ model: "none" }),
    versioning: unknown({}),
    trash: unknown({}),
    move: unknown({ native: false, containers: false, preservesIdentifier: null }),
    patch: unknown({ formats: {} }),
    resumableUploads: unknown(undefined),
    recursiveDelete: unknown(undefined),
    pagination: unknown(undefined),
    rdfConneg: unknown({ formats: [] }),
    ...overrides,
  };
}

const closed: SuiteCaps = {
  protocol: "solid",
  accessControl: "none",
  realtimeCollab: false,
  liveUpdates: false,
  serverSearch: false,
  accessRequests: false,
  versioning: false,
  trash: false,
  quota: false,
  move: false,
  resumableUploads: false,
  publicLinks: false,
  authenticatedAgentGrants: false,
  grantExpiry: false,
  grantPurpose: false,
  notifyAgents: true,
  typeIndex: false,
  selfRegistration: false,
  patchMediaTypes: [],
};

describe("deriveSuiteCaps", () => {
  it("fails closed when every feature is unknown", () => {
    expect(deriveSuiteCaps(features())).toEqual(closed);
  });

  it("treats unavailable like unknown", () => {
    const caps = deriveSuiteCaps(
      features({
        liveUpdates: off({ channels: ["websocket"] }),
        accessControl: off({ model: "wac" }),
        move: off({ native: true, containers: true, preservesIdentifier: true }),
        patch: off({ formats: { "text/turtle": ["text/n3"] } }),
      }),
    );
    expect(caps).toEqual(closed);
  });

  // One case per SuiteCaps row.
  it.each<[keyof SuiteCaps, Partial<Features>, SuiteCaps[keyof SuiteCaps], object?]>([
    ["protocol", { protocol: "lws" }, "lws"],
    ["accessControl", { accessControl: on({ model: "acp" }) }, "acp"],
    ["realtimeCollab", { realtimeCollab: on({ protocols: ["y-protocol-v1"] }) }, true],
    ["liveUpdates", { liveUpdates: on({ channels: ["websocket"] }) }, true],
    ["serverSearch", { serverSearch: on({ endpoint: "https://alice.pod/sparql" }) }, true],
    ["accessRequests", { accessRequests: on({ profiles: [] }) }, true],
    ["versioning", { versioning: on({}) }, true],
    ["trash", { trash: on({}) }, true],
    ["quota", { trash: on({}) }, false],
    ["move", { move: on({ native: true, containers: true, preservesIdentifier: true }) }, true],
    ["resumableUploads", { resumableUploads: on(undefined) }, true],
    ["publicLinks", { accessControl: on({ model: "wac" }) }, true],
    ["authenticatedAgentGrants", { accessControl: on({ model: "acp" }) }, true],
    ["grantExpiry", { accessControl: on({ model: "odrl-grants" }) }, true],
    ["grantPurpose", { accessControl: on({ model: "odrl-grants" }) }, true],
    ["notifyAgents", { protocol: "lws" }, false],
    ["typeIndex", { typeIndex: on({ mode: "server" }) }, true],
    ["selfRegistration", {}, true, { selfRegistration: true }],
    [
      "patchMediaTypes",
      {
        patch: on({
          formats: {
            "text/turtle": ["text/n3", "application/sparql-update"],
            "application/ld+json": ["text/n3"],
          },
        }),
      },
      ["text/n3", "application/sparql-update"],
    ],
  ])("derives %s", (key, overrides, value, context) => {
    expect(deriveSuiteCaps(features(overrides), context)[key]).toEqual(value);
  });

  it("keeps emulated move false and lets an inbox enable Solid access requests only", () => {
    expect(
      deriveSuiteCaps(
        features({ move: on({ native: false, containers: true, preservesIdentifier: true }) }),
      ).move,
    ).toBe(false);
    expect(deriveSuiteCaps(features(), { hasInbox: true }).accessRequests).toBe(true);
    expect(deriveSuiteCaps(features({ protocol: "lws" }), { hasInbox: true }).accessRequests).toBe(
      false,
    );
  });

  it("separates grant models", () => {
    const wac = deriveSuiteCaps(features({ accessControl: on({ model: "wac" }) }));
    expect([wac.grantExpiry, wac.grantPurpose, wac.authenticatedAgentGrants]).toEqual([
      false,
      false,
      true,
    ]);
    const odrl = deriveSuiteCaps(features({ accessControl: on({ model: "odrl-grants" }) }));
    expect([odrl.publicLinks, odrl.authenticatedAgentGrants]).toEqual([false, false]);
  });
});
