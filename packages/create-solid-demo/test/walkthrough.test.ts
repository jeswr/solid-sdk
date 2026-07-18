// AUTHORED-BY Claude Fable 5
/**
 * Acceptance §6 sm-76 item 2: the generated walkthrough passes `parseWalkthrough`
 * (schema + every cross-reference) and the placeholder chapters pass the editorial
 * gates — asserted against the REAL validator from @jeswr/solid-showcase, not a
 * re-implementation.
 */
import { editorialFindings, parseWalkthrough, walkthroughWarnings } from "@jeswr/solid-showcase";
import { describe, expect, it } from "vitest";
import type { DemoSpec } from "../src/walkthrough.js";
import { buildWalkthrough, envMatrixRows } from "../src/walkthrough.js";

const spec: DemoSpec = {
  apps: [
    { name: "Traveller Vault", role: "personal data custodian", slug: "vault" },
    { name: "Permit Desk", role: "day-permit issuer", slug: "permits" },
    { name: "Gear Locker", role: "gear outfitting", slug: "outfitter" },
  ],
  convener: "Meridian Trails Collective",
  modelledOn: { permits: "Ridgeway Range Authority" },
  negations: ["Nothing here is an offer of guided travel."],
  useCase: "trails",
};

const singleAppSpec: DemoSpec = {
  apps: [{ name: "Data Vault", role: "personal data custodian", slug: "vault" }],
  convener: "Open Example Collective",
  modelledOn: {},
  negations: ["Nothing here is an offer of any service."],
  useCase: "one-seat",
};

describe("buildWalkthrough", () => {
  it("passes parseWalkthrough for a multi-app spec", () => {
    const doc = parseWalkthrough(buildWalkthrough(spec));
    expect(doc.chapters).toHaveLength(3);
    expect(Object.keys(doc.registry.apps).sort()).toEqual([
      "outfitter",
      "permits",
      "tour",
      "vault",
    ]);
  });

  it("passes parseWalkthrough for a single-app spec", () => {
    const doc = parseWalkthrough(buildWalkthrough(singleAppSpec));
    expect(doc.chapters).toHaveLength(1);
    expect(doc.registry.roles).toHaveLength(1);
  });

  it("placeholder chapters pass the editorial gates", () => {
    expect(editorialFindings(parseWalkthrough(buildWalkthrough(spec)))).toEqual([]);
    expect(editorialFindings(parseWalkthrough(buildWalkthrough(singleAppSpec)))).toEqual([]);
  });

  it("stays clean of the role-first naming advisory", () => {
    expect(walkthroughWarnings(parseWalkthrough(buildWalkthrough(spec)))).toEqual([]);
  });

  it("applies --modelled-on, defaulting to the role text", () => {
    const doc = buildWalkthrough(spec);
    expect(doc.registry.apps["permits"]?.modelledOn).toBe("Ridgeway Range Authority");
    expect(doc.registry.apps["vault"]?.modelledOn).toBe("personal data custodian");
  });

  it("derives deploy + env wiring from the use case", () => {
    const doc = buildWalkthrough(spec);
    expect(doc.deploy).toEqual({ envPrefix: "TRAILS", slug: "trails" });
    expect(doc.registry.apps["permits"]?.zoneEnv).toBe("TRAILS_PERMITS_ZONE_URL");
    expect(doc.registry.apps["tour"]?.zoneEnv).toBeUndefined();
  });

  it("registers every app behind the pod-guard sample route", () => {
    const doc = buildWalkthrough(spec);
    for (const app of spec.apps) {
      expect(doc.registry.apps[app.slug]?.podRoutes).toEqual(["/api/pod/example"]);
    }
  });

  it("the first app is the data subject's centre seat", () => {
    const doc = buildWalkthrough(spec);
    expect(doc.registry.center).toBe("data-subject");
    const center = doc.registry.roles.find((role) => role.center === true);
    expect(center?.apps).toEqual(["vault"]);
  });

  it("ships an EMPTY banned-marks roster (caller-supplied domain roster)", () => {
    expect(buildWalkthrough(spec).branding.bannedMarks).toEqual([]);
  });

  it("keeps every anchor source out (no fabricated citations)", () => {
    expect(buildWalkthrough(spec).anchors).toEqual([]);
  });
});

describe("envMatrixRows", () => {
  it("zone vars target the shell; trust + allowlist vars target the pod-route apps", () => {
    const rows = envMatrixRows(spec);
    const zone = rows.find((row) => row.name === "TRAILS_VAULT_ZONE_URL");
    expect(zone?.project).toBe("tour (shell)");
    const trust = rows.find((row) => row.name === "TRAILS_TRUST_FORWARDED_HEADERS");
    expect(trust?.project).toBe("vault, permits, outfitter");
    expect(rows.some((row) => row.name === "TRAILS_TRUSTED_OIDC_ISSUERS")).toBe(true);
    expect(rows.some((row) => row.name === "TRAILS_POD_ALLOWED_ORIGINS")).toBe(true);
  });
});
