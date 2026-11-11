// AUTHORED-BY Codex GPT-6
import { afterEach, expect, test } from "vitest";
import { pushFixture } from "../test/push-fixtures.js";
import type { createRelay } from "./relay.js";

let relay: ReturnType<typeof createRelay>;
afterEach(() => relay?.close());

test("strictly validates installation bodies, public P-256 keys and RFC 8291 encodings", async () => {
  const f = await pushFixture();
  relay = f.relay;
  const body = f.owner.body;
  for (const value of [
    null,
    [],
    "string",
    { ...body, extra: true },
    { ...body, platform: "web" },
    { ...body, platform: undefined },
    { ...body, pushToken: "" },
    { ...body, pushToken: 4 },
    { ...body, pushToken: "x".repeat(4097) },
    { ...body, devicePublicKey: undefined },
    { ...body, devicePublicKey: "invalid" },
    { ...body, devicePublicKey: `${body.devicePublicKey}=` },
    { ...body, devicePublicKey: Buffer.alloc(65).toString("base64url") },
    {
      ...body,
      devicePublicKey: Buffer.concat([Buffer.from([4]), Buffer.alloc(64)]).toString("base64url"),
    },
    { ...body, authSecret: "invalid" },
    { ...body, authSecret: undefined },
    { ...body, deviceSigningKey: null },
    { ...body, deviceSigningKey: { ...f.owner.jwk, d: "private" } },
    { ...body, deviceSigningKey: { ...f.owner.jwk, kty: "RSA" } },
    { ...body, deviceSigningKey: { ...f.owner.jwk, crv: "P-384" } },
    { ...body, deviceSigningKey: { ...f.owner.jwk, x: "bad" } },
    { ...body, deviceSigningKey: { ...f.owner.jwk, y: "bad" } },
    {
      ...body,
      deviceSigningKey: {
        kty: "EC",
        crv: "P-256",
        x: Buffer.alloc(32).toString("base64url"),
        y: Buffer.alloc(32).toString("base64url"),
      },
    },
  ])
    expect((await f.call("POST", "/push/installations", value)).status).toBe(400);
  const id = await f.create();
  for (const value of [
    null,
    [],
    {},
    { platform: "ios" },
    { activated: true },
    { tokenVersion: 3 },
    { pushToken: "" },
    { authSecret: "bad" },
    { deviceSigningKey: { ...f.owner.jwk, d: "private" } },
  ])
    expect((await f.call("PATCH", `/push/installations/${id}`, value)).status).toBe(400);
  for (const value of [{}, { nonce: 9 }, { nonce: "bad", unknown: 1 }])
    expect((await f.call("POST", `/push/installations/${id}/activate`, value)).status).toBe(400);
  const ios = await f.call("POST", "/push/installations", { ...body, platform: "ios" });
  expect(ios.status).toBe(201);
});

test("strictly validates registration bodies, topics, indices, expiries and every URL", async () => {
  const f = await pushFixture();
  relay = f.relay;
  const id = await f.create();
  const body = f.registration(id);
  const topic = body.topics[0];
  const badTopics = [
    null,
    "string",
    Array.from({ length: 17 }, (_, index) => ({ ...topic, index })),
    [null],
    [{ ...topic, extra: "hidden" }],
    [{ ...topic, index: -1 }],
    [{ ...topic, index: 0.5 }],
    [topic, topic],
    [{ ...topic, kind: "challenge" }],
    [{ ...topic, topic: "http://unsafe.example/" }],
    [{ ...topic, channel: "https://user:pass@pod.example/" }],
    [{ ...topic, sender: "http://sender.example/" }],
    [{ ...topic, expiresAt: "tomorrow" }],
    [{ ...topic, expiresAt: 0 }],
    [{ ...topic, expiresAt: 0.5 }],
  ];
  for (const value of [
    null,
    [],
    { ...body, extra: true },
    { ...body, installationId: 42 },
    { ...body, installationId: "" },
    { ...body, installationId: "id/slash" },
    { ...body, webId: "bad" },
    { ...body, storage: "http://unsafe.example/" },
    { ...body, protocol: "webpush" },
    ...badTopics.map((topics) => ({ ...body, topics })),
  ])
    expect((await f.call("PUT", "/push/registrations/a", value)).status).toBe(400);
  await f.call("PUT", "/push/registrations/a", body);
  for (const [method, path] of [
    ["DELETE", "/push/registrations/a"],
    ["POST", "/push/registrations/a/rotate-inbox"],
    ["DELETE", `/push/installations/${id}`],
  ])
    expect((await f.call(method, path, { unknown: true })).status).toBe(400);
  expect((await f.call("POST", "/push/registrations/a/rotate-inbox", {})).status).toBe(200);
  expect((await f.call("DELETE", "/push/registrations/a", {}, { proof: false })).status).toBe(204);
});

test("rejects absent, oversized, malformed, non-JSON and invalid UTF-8 bodies before mutation", async () => {
  const f = await pushFixture();
  relay = f.relay;
  expect((await f.call("POST", "/push/installations")).status).toBe(400);
  for (const settings of [
    { body: "not json" },
    { body: "" },
    { body: JSON.stringify(f.owner.body), headers: { "content-type": "text/plain" } },
    { body: Uint8Array.from([123, 34, 120, 34, 58, 34, 255, 34, 125]) },
  ])
    expect((await f.call("POST", "/push/installations", undefined, settings)).status).toBe(400);
  expect(
    (await f.call("POST", "/push/installations", undefined, { body: "x".repeat(65_537) })).status,
  ).toBe(413);
  const noType = await f.request("POST", "/push/installations", f.owner.body);
  noType.headers.delete("content-type");
  expect((await relay.handle(noType)).status).toBe(400);
  expect(
    (
      await f.call("POST", "/push/installations", f.owner.body, {
        headers: { "content-type": "application/json; charset=utf-8" },
      })
    ).status,
  ).toBe(201);
});
