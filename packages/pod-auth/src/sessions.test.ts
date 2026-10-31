// AUTHORED-BY Codex GPT-6.1-Sol
import type { RefreshSessionRecord } from "@jeswr/reactive-authentication";
import { beforeAll, expect, test, vi } from "vitest";
import { scopedStore } from "./kv.js";
import { memoryStore, sessionStorage } from "./sessions.js";
import type { PodAuthOptions } from "./types.js";

const namespace = "sessions-test";
const webId = "https://id.example/alice#me",
  issuer = "https://op.example/",
  clientId = "https://app.example/client";
const options: PodAuthOptions = {
  clientId,
  redirectUri: "https://app.example/callback",
  ui: { getWebId: async () => webId, getCode: async () => "" },
};
let record: RefreshSessionRecord;
beforeAll(async () => {
  record = {
    generation: 0,
    created: Date.now(),
    refreshToken: "test-refresh",
    dpopKey: await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
      "sign",
      "verify",
    ]),
    client: { client_id: clientId },
    authorizationServer: { issuer },
    identity: { issuer, subject: "alice", webId, webIdVerified: true, audience: [clientId] },
  };
});
function setup() {
  const raw = memoryStore();
  const state = scopedStore(raw, namespace + ":sessions");
  const persistence = sessionStorage(raw, namespace, options);
  return { state, persistence, raw };
}

test("catalog aliases point to one credential tuple, support scoped removal, and preserve account separation", async () => {
  const { persistence: p, state } = setup();
  await p.sessions.setItem("first", record);
  await p.sessions.setItem("second", record);
  expect(await p.lock("first")).toBe(await p.lock("second"));
  expect(await p.sessions.getItem("first")).toEqual(record);
  expect(
    await p.present({
      webId: "https://bob.example/me",
      issuer,
      selected: {},
      requestUrl: issuer,
      context: "context",
    }),
  ).toBe(false);
  expect(
    await p.present({
      webId,
      issuer: "https://other.example/",
      selected: {},
      requestUrl: issuer,
      context: "context",
    }),
  ).toBe(false);
  expect(
    await p.present({ webId, issuer, selected: {}, requestUrl: issuer, context: "context" }),
  ).toBe(true);
  await p.sessions.removeItem("missing");
  await p.sessions.removeItem("second");
  expect(await p.sessions.getItem("first")).toBeNull();
  expect(
    await p.present({ webId, issuer, selected: {}, requestUrl: issuer, context: "context" }),
  ).toBe(false);
  await p.clear();
  expect(await p.keys()).toEqual([]);
  expect(await state.getItem("accounts")).toBeNull();
});

test.each([
  ["missing pair", (r: RefreshSessionRecord) => ({ ...r, dpopKey: undefined })],
  [
    "serialized keys",
    (r: RefreshSessionRecord) => ({ ...r, dpopKey: { privateKey: {}, publicKey: {} } }),
  ],
  [
    "swapped key roles",
    (r: RefreshSessionRecord) => ({
      ...r,
      dpopKey: { privateKey: r.dpopKey.publicKey, publicKey: r.dpopKey.privateKey },
    }),
  ],
  ["empty refresh", (r: RefreshSessionRecord) => ({ ...r, refreshToken: "" })],
  ["nonstring refresh", (r: RefreshSessionRecord) => ({ ...r, refreshToken: 42 })],
  [
    "wrong WebID",
    (r: RefreshSessionRecord) => ({
      ...r,
      identity: { ...r.identity, webId: "https://id.example/bob#me" },
    }),
  ],
  [
    "wrong identity issuer",
    (r: RefreshSessionRecord) => ({
      ...r,
      identity: { ...r.identity, issuer: "https://other.example/" },
    }),
  ],
  ["missing identity", (r: RefreshSessionRecord) => ({ ...r, identity: undefined })],
  [
    "wrong authorization server",
    (r: RefreshSessionRecord) => ({
      ...r,
      authorizationServer: { issuer: "https://other.example/" },
    }),
  ],
  [
    "missing authorization server",
    (r: RefreshSessionRecord) => ({ ...r, authorizationServer: undefined }),
  ],
  [
    "wrong client",
    (r: RefreshSessionRecord) => ({ ...r, client: { client_id: "https://other.example/client" } }),
  ],
])("a %s record is discarded before credential use", async (_name, corrupt) => {
  const { persistence: p, state } = setup();
  await p.sessions.setItem("account", record);
  const key = JSON.stringify([issuer, webId, clientId]);
  await state.setItem(key, corrupt(record));
  expect(await p.sessions.getItem("account")).toBeNull();
  expect(await state.getItem(key)).toBeNull();
});

test("extractable, wrong curve, wrong algorithm, missing usages and mismatched DPoP keys fail closed", async () => {
  const { persistence: p, state } = setup();
  const extractable = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const wrongCurve = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-384" },
    false,
    ["sign", "verify"],
  );
  const rsa = await crypto.subtle.generateKey(
    {
      name: "RSA-PSS",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    false,
    ["sign", "verify"],
  );
  const other = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
    "verify",
  ]);
  const jwk = await crypto.subtle.exportKey("jwk", record.dpopKey.publicKey);
  const hidden = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  const noUsages = await crypto.subtle.importKey(
    "jwk",
    { ...jwk, key_ops: [] },
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    [],
  );
  for (const dpopKey of [
    extractable,
    wrongCurve,
    rsa,
    { ...record.dpopKey, publicKey: hidden },
    { ...record.dpopKey, publicKey: noUsages },
    { ...record.dpopKey, publicKey: other.publicKey },
  ]) {
    await p.sessions.setItem("account", record);
    await state.setItem(JSON.stringify([issuer, webId, clientId]), { ...record, dpopKey });
    expect(await p.sessions.getItem("account")).toBeNull();
  }
  await expect(p.sessions.setItem("bad", { ...record, dpopKey: extractable })).rejects.toThrow(
    "Invalid persisted",
  );
  await p.sessions.setItem("account", record);
  const sign = vi.spyOn(crypto.subtle, "sign").mockRejectedValueOnce(new Error("unloadable key"));
  expect(await p.sessions.getItem("account")).toBeNull();
  sign.mockRestore();
});

test("static client configurations reject foreign credentials; dynamic client IDs are scoped as issued", async () => {
  const { persistence: p } = setup();
  await expect(
    p.sessions.setItem("bad", { ...record, client: { client_id: "foreign" } }),
  ).rejects.toThrow("Invalid persisted");
  const dynamic = sessionStorage(memoryStore(), "dynamic", {
    ...options,
    clientId: { dynamicRegistration: true },
  });
  await dynamic.sessions.setItem("account", { ...record, client: { client_id: "dynamic-client" } });
  expect((await dynamic.sessions.getItem("account"))?.client.client_id).toBe("dynamic-client");
});

test("no WebID means memory-only and malformed remembered pointers are not exposed", async () => {
  const { persistence: p, state } = setup();
  const { identity: _identity, ...withoutIdentity } = record;
  await p.sessions.setItem("missing-webid", withoutIdentity);
  expect(await p.keys()).toEqual([]);
  const pointer = { webId, issuer, requestUrl: issuer, selected: {}, context: "context" };
  for (const value of [
    { ...pointer, webId: 42 },
    { ...pointer, webId: "invalid" },
    { ...pointer, selected: null },
    { ...pointer, selected: "invalid" },
  ]) {
    await state.setItem("active", value);
    expect(await p.active()).toBeNull();
  }
  await p.remember(pointer);
  expect(await p.active()).toEqual(pointer);
});
