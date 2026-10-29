// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare module specifiers
// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { execFileSync, spawnSync } from "child_process";
import { createHash } from "crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fileURLToPath } from "url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  CredentialStore,
  defaultStoreDir,
  GOOGLE,
  requestedScopes,
  requiredScopes,
  StoreTokenProvider,
  tokenFileProviders,
} from "../src/index.js";
import {
  accessToken,
  calendars,
  grantBindingProblem,
  helperExchange,
  logout,
} from "../src/operations.js";
import { noTransport } from "../src/providers.js";
import { provisionValue } from "../src/provision.js";
import type { Grant, Profile, TokenFile } from "../src/store.js";

let base: string;
let store: CredentialStore;
const now = new Date("2026-10-26T00:00:00Z");
const clientId = "fixture.apps.googleusercontent.com";
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "credentials-grants-"));
  store = new CredentialStore({ dir: join(base, "store") });
  store.putClient({
    version: 1,
    provider: "google",
    clientId,
    importedFrom: "fixture",
    importedAt: now.toISOString(),
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(base, { recursive: true, force: true });
});
const profile = (over: Partial<Profile> = {}): Profile => ({
  version: 1,
  name: "read",
  provider: "google",
  connectionId: "owner",
  account: "owner@example.org",
  purpose: "read",
  resource: "mail",
  inventory: false,
  createdAt: now.toISOString(),
  ...over,
});
function grant(p: Profile, over: Partial<Grant> = {}): Grant {
  return {
    version: 1,
    profile: p.name,
    provider: p.provider,
    purpose: p.purpose,
    resource: p.resource,
    clientId,
    account: { subject: "fixture-sub", username: p.account },
    state: "active",
    grantedScopes: requiredScopes(p),
    access: { token: "test-token-0123456789", expiresAt: "2099-01-01T00:00:00Z" },
    obtainedAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...over,
  };
}
it.each([
  "google",
  "microsoft",
] as const)("removes corrupt and legacy %s grants locally under the profile lock without deserializing", async (provider) => {
  const p = profile({ provider });
  store.putProfile(p);
  const path = join(store.dir, "grants", `${p.name}.json`);
  const lock = join(store.dir, "locks", `${p.name}.lock`);
  const transport = vi.fn(noTransport);
  const read = vi.spyOn(store, "grant");
  const remove = store.removeGrant.bind(store);
  vi.spyOn(store, "removeGrant").mockImplementation((name) => {
    expect(existsSync(lock)).toBe(true);
    return remove(name);
  });
  for (const content of [
    "{corrupt",
    JSON.stringify({ ...grant(p), purpose: undefined, resource: undefined }),
  ]) {
    writeFileSync(path, content, { mode: 0o600 });
    await expect(
      logout({ store, transport, now: () => now }, p.name, false),
    ).resolves.toMatchObject({ removed: true, revoked: false });
    expect(existsSync(path)).toBe(false);
    expect(existsSync(lock)).toBe(false);
  }
  expect(read).not.toHaveBeenCalled();
  expect(transport).not.toHaveBeenCalled();
});
it("preserves unreadable Google grants on remote revoke and skips remote calls without a refresh token", async () => {
  const p = profile();
  store.putProfile(p);
  const path = join(store.dir, "grants", `${p.name}.json`);
  const transport = vi.fn(noTransport);
  const deps = { store, transport, now: () => now };
  for (const content of [
    "{corrupt",
    JSON.stringify({ ...grant(p), purpose: undefined, resource: undefined }),
  ]) {
    writeFileSync(path, content, { mode: 0o600 });
    await expect(logout(deps, p.name, true)).rejects.toThrow(/corrupt/);
    expect(readFileSync(path, "utf8")).toBe(content);
    expect(existsSync(join(store.dir, "locks", `${p.name}.lock`))).toBe(false);
  }
  store.putGrant(grant(p));
  expect(await logout(deps, p.name, true)).toMatchObject({ removed: true, revoked: false });
  expect(await logout(deps, p.name, true)).toMatchObject({ removed: false, revoked: false });
  expect(transport).not.toHaveBeenCalled();
});
it("removes unreadable Microsoft grants with --revoke without reading or contacting a provider", async () => {
  const p = profile({ provider: "microsoft" });
  store.putProfile(p);
  writeFileSync(join(store.dir, "grants", `${p.name}.json`), "{corrupt", { mode: 0o600 });
  const read = vi.spyOn(store, "grant");
  const transport = vi.fn(noTransport);
  expect(await logout({ store, transport, now: () => now }, p.name, true)).toMatchObject({
    removed: true,
    revoked: false,
    remains: expect.stringContaining("Microsoft"),
  });
  expect(read).not.toHaveBeenCalled();
  expect(transport).not.toHaveBeenCalled();
});
it("retains filesystem protections when locally removing unreadable grants", async () => {
  const p = profile();
  store.putProfile(p);
  const path = join(store.dir, "grants", `${p.name}.json`);
  const transport = vi.fn(noTransport);
  const deps = { store, transport, now: () => now };
  writeFileSync(path, "{corrupt", { mode: 0o644 });
  await expect(logout(deps, p.name, false)).rejects.toThrow(/chmod 600/);
  expect(readFileSync(path, "utf8")).toBe("{corrupt");
  rmSync(path);
  const target = join(base, "target.json");
  writeFileSync(target, "{corrupt", { mode: 0o600 });
  symlinkSync(target, path);
  await expect(logout(deps, p.name, false)).rejects.toThrow(/symbolic link/);
  expect(readFileSync(target, "utf8")).toBe("{corrupt");
  rmSync(path);
  mkdirSync(path, { mode: 0o700 });
  await expect(logout(deps, p.name, false)).rejects.toThrow(/not a file/);
  expect(existsSync(path)).toBe(true);
  expect(existsSync(join(store.dir, "locks", `${p.name}.lock`))).toBe(false);
  expect(transport).not.toHaveBeenCalled();
});
it("constructs platform paths without creating or reading the real store", () => {
  const home = join(base, "absent-home");
  expect(defaultStoreDir({ platform: "darwin", home })).toBe(
    join(home, "Library/Application Support/jeswr-agent"),
  );
  expect(defaultStoreDir({ platform: "linux", home, xdgDataHome: "" })).toBe(
    join(home, ".local/share/jeswr-agent"),
  );
  expect(defaultStoreDir({ platform: "linux", home, xdgDataHome: "relative" })).toBe(
    join(home, ".local/share/jeswr-agent"),
  );
  expect(defaultStoreDir({ platform: "linux", home, xdgDataHome: base })).toBe(
    join(base, "jeswr-agent"),
  );
  expect(typeof defaultStoreDir()).toBe("string");
  expect(existsSync(home)).toBe(false);
});
it("never supplies read grants to send or send grants to read, even with overlapping scopes", async () => {
  const p = profile();
  store.putProfile(p);
  store.putGrant(grant(p, { grantedScopes: [GOOGLE.MAIL_READ, GOOGLE.MAIL_SEND] }));
  const tokens = new StoreTokenProvider("google", { store, now: () => now });
  expect(await tokens.read({ id: "owner" })).toHaveProperty("accessToken", "test-token-0123456789");
  await expect(tokens.send({ id: "owner" })).rejects.toThrow(/exactly one/);
  await expect(tokens.read({ id: "unknown" })).rejects.toThrow(/exactly one/);
  const send = profile({ name: "send", purpose: "send" });
  store.putProfile(send);
  store.putGrant(grant(send));
  expect(await tokens.send({ id: "owner" })).toHaveProperty("accessToken", "test-token-0123456789");
  // A copied grant cannot be relabelled just by changing its filename/profile.
  store.putGrant({
    ...grant(p),
    profile: "send",
    grantedScopes: [GOOGLE.MAIL_READ, GOOGLE.MAIL_SEND],
  });
  await expect(tokens.send({ id: "owner" })).rejects.toThrow(/purpose/);
  expect(grantBindingProblem({ ...grant(p), resource: "calendar" }, p, clientId)).toMatch(
    /purpose/,
  );
  const exchange = await helperExchange(
    { store, now: () => now, transport: noTransport },
    p.name,
    JSON.stringify({
      provider: "google",
      connectionId: "owner",
      purpose: "send",
      scopes: [GOOGLE.MAIL_SEND],
    }),
  );
  expect(exchange.exit).toBe(2);
  expect(exchange.stdout).toBeUndefined();
});
it("rejects a profile whose embedded name redirects selection to another binding", async () => {
  const selected = profile();
  const other = profile({ name: "send", purpose: "send", connectionId: "other" });
  store.putProfile(other);
  store.putGrant(grant(other));
  writeFileSync(
    join(store.dir, "profiles", `${selected.name}.json`),
    JSON.stringify({ ...selected, name: other.name }),
    { mode: 0o600 },
  );
  const transport = vi.fn(noTransport);
  await expect(
    new StoreTokenProvider("google", { store, transport, now: () => now }).read({ id: "owner" }),
  ).rejects.toMatchObject({ code: "invalid", message: expect.stringMatching(/another name/) });
  expect(transport).not.toHaveBeenCalled();
});
it.each([
  { provider: "microsoft" as const },
  { connectionId: "other" },
  { purpose: "send" as const },
  { resource: "calendar" as const },
])("rechecks the requested tuple when the selected profile changes: %j", async (change) => {
  const selected = profile();
  store.putProfile(selected);
  // Replace the actual file after selection reads it, before accessToken reloads it.
  const read = store.profile.bind(store);
  vi.spyOn(store, "profile").mockImplementationOnce((name) => {
    const result = read(name);
    const replacement = profile(change);
    store.putProfile(replacement);
    store.putGrant(grant(replacement));
    return result;
  });
  const transport = vi.fn(noTransport);
  await expect(
    new StoreTokenProvider("google", { store, transport, now: () => now }).read({ id: "owner" }),
  ).rejects.toMatchObject({
    code: "refused",
    message: expect.stringMatching(/requested credential binding/),
  });
  expect(transport).not.toHaveBeenCalled();
});
it.each([
  { provider: "microsoft" as const },
  { connectionId: "other" },
  { purpose: "send" as const },
  { resource: "calendar" as const },
])("binds helper issuance to the validated profile when it changes: %j", async (change) => {
  const selected = profile();
  store.putProfile(selected);
  const microsoftClientId = "11111111-1111-4111-8111-111111111111";
  const tenantId = "22222222-2222-4222-8222-222222222222";
  const objectId = "33333333-3333-4333-8333-333333333333";
  store.putClient({
    version: 1,
    provider: "microsoft",
    clientId: microsoftClientId,
    addedAt: now.toISOString(),
  });
  const replacement = profile({
    ...change,
    microsoft: {
      accountType: "work-or-school",
      tenant: tenantId,
      expectedIdentity: { tenantId, objectId },
    },
  });
  const replacementGrant = grant(replacement, {
    clientId: replacement.provider === "microsoft" ? microsoftClientId : clientId,
    account:
      replacement.provider === "microsoft"
        ? { username: replacement.account, tenant: tenantId, subject: objectId }
        : { username: replacement.account, subject: "fixture-sub" },
    // Overlapping scopes must not allow the replacement to satisfy the original request.
    grantedScopes: [...new Set([...requiredScopes(selected), ...requiredScopes(replacement)])],
  });
  const read = store.profile.bind(store);
  vi.spyOn(store, "profile").mockImplementationOnce((name) => {
    const result = read(name);
    store.putProfile(replacement);
    store.putGrant(replacementGrant);
    return result;
  });
  const grantRead = vi.spyOn(store, "grant");
  const transport = vi.fn(noTransport);
  const answer = await helperExchange(
    { store, transport, now: () => now },
    selected.name,
    JSON.stringify({
      provider: selected.provider,
      connectionId: selected.connectionId,
      purpose: selected.purpose,
      scopes: requiredScopes(selected),
    }),
  );
  expect(answer).toEqual({
    exit: 2,
    problem: "the requested credential binding does not match this profile",
  });
  expect(answer.stdout).toBeUndefined();
  expect(grantRead).not.toHaveBeenCalled();
  expect(transport).not.toHaveBeenCalled();
});
it.each([
  { provider: "microsoft" as const },
  { connectionId: "other" },
  { purpose: "send" as const, resource: "mail" as const },
  { resource: "mail" as const },
])("binds inventory issuance to the validated profile when it changes: %j", async (change) => {
  const selected = profile({ resource: "calendar", inventory: true });
  store.putProfile(selected);
  const microsoftClientId = "11111111-1111-4111-8111-111111111111";
  const tenantId = "22222222-2222-4222-8222-222222222222";
  const objectId = "33333333-3333-4333-8333-333333333333";
  store.putClient({
    version: 1,
    provider: "microsoft",
    clientId: microsoftClientId,
    addedAt: now.toISOString(),
  });
  const replacement = {
    ...selected,
    ...change,
    microsoft: {
      accountType: "work-or-school" as const,
      tenant: tenantId,
      expectedIdentity: { tenantId, objectId },
    },
  };
  const replacementGrant = grant(replacement, {
    clientId: replacement.provider === "microsoft" ? microsoftClientId : clientId,
    account:
      replacement.provider === "microsoft"
        ? { username: replacement.account, tenant: tenantId, subject: objectId }
        : { username: replacement.account, subject: "fixture-sub" },
    grantedScopes: [...new Set([...requiredScopes(selected), ...requiredScopes(replacement)])],
  });
  const read = store.profile.bind(store);
  vi.spyOn(store, "profile").mockImplementationOnce((name) => {
    const result = read(name);
    store.putProfile(replacement);
    store.putGrant(replacementGrant);
    return result;
  });
  const grantRead = vi.spyOn(store, "grant");
  const transport = vi.fn(async () => new Response(JSON.stringify({ items: [], value: [] })));
  await expect(
    calendars({ store, transport, now: () => now }, selected.name),
  ).rejects.toMatchObject({
    code: "refused",
    message: "the requested credential binding does not match this profile",
  });
  expect(grantRead).not.toHaveBeenCalled();
  expect(transport).not.toHaveBeenCalled();
});
it("refuses missing cached scopes, duplicates and a send-only account on the read path", async () => {
  const p = profile();
  store.putProfile(p);
  store.putGrant(grant(p, { grantedScopes: [] }));
  await expect(
    accessToken({ store, now: () => now, transport: noTransport }, p.name),
  ).rejects.toThrow(/scopes missing/);
  store.putProfile(profile({ name: "duplicate" }));
  await expect(new StoreTokenProvider("google", { store }).read({ id: "owner" })).rejects.toThrow(
    /exactly one/,
  );
  store.putProfile(profile({ name: "send-only", connectionId: "sender", purpose: "send" }));
  const tokens = new StoreTokenProvider("google", { store });
  await expect(tokens.read({ id: "sender" })).rejects.toThrow(/exactly one/);
});
it("separates Gmail read/send, calendar and Microsoft mail/Teams grants", () => {
  expect(requiredScopes(profile())).toEqual([GOOGLE.MAIL_READ]);
  expect(requiredScopes(profile({ purpose: "send" }))).toEqual([GOOGLE.MAIL_SEND]);
  expect(requiredScopes(profile({ resource: "calendar" }))).toEqual([GOOGLE.CALENDAR_READ]);
  expect(() => requiredScopes(profile({ resource: "calendar", purpose: "send" }))).toThrow(
    /not supported/,
  );
  expect(() => requiredScopes(profile({ resource: "teams" }))).toThrow(/Teams/);
  for (const [resource, purpose, scopes] of [
    ["mail", "read", ["Mail.Read"]],
    ["mail", "send", ["Mail.Send"]],
    ["teams", "read", ["Chat.Read", "ChannelMessage.Read.All"]],
    ["teams", "send", ["ChatMessage.Send"]],
    ["calendar", "read", ["Calendars.ReadBasic"]],
  ] as const) {
    const p = profile({ provider: "microsoft", resource, purpose });
    expect(requiredScopes(p)).toEqual(scopes);
    expect(requestedScopes(p)).toContain("offline_access");
  }
  expect(() =>
    requiredScopes(profile({ provider: "microsoft", resource: "calendar", purpose: "send" })),
  ).toThrow(/not supported/);
});
it.each(
  tokenFileProviders,
)("provisions and separates %s token files with reference-only receipts", async (provider) => {
  const record = {
    store,
    provider,
    account: "owner",
    purpose: "read" as const,
    reference: "op://fixture/item/token",
    value: "test-token-0123456789\n",
    now,
  };
  expect(provisionValue(record)).toEqual({ credentialRef: record.reference });
  const tokens = new StoreTokenProvider(provider, { store, now: () => now });
  expect(await tokens.read({ id: "owner" })).toHaveProperty("accessToken", "test-token-0123456789");
  await expect(tokens.send({ id: "owner" })).rejects.toThrow(/exactly one/);
  const originalNames = store.tokenFiles();
  const replacement = {
    ...record,
    reference: "op://fixture/replacement/token",
    value: "test-new-token-0123456789",
  };
  expect(provisionValue(replacement)).toEqual({ credentialRef: replacement.reference });
  expect(store.tokenFiles()).toEqual(originalNames);
  expect(await tokens.read({ id: "owner" })).toHaveProperty("accessToken", replacement.value);
  expect(() => provisionValue({ ...replacement, value: "invalid" })).toThrow(/invalid record/);
  expect(await tokens.read({ id: "owner" })).toHaveProperty("accessToken", replacement.value);
  provisionValue({ ...record, account: "other", value: "test-other-token-0123456789" });
  expect(await tokens.read({ id: "other" })).toHaveProperty(
    "accessToken",
    "test-other-token-0123456789",
  );
  provisionValue({ ...record, purpose: "send", value: "test-send-token-0123456789" });
  expect(await tokens.send({ id: "owner" })).toHaveProperty(
    "accessToken",
    "test-send-token-0123456789",
  );
  const t = fixtureValue(
    store
      .tokenFiles()
      .map((name) => store.tokenFile(name))
      .find((t) => t?.account === "owner" && t.purpose === "read"),
  );
  store.putTokenFile({ ...t, expiresAt: "2020-01-01T00:00:00Z" });
  await expect(
    t.purpose === "read" ? tokens.read({ id: "owner" }) : tokens.send({ id: "owner" }),
  ).rejects.toThrow(/expired/);
  store.putTokenFile({ ...t, expiresAt: "2099-01-01T00:00:00Z" });
  expect(
    await (t.purpose === "read" ? tokens.read({ id: "owner" }) : tokens.send({ id: "owner" })),
  ).toHaveProperty("accessToken", t.token);
  store.putTokenFile({ ...t, name: "duplicate" });
  await expect(
    t.purpose === "read" ? tokens.read({ id: "owner" }) : tokens.send({ id: "owner" }),
  ).rejects.toThrow(/exactly one/);
});
it.each([
  "same",
  "different",
])("migrates legacy reference-keyed tokens when reprovisioning the %s reference", async (referenceChoice) => {
  const legacy = (over: Partial<TokenFile> = {}): TokenFile => {
    const record = {
      version: 1 as const,
      provider: "slack" as const,
      account: "owner",
      purpose: "read" as const,
      token: "test-old-token-0123456789",
      credentialRef: "op://fixture/item/token",
      ...over,
    };
    // The filename algorithm used before tuple-keyed provisioning was introduced.
    return {
      ...record,
      name: `${record.provider}-${createHash("sha256")
        .update(JSON.stringify([record.credentialRef, record.account, record.purpose]))
        .digest("hex")
        .slice(0, 20)}`,
    };
  };
  const original = legacy();
  store.putTokenFile(original);
  const unrelated = [
    legacy({ account: "other" }),
    legacy({ purpose: "send" }),
    legacy({ provider: "discord" }),
  ];
  for (const record of unrelated) store.putTokenFile(record);
  const tokens = new StoreTokenProvider("slack", { store, now: () => now });
  expect(await tokens.read({ id: "owner" })).toHaveProperty("accessToken", original.token);
  const options = {
    store,
    provider: original.provider,
    account: original.account,
    purpose: original.purpose,
    reference:
      referenceChoice === "same" ? original.credentialRef : "op://fixture/replacement/token",
    value: "test-new-token-0123456789",
    now,
  };
  expect(() => provisionValue({ ...options, value: "invalid" })).toThrow(/invalid record/);
  expect(store.tokenFile(original.name)).toEqual(original);
  expect(await tokens.read({ id: "owner" })).toHaveProperty("accessToken", original.token);
  expect(provisionValue(options)).toEqual({ credentialRef: options.reference });
  expect(store.tokenFile(original.name)).toBeUndefined();
  expect(await tokens.read({ id: "owner" })).toHaveProperty("accessToken", options.value);
  const canonical = fixtureValue(
    store.tokenFiles().find((name) => !unrelated.some((record) => record.name === name)),
  );
  expect(canonical).toBe(
    `slack-${createHash("sha256")
      .update(JSON.stringify(["slack", "owner", "read"]))
      .digest("hex")
      .slice(0, 20)}`,
  );
  // Also repair stores containing both a canonical record and several legacy references.
  const secondLegacy = legacy({ credentialRef: "op://fixture/another/token" });
  store.putTokenFile(original);
  store.putTokenFile(secondLegacy);
  await expect(tokens.read({ id: "owner" })).rejects.toThrow(/exactly one/);
  provisionValue({ ...options, value: "test-final-token-0123456789" });
  expect(await tokens.read({ id: "owner" })).toHaveProperty(
    "accessToken",
    "test-final-token-0123456789",
  );
  expect(store.tokenFile(original.name)).toBeUndefined();
  expect(store.tokenFile(secondLegacy.name)).toBeUndefined();
  expect(store.tokenFiles()).toHaveLength(unrelated.length + 1);
  for (const record of unrelated) expect(store.tokenFile(record.name)).toEqual(record);
});
it("validates provisioned registration shapes and never returns secret material", () => {
  const opts = {
    store,
    account: "owner",
    purpose: "read" as const,
    reference: "op://fixture/item/token",
    now,
  };
  for (const value of [
    "bad-json",
    "null",
    "{}",
    '{"installed":{}}',
    '{"installed":{"client_id":"fixture.apps.googleusercontent.com","token_uri":"https://evil.example/token"}}',
  ])
    expect(() => provisionValue({ ...opts, provider: "google", value })).toThrow(/invalid/);
  const client = { client_id: clientId, client_secret: "test-client-secret-0123456789" };
  expect(
    provisionValue({ ...opts, provider: "google", value: JSON.stringify({ installed: client }) }),
  ).toEqual({ credentialRef: opts.reference });
  expect(store.googleClient()?.clientSecret).toBe(client.client_secret);
  provisionValue({
    ...opts,
    provider: "google",
    value: JSON.stringify({
      installed: { client_id: clientId, token_uri: "https://oauth2.googleapis.com/token" },
    }),
  });
  expect(store.googleClient()?.clientSecret).toBeUndefined();
  provisionValue({
    ...opts,
    provider: "microsoft",
    value: "00000000-1111-4222-8333-444444444444\n",
  });
  expect(store.microsoftClient()?.clientId).toBe("00000000-1111-4222-8333-444444444444");
  expect(() =>
    provisionValue({
      ...opts,
      provider: "slack",
      reference: "invalid",
      value: "test-token-0123456789",
    }),
  ).toThrow(/reference/);
});
it("dry-run and real provisioning use only the fake op and never echo its values", async () => {
  const fakeOp = join(base, "op");
  const log = join(base, "op.log");
  writeFileSync(
    fakeOp,
    '#!/bin/sh\nprintf "%s\\n" "$2" >> "$FAKE_OP_LOG"\nprintf "test-token-%s-0123456789\\n" "$2"\nprintf "test-secret-error" >&2\n',
  );
  chmodSync(fakeOp, 0o700);
  const env = { ...process.env, PATH: `${base}:${process.env.PATH}`, FAKE_OP_LOG: log };
  const script = fileURLToPath(new URL("../../../scripts/provision.zsh", import.meta.url));
  const refs = ["op://fixture/item/token", "op://fixture/other/token"];
  const dir = join(base, "provisioned");
  const args = [
    script,
    "--dir",
    dir,
    "--provider",
    "slack",
    "--account",
    "owner",
    "--purpose",
    "read",
    ...refs,
  ];
  const dry = execFileSync("bash", [...args, "--dry-run"], { env, encoding: "utf8" });
  expect(dry).toBe(refs.map((ref) => `Would read ${ref}\n`).join(""));
  expect(existsSync(log)).toBe(false);
  expect(existsSync(dir)).toBe(false);
  const out = execFileSync("bash", args, { env, encoding: "utf8" });
  expect(out).toBe(refs.map((credentialRef) => `${JSON.stringify({ credentialRef })}\n`).join(""));
  expect(readFileSync(log, "utf8")).toBe(`${refs.join("\n")}\n`);
  expect(new CredentialStore(dir).tokenFiles()).toHaveLength(1);
  expect(
    await new StoreTokenProvider("slack", { store: new CredentialStore(dir) }).read({
      id: "owner",
    }),
  ).toHaveProperty("accessToken", `test-token-${refs[1]}-0123456789`);
  // A failing op may write arbitrary partial output: only exit status can signal success.
  writeFileSync(
    fakeOp,
    '#!/bin/sh\nprintf "test-partial-token-0123456789"\nprintf "test-secret-error" >&2\nexit 1\n',
  );
  const failed = spawnSync("bash", [...args.slice(0, -2), fixtureValue(refs[0])], {
    env,
    encoding: "utf8",
  });
  expect(failed.status).toBe(1);
  expect(failed.stdout).toBe("");
  expect(failed.stderr).not.toContain("test-");
  writeFileSync(fakeOp, '#!/bin/sh\nprintf "test-partial-token-0123456789\\000"\nexit 1\n');
  const binaryFailure = spawnSync("bash", [...args.slice(0, -2), fixtureValue(refs[0])], {
    env,
    encoding: "utf8",
  });
  expect(binaryFailure.status).toBe(1);
  expect(binaryFailure.stdout).toBe("");
  expect(new CredentialStore(dir).tokenFiles()).toHaveLength(1);
  expect(
    await new StoreTokenProvider("slack", { store: new CredentialStore(dir) }).read({
      id: "owner",
    }),
  ).toHaveProperty("accessToken", `test-token-${refs[1]}-0123456789`);

  expect(
    spawnSync("bash", [script, "--dir", dir, "--provider", "unknown", ...refs], { env }).status,
  ).toBe(1);
});
it("uses an injected calendar resource and a default clock without widening credentials", async () => {
  const p = profile({ resource: "calendar" });
  store.putProfile(p);
  store.putGrant(grant(p));
  expect(
    await new StoreTokenProvider("google", {
      store,
      resource: "calendar",
      transport: noTransport,
    }).read({ id: "owner" }),
  ).toHaveProperty("accessToken", "test-token-0123456789");
  provisionValue({
    store,
    provider: "slack",
    account: "owner",
    purpose: "read",
    reference: "op://fixture/item/token",
    value: "test-token-0123456789",
    now,
  });
  expect(await new StoreTokenProvider("slack", { store }).read({ id: "owner" })).toHaveProperty(
    "accessToken",
    "test-token-0123456789",
  );
  const record = fixtureValue(store.tokenFile(fixtureValue(store.tokenFiles()[0])));
  store.putTokenFile({ ...record, expiresAt: "2099-01-01T00:00:00Z" });
  expect(await new StoreTokenProvider("slack", { store }).read({ id: "owner" })).toHaveProperty(
    "accessToken",
    "test-token-0123456789",
  );
  await expect(
    new StoreTokenProvider("slack", { store, now: () => new Date(Number.NaN) }).read({
      id: "owner",
    }),
  ).rejects.toThrow(/expired/);
});

import { fixtureValue } from "./fixture.js";
