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
  parseSnapshot,
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
function matrixSnapshot(channel = "matrix") {
  return parseSnapshot({
    version: 1,
    accounts: ["matrix.example", "MATRIX.example"].map((server, index) => ({
      id: `matrix-${index}`,
      channel,
      provider: "matrix",
      organization: "personal",
      identifiers: { primary: `@fixture:${server}` },
      connector: { target: "matrix", setup_status: "planned" },
    })),
    evidence: [
      {
        channel,
        provider: "matrix",
        identifier: "  @fixture:matrix.example  ",
        method: "historic_connector",
        source: "synthetic",
        observedOn: "2026-10-20",
      },
    ],
  });
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
  it.each(["matrix", "matrix_bot"])("preserves %s case in normalisation and HMAC", (channel) => {
    expect(normaliseHandle("  @fixture:MATRIX.example  ", channel)).toBe("@fixture:MATRIX.example");
    expect(hashHandle("  @fixture:MATRIX.example  ", salt, channel)).toBe(
      createHmac("sha256", salt).update("@fixture:MATRIX.example").digest("hex"),
    );
    expect(hashHandle("@fixture:MATRIX.example", salt, channel)).not.toBe(
      hashHandle("@fixture:matrix.example", salt, channel),
    );
    expect(hashHandle("FIXTURE@example.com", salt, "email")).toBe(
      hashHandle("fixture@example.com", salt, "email"),
    );
  });
  it.each([
    "matrix",
    "matrix_bot",
  ])("keeps %s evidence and provider conflicts on the exact identity", (channel) => {
    const snap = matrixSnapshot(channel);
    const evidence = snap.evidence[0];
    if (!evidence) throw new Error("Fixture evidence absent");
    evidence.provider = "other_matrix";
    const s = inventorySettings(snap, salt);
    const lowerHash = hashHandle("@fixture:matrix.example", salt, channel);
    const upperHash = hashHandle("@fixture:MATRIX.example", salt, channel);
    expect(s.connections[0]).toMatchObject({
      channelHandles: [lowerHash],
      bindingState: "error",
      evidence: [{ handleHash: lowerHash }],
      identityConflicts: [{ kind: "provider-mismatch", handleHashes: [lowerHash] }],
    });
    expect(s.connections[1]).toMatchObject({
      channelHandles: [upperHash],
      bindingState: "setup-required",
      evidence: [],
      identityConflicts: [],
    });
    expect(s.unmatchedEvidence).toEqual([]);
  });
  it.each([
    "matrix",
    "matrix_bot",
  ])("keeps %s evidence with different server-name case unmatched", (channel) => {
    const snap = matrixSnapshot(channel);
    snap.accounts.splice(0, 1);
    const s = inventorySettings(snap, salt);
    expect(s.connections[0]?.evidence).toEqual([]);
    expect(s.connections[0]?.identityConflicts).toEqual([]);
    expect(s.unmatchedEvidence).toMatchObject([
      { handleHash: hashHandle("@fixture:matrix.example", salt, channel) },
    ]);
  });
  it.each(["matrix", "matrix_bot"])("matches conflict-note identities with %s case", (channel) => {
    const snap = matrixSnapshot(channel);
    const other = "@other:Elsewhere.example";
    snap.evidence.push({
      channel,
      provider: "matrix",
      identifier: other,
      method: "historic_connector",
      observedOn: "2026-10-20",
    });
    snap.notes = [`Identity conflict: @fixture:matrix.example versus ${other}`];
    const s = inventorySettings(snap, salt);
    expect(s.connections[0]?.identityConflicts).toEqual([
      {
        kind: "identity-mismatch",
        handleHashes: [
          hashHandle("@fixture:matrix.example", salt, channel),
          hashHandle(other, salt, channel),
        ].sort(),
      },
    ]);
    expect(s.connections[1]?.identityConflicts).toEqual([]);
    expect(s.unmatchedEvidence).toMatchObject([{ handleHash: hashHandle(other, salt, channel) }]);
  });
  it.each([
    ["email", "alice@example.com", "malice@example.com", "MALICE@example.com"],
    ["email", "alice@example.com", "alice@example.com.example", "ALICE@example.com.example"],
    ["email", "alice@example.com", "alice+tag@example.com", "ALICE+TAG@example.com"],
    ["email", "alice@example.com", "o'alice@example.com", "O'ALICE@example.com"],
    [
      "matrix",
      "@fixture:matrix.example",
      "@fixture:matrix.example.org",
      "@fixture:matrix.example.org",
    ],
    [
      "matrix_bot",
      "@fixture:matrix.example",
      "@fixture:matrix.example.org",
      "@fixture:matrix.example.org",
    ],
    ["github_notifications", "fixture", "prefixture", "PREFIXTURE"],
  ])("matches complete %s identities rather than substrings of %s", (channel, own, other, mention) => {
    const snap = parseSnapshot({
      version: 1,
      accounts: [own, other].map((handle, index) => ({
        id: `account-${index}`,
        channel,
        provider: "fixture_provider",
        organization: "personal",
        identifiers: { primary: handle },
        connector: { target: "fixture", setup_status: "planned" },
      })),
      notes: [`Identity conflict: <${mention}> versus alternate@example.org.`],
    });
    const s = inventorySettings(snap, salt);
    expect(s.connections[0]).toMatchObject({
      bindingState: "setup-required",
      identityConflicts: [],
    });
    expect(s.connections[1]).toMatchObject({
      bindingState: "error",
      identityConflicts: [
        {
          kind: "identity-mismatch",
          handleHashes: [
            hashHandle(other, salt, channel),
            hashHandle("alternate@example.org", salt, "email"),
          ].sort(),
        },
      ],
    });
    expect(JSON.stringify(s)).not.toContain(mention);
  });
  it.each([
    '"',
    "'",
    "`",
  ])("normalises complete Unicode email identifiers quoted with %s", (quote) => {
    const snap = parseRegistryYaml(fixture);
    const first = snap.accounts[0];
    if (!first) throw new Error("Fixture account absent");
    first.handles = ["café@example.com"];
    snap.notes = [
      `Identity conflict: ${quote}CAFE\u0301@example.com${quote}, versus (alternate@example.org).`,
    ];
    expect(inventorySettings(snap, salt).connections[0]?.identityConflicts).toEqual([
      {
        kind: "identity-mismatch",
        handleHashes: [
          hashHandle("café@example.com", salt, "email"),
          hashHandle("alternate@example.org", salt, "email"),
        ].sort(),
      },
    ]);
  });
  it.each([
    ["+1 202 555 0100", '"'],
    ["+1 202 555 0100", "'"],
    ["+1 202 555 0100", "`"],
    ["+1 (202) 555-0100", '"'],
    ["+1.202.555.0100", '"'],
  ])("preserves complete formatted phone mentions: %s quoted with %s", (own, quote) => {
    const other = "+1 (202) 555-0101";
    const snap = parseSnapshot({
      version: 1,
      accounts: [own, other, "202"].map((handle, index) => ({
        id: `phone-${index}`,
        channel: "phone_messages",
        provider: "fixture_provider",
        organization: "personal",
        identifiers: { primary: handle },
        connector: { target: "fixture", setup_status: "planned" },
      })),
      notes: [`Identity conflict: ${quote}${own}${quote} versus (${other}).`],
    });
    const s = inventorySettings(snap, salt);
    for (const account of s.connections.slice(0, 2))
      expect(account).toMatchObject({
        bindingState: "error",
        identityConflicts: [
          {
            kind: "identity-mismatch",
            handleHashes: [
              hashHandle(own, salt, "phone_messages"),
              hashHandle(other, salt, "phone_messages"),
            ].sort(),
          },
        ],
      });
    expect(s.connections[2]).toMatchObject({
      bindingState: "setup-required",
      identityConflicts: [],
    });
    expect(JSON.stringify(s)).not.toContain(own);
    expect(JSON.stringify(s)).not.toContain(other);
  });
  it.each([
    "+1 202 555 01001",
    "+1 (202) 555-0100x123",
    "9+1 202 555 0100",
  ])("does not match a phone inside a longer identifier: %s", (mention) => {
    const snap = parseSnapshot({
      version: 1,
      accounts: ["+1 202 555 0100", "+1 (202) 555-0100"].map((handle, index) => ({
        id: `phone-${index}`,
        channel: "phone_messages",
        provider: "fixture_provider",
        organization: "personal",
        identifiers: { primary: handle },
        connector: { target: "fixture", setup_status: "planned" },
      })),
      notes: [`Identity conflict: ${mention} versus alternate@example.org.`],
    });
    for (const account of inventorySettings(snap, salt).connections)
      expect(account).toMatchObject({ bindingState: "setup-required", identityConflicts: [] });
  });
  it.each([
    ["matrix", "@fixture:matrix.example", "@Other:Elsewhere.example"],
    ["matrix_bot", "@fixture:matrix.example", "@Other:Elsewhere.example"],
    ["phone_messages", "+12025550100", "+1 (202) 555-0101"],
    ["signal", "+1 202 555 0100", "+12025550101"],
  ])("retains notes-only %s alternatives with channel normalization", (channel, own, other) => {
    const snap = parseSnapshot({
      version: 1,
      accounts: [
        {
          id: "fixture-account",
          channel,
          provider: "fixture_provider",
          organization: "personal",
          identifiers: { primary: own },
          connector: { target: "fixture", setup_status: "planned" },
        },
      ],
      notes: [`Identity conflict: (${own}) versus "${other}". Unresolved.`],
    });
    const s = inventorySettings(snap, salt);
    expect(s.connections[0]).toMatchObject({
      channelHandles: [hashHandle(own, salt, channel)],
      bindingState: "error",
      identityConflicts: [
        {
          kind: "identity-mismatch",
          handleHashes: [hashHandle(own, salt, channel), hashHandle(other, salt, channel)].sort(),
        },
      ],
    });
    expect(s.unmatchedEvidence).toEqual([]);
    expect(JSON.stringify(s)).not.toContain(own);
    expect(JSON.stringify(s)).not.toContain(other);
  });
  it.each([
    "matrix",
    "matrix_bot",
  ])("rejects encoded %s references regardless of case", (channel) => {
    const snap = matrixSnapshot(channel);
    const upper = snap.accounts[1];
    if (!upper) throw new Error("Fixture account absent");
    snap.accounts = [upper];
    snap.evidence = [];
    upper.refs = ["op://test-vault/%40fixture%3Amatrix.example/credential"];
    expect(() => inventorySettings(snap, salt)).toThrow("private identifier");
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
  it.each([
    "unlisted@example.org",
    "@unlisted:Matrix.example",
    "@unlisted@social.example",
    "+12025550100",
    "https://unlisted.example/profile#me",
  ])("rejects unlisted identifier %s in decoded reference components", (handle) => {
    const snap = parseRegistryYaml(fixture);
    const first = snap.accounts[0];
    if (!first) throw new Error("Fixture account absent");
    snap.accounts = [first];
    first.handles = [];
    snap.evidence = [];
    snap.notes = [];
    for (const component of [handle, encodeURIComponent(handle)]) {
      // Raw URI syntax is already invalid as an op reference; exercise its encoded form.
      if (component.includes("https://")) continue;
      for (const ref of [
        `op://${component}/item/credential`,
        `op://test-vault/${component}/credential`,
        `op://test-vault/item/${component}`,
      ]) {
        first.refs = [ref];
        expect(() => inventorySettings(snap, salt)).toThrow("private identifier");
      }
    }
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
