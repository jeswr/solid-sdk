// AUTHORED-BY Codex GPT-6

import { readFileSync } from "node:fs";
import { parseRdf } from "@jeswr/fetch-rdf";
import type { Mode } from "@jeswr/pod-access";
import * as access from "@jeswr/pod-access";
import { describe, expect, it } from "vitest";
import { modeIri, modes, readModes } from "../src/rdf.js";
import * as fixtures from "../src/testing.js";
import { grant, policy } from "./helpers.js";

const expectedModes: Mode[] = ["read", "append", "write", "control"];
const owner = "https://pod.example/owner#me";
const resource = "https://pod.example/file";
const url = `${resource}.acl`;

function checkProofs(): void {
  for (const mode of expectedModes) {
    const wider = policy(grant(undefined, { modes: new Set([mode]) }));
    expect(() => access.assertNotWider(access.emptyPolicy(), wider)).toThrow(
      `widens ${mode} access`,
    );
    expect(access.policiesEqual(access.emptyPolicy(), wider)).toBe(false);
    expect(access.policiesEqual(wider, access.emptyPolicy())).toBe(false);
    expect(readModes([modeIri(mode)])).toEqual(
      new Set(mode === "write" ? ["write", "append"] : [mode]),
    );
  }
  expect(access.ownerPolicy(owner).grants[0]?.modes).toEqual(new Set(expectedModes));
  expect(fixtures.ownerPolicy(owner).grants[0]?.modes).toEqual(new Set(expectedModes));
}

describe("public API boundary and accidental mutation isolation", () => {
  it("keeps reader classes and their inherited prototypes out of the public API", () => {
    expect(Object.keys(access).sort()).toEqual([
      "assertNotWider",
      "effectiveMembers",
      "effectivePolicy",
      "emptyPolicy",
      "isPolicyTooComplex",
      "ownerPolicy",
      "policiesEqual",
      "readAcp",
      "readWac",
      "reportItem",
      "scopePolicy",
      "translatePolicy",
      "unionPolicies",
      "writeAcp",
      "writeWac",
    ]);
    expect(Object.keys(fixtures).sort()).toEqual(["emptyPolicy", "ownerPolicy"]);
    for (const entry of [access, fixtures])
      for (const value of Object.values(entry)) expect(typeof value).toBe("function");
    // No subpath exposes the internal RDF or reader modules either.
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(Object.keys(manifest.exports).sort()).toEqual([".", "./testing"]);
    checkProofs();
  });

  it.each([
    ["splice", () => (modes as Mode[]).splice(0)],
    ["push", () => (modes as Mode[]).push("read")],
    ["replace entries", () => Object.assign(modes, { 0: "control" })],
  ])("keeps internal mode lists frozen against accidental mutation: %s", (_name, mutate) => {
    expect(mutate).toThrow(TypeError);
    expect(modes).toEqual(expectedModes);
    checkProofs();
  });

  it("returns fresh report options without exposing the shared descriptions", () => {
    const report = access.reportItem("condition-unsupported", resource, "Unsupported", ["skip"]);
    const option = report.options[0];
    expect(option?.description).toBe(
      "Leave this resource or unsupported grant out of the migration.",
    );
    if (!option) throw new Error("Missing skip option");
    option.description = "changed";
    option.label = "changed";
    report.options.splice(0);
    const next = access.reportItem("condition-unsupported", resource, "Unsupported", ["skip"]);
    expect(next.options).toEqual([
      {
        id: "skip",
        label: "skip",
        description: "Leave this resource or unsupported grant out of the migration.",
      },
    ]);
  });

  it("preserves public permissions through the reader and proof API", async () => {
    const publicPolicy = policy(grant(undefined, { modes: new Set(expectedModes) }));
    const documents = [
      await access.writeWac(publicPolicy, resource, url),
      await access.writeAcp(publicPolicy, resource, url, "css"),
      await access.writeAcp(publicPolicy, resource, url, "ess"),
    ] as const;
    const [wac, css, ess] = await Promise.all([
      parseRdf(documents[0], "text/turtle"),
      parseRdf(documents[1], "text/turtle"),
      parseRdf(documents[2], "text/turtle"),
    ]);
    const policies = [
      access.readWac(wac, resource, url, "css", true),
      access.readAcp(css, resource, url, "css", true),
      access.readAcp(ess, resource, url, "ess", true),
    ];
    for (const read of policies) {
      expect(access.policiesEqual(publicPolicy, read)).toBe(true);
      for (const mode of expectedModes)
        expect(() =>
          access.assertNotWider(
            access.emptyPolicy(),
            access.scopePolicy(
              { grants: read.grants.filter((g) => g.modes.has(mode)), denials: [] },
              "resource",
            ),
          ),
        ).toThrow("widens");
    }
    checkProofs();
  });

  it("returns fresh mutable fixtures and mode sets without sharing internal state", () => {
    for (const entry of [access, fixtures]) {
      const denied = entry.emptyPolicy();
      denied.grants.push(grant());
      denied.denials.push(grant());
      expect(entry.emptyPolicy()).toEqual({ grants: [], denials: [] });
      const owned = entry.ownerPolicy(owner);
      const rule = owned.grants[0];
      expect(rule).toBeDefined();
      rule?.modes.clear();
      rule?.who.splice(0);
      rule?.except.push({ kind: "public" });
      owned.grants.splice(0);
      expect(entry.ownerPolicy(owner).grants[0]?.who).toEqual([[{ kind: "agent", webId: owner }]]);
    }
    readModes(expectedModes.map(modeIri)).clear();
    const report = access.reportItem("condition-unsupported", resource, "Unsupported", ["skip"]);
    const option = report.options[0];
    if (!option) throw new Error("Missing skip option");
    const description = option.description;
    option.description = "changed";
    expect(
      access.reportItem("condition-unsupported", resource, "Unsupported", ["skip"]).options[0]
        ?.description,
    ).toBe(description);
    checkProofs();
  });
});
