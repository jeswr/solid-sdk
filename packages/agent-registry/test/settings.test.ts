// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer forbids scheme imports
import { createHmac } from "crypto";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer forbids scheme imports
import { readFile } from "fs/promises";
import { describe, expect, it } from "vitest";
import {
  bindingStateFromSetup,
  capabilityMatrix,
  channelGroup,
  connectionStatus,
  DENY_ALL,
  effectiveCapability,
  emptySettings,
  hashHandle,
  inventorySettings,
  isPlaceholder,
  normaliseHandle,
  parseRegistryYaml,
} from "../src/index.js";

const fixture = await readFile(
  new URL("./fixtures/registry.synthetic.yaml", import.meta.url),
  "utf8",
);
const salt = new Uint8Array(32).fill(7);
function settings() {
  return inventorySettings(parseRegistryYaml(fixture), salt);
}
function connection() {
  const first = settings().connections[1];
  if (!first) throw new Error("Fixture account absent");
  return first;
}

describe("privacy and settings model", () => {
  it("uses exactly HMAC-SHA-256 on normalised handles, hex, with stable distinct salts", () => {
    expect(hashHandle("  FIXTURE@example.com  ", salt)).toBe(
      createHmac("sha256", salt).update("fixture@example.com").digest("hex"),
    );
    expect(hashHandle("fixture@example.com", salt)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashHandle("fixture@example.com", salt)).not.toBe(
      hashHandle("fixture@example.com", new Uint8Array(32).fill(8)),
    );
    expect(hashHandle("fixture+alias@example.com", salt)).not.toBe(
      hashHandle("fixture@example.com", salt),
    );
    expect(normaliseHandle("  CAFÉ@EXAMPLE.COM ")).toBe(normaliseHandle("cafe\u0301@example.com"));
    expect(() => hashHandle(" ", salt)).toThrow();
    expect(() => hashHandle("fixture@example.com", new Uint8Array(31))).toThrow();
    expect(isPlaceholder("to_confirm")).toBe(true);
    expect(isPlaceholder(" ")).toBe(true);
    expect(isPlaceholder("fixture@example.com")).toBe(false);
  });
  it("defaults to empty settings and immutable denied restrictions", () => {
    expect(emptySettings()).toEqual({
      version: 1,
      connections: [],
      workflowPolicy: null,
      unmatchedEvidence: [],
    });
    expect(Object.isFrozen(DENY_ALL)).toBe(true);
    const s = settings();
    const first = s.connections[0];
    if (!first) throw new Error("Fixture account absent");
    first.restrictions.read = true;
    expect(s.connections[1]?.restrictions.read).toBe(false);
    expect(DENY_ALL.read).toBe(false);
  });
  it.each([
    ["email", "email"],
    ["calendar", "calendar"],
    ["matrix", "chat"],
    ["telegram", "chat"],
    ["github_notifications", "other"],
  ])("groups %s as %s", (channel, group) => {
    expect(channelGroup(channel)).toBe(group);
  });
  it.each([
    ["connected", "setup-required"],
    ["planned", "setup-required"],
    ["not_configured", "setup-required"],
    ["unknown_status", "setup-required"],
    ["disabled", "disabled"],
    ["none", "none"],
    ["not_applicable", "none"],
    ["failed", "error"],
    ["auth_error", "error"],
    ["identity_conflict", "error"],
  ])("maps %s to %s without trusting connection claims", (input, expected) => {
    expect(bindingStateFromSetup(input)).toBe(expected);
  });
  it("matches historic evidence to the exact normalised handle AND channel; unmatched hashes stay separate", () => {
    const snap = parseRegistryYaml(fixture);
    snap.evidence.push(
      {
        channel: "calendar",
        provider: "google",
        identifier: "GMAIL-MAIN@example.com",
        method: "calendar_check",
        observedOn: "2026-10-20",
      },
      {
        channel: "email",
        provider: "google",
        identifier: "unknown-address@example.org",
        method: "historic_connector",
        observedOn: "2026-10-20",
      },
    );
    const s = inventorySettings(snap, salt);
    expect(s.connections[0]?.evidence).toEqual([]);
    expect(s.unmatchedEvidence).toHaveLength(2);
    expect(s.unmatchedEvidence.map((e) => e.handleHash)).toContain(
      hashHandle("unknown-address@example.org", salt),
    );
    expect(JSON.stringify(s)).not.toContain("unknown-address@example.org");
    const odi = s.connections.find((a) => a.organisation === "ODI" && a.channel === "email");
    if (!odi) throw new Error("Fixture account absent");
    expect(odi.evidence).toMatchObject([
      { provider: "google_workspace", method: "historic_connector", observedOn: "2026-10-20" },
    ]);
    expect(connectionStatus(odi, new Date("2026-10-26T00:00:00Z"))).toMatchObject({
      state: "previously-checked",
      stale: false,
    });
    expect(s.workflowPolicy).toMatchObject({
      askWhenUncertain: ["identity"],
      taxonomy: { action: "Needs owner attention" },
    });
  });
  it("rejects empty evidence identifiers and impossible dates", () => {
    expect(() =>
      parseRegistryYaml(fixture.replace("observedOn: 2026-10-20", "observedOn: 2026-02-30")),
    ).toThrow();
    expect(() =>
      parseRegistryYaml(fixture.replace("identifier: odi-mail@example.com", 'identifier: ""')),
    ).toThrow();
  });
  it("refuses credential values passed directly to the public settings builder", () => {
    const snap = parseRegistryYaml(fixture);
    const first = snap.accounts[0];
    if (!first) throw new Error("Fixture account absent");
    first.refs = ["test-token-0123456789"];
    expect(() => inventorySettings(snap, salt)).toThrow("Invalid registry schema");
  });
  it("rejects private identifiers in credential references even across Unicode normalisation", () => {
    const snap = parseRegistryYaml(fixture);
    const first = snap.accounts[0];
    if (!first) throw new Error("Fixture account absent");
    first.handles = ["café@example.com"];
    first.refs = ["op://test-vault/cafe\u0301@example.com/credential"];
    expect(() => inventorySettings(snap, salt)).toThrow("private identifier");
  });
  it.each([
    ["gmail-main@example.com", "gmail-main%40example.com"],
    [
      "gmail-main@example.com",
      "%67%6D%61%69%6C%2D%6D%61%69%6E%40%65%78%61%6D%70%6C%65%2E%63%6F%6D",
    ],
    ["café@example.com", "cafe%CC%81%40example.com"],
    ["123456789", "%31%32%33%34%35%36%37%38%39"],
    ["@fixture:Example.org", "%40fixture%3AExample.org"],
  ])("rejects encoded private handle %s in every reference component", (handle, encoded) => {
    for (const ref of [
      `op://${encoded}/item/credential`,
      `op://test-vault/${encoded}/credential`,
      `op://test-vault/item/${encoded}`,
    ]) {
      const snap = parseRegistryYaml(fixture);
      const first = snap.accounts[0];
      if (!first) throw new Error("Fixture account absent");
      first.handles = [handle];
      first.refs = [ref];
      expect(() => inventorySettings(snap, salt)).toThrow("private identifier");
    }
  });
  it.each([
    "op://test-vault/item%/credential",
    "op://test-vault/item%GG/credential",
    "op://test-vault/item%C3%28/credential",
    "op://test-vault/item/credential%00",
  ])("rejects malformed or control-bearing decoded references", (ref) => {
    const snap = parseRegistryYaml(fixture);
    const first = snap.accounts[0];
    if (!first) throw new Error("Fixture account absent");
    first.refs = [ref];
    expect(() => inventorySettings(snap, salt)).toThrow("Invalid registry schema");
  });
  it("preserves valid encoded references verbatim", () => {
    const snap = parseRegistryYaml(fixture);
    const first = snap.accounts[0];
    if (!first) throw new Error("Fixture account absent");
    first.refs = ["op://test%20vault/account%2D01/credential", "profile:fixture"];
    expect(inventorySettings(snap, salt).connections[0]?.credentialRefs).toEqual(first.refs);
  });
});

describe("pilot assessments without a provider grant", () => {
  it("treats stale, missing, future and malformed observations as stale", () => {
    const c = connection();
    expect(connectionStatus(c, new Date("2026-10-26T00:00:00Z"))).toEqual({
      state: "setup-required",
      stale: false,
      identityConflict: false,
    });
    expect(connectionStatus(c, new Date("2026-11-26T00:00:00Z")).stale).toBe(true);
    expect(connectionStatus(c, new Date("2026-09-26T00:00:00Z")).stale).toBe(true);
    delete c.inventory.lastTested;
    delete c.inventory.observedAt;
    expect(connectionStatus(c, new Date()).stale).toBe(true);
    c.inventory.observedAt = "invalid";
    expect(connectionStatus(c, new Date()).stale).toBe(true);
  });
  it.each([
    "none",
    "connected",
    "disabled",
    "error",
  ] as const)("assesses %s without establishing live access", (bindingState) => {
    const c = connection();
    c.bindingState = bindingState;
    expect(connectionStatus(c, new Date("2026-10-26T00:00:00Z")).state).toBe(
      bindingState === "disabled" || bindingState === "error" ? bindingState : "inventory",
    );
  });
  it("keeps provider, owner and workflow policy decisions independent and sends denied", () => {
    const s = settings();
    const c = connection();
    expect(effectiveCapability(c, "read", null)).toEqual({
      allowed: false,
      provider: false,
      owner: false,
      policy: false,
    });
    c.restrictions = { read: true, triage: true, draft: true, send: true };
    for (const cap of ["read", "triage", "draft"] as const)
      expect(effectiveCapability(c, cap, s.workflowPolicy)).toEqual({
        allowed: false,
        provider: false,
        owner: true,
        policy: true,
      });
    expect(effectiveCapability(c, "send", s.workflowPolicy)).toEqual({
      allowed: false,
      provider: false,
      owner: false,
      policy: false,
    });
    c.restrictions.read = false;
    expect(effectiveCapability(c, "triage", s.workflowPolicy).owner).toBe(false);
    expect(capabilityMatrix(s)).toHaveLength(29);
    expect(capabilityMatrix(s).every((row) => row.capabilities.every((cap) => !cap.allowed))).toBe(
      true,
    );
  });
});
