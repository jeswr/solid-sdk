// AUTHORED-BY Codex GPT-6
import { afterEach, expect, test, vi } from "vitest";
import { epoch } from "../test/fixtures.js";
import { pushFixture } from "../test/push-fixtures.js";
import { verifyDeviceProof } from "./device-proof.js";
import type { createRelay } from "./relay.js";

let relay: ReturnType<typeof createRelay>;
afterEach(() => {
  relay?.close();
  vi.restoreAllMocks();
});

test("binds ES256 proof to the exact method, public URL and raw bytes with strict compact claims", async () => {
  const f = await pushFixture();
  relay = f.relay;
  for (const proofClaims of [
    { htm: "GET" },
    { htu: "https://evil.example/push/installations" },
    { htu: "https://relay.example/push/installations?q=1" },
    { iat: "yesterday" },
    { iat: epoch / 1000 + 0.5 },
    { body_sha256: "bad" },
    { jti: 5 },
    { jti: "" },
    { jti: "x".repeat(129) },
    { unknown: true },
    { jti: undefined },
  ])
    expect(
      (await f.call("POST", "/push/installations", f.owner.body, { proofClaims })).status,
    ).toBe(401);
  for (const header of [
    { alg: "ES256", typ: "wrong" },
    { alg: "ES256", typ: "installation-proof+jwt", jwk: f.owner.jwk },
    { alg: "ES256", typ: "installation-proof+jwt", kid: "attacker" },
  ])
    expect((await f.call("POST", "/push/installations", f.owner.body, { header })).status).toBe(
      401,
    );
  for (const proof of ["bad", "x".repeat(4097)]) {
    const request = await f.request("POST", "/push/installations", f.owner.body);
    request.headers.set("installation-proof", proof);
    expect((await relay.handle(request)).status).toBe(401);
  }
  const request = await f.request("POST", "/push/installations", f.owner.body);
  const tampered = new Request(request, { body: `${JSON.stringify(f.owner.body)} ` });
  expect((await relay.handle(tampered)).status).toBe(401);
  const forwarded = await f.request("POST", "/push/installations", f.owner.body, {
    proofClaims: { htu: "https://forwarded.example/push/installations" },
    headers: {
      forwarded: "host=forwarded.example;proto=https",
      "x-forwarded-host": "forwarded.example",
    },
  });
  expect((await relay.handle(forwarded)).status).toBe(401);
  for (const offset of [-60, 60])
    expect(
      (
        await f.call("POST", "/push/installations", f.owner.body, {
          proofClaims: { iat: epoch / 1000 + offset },
        })
      ).status,
    ).toBe(201);
  vi.spyOn(f.store, "insertIfAbsent").mockRejectedValueOnce(new Error("unavailable"));
  // This consumes the outage in P2, then exercise the device store failure directly as well.
  expect((await f.call("POST", "/push/installations", f.owner.body)).status).toBe(401);
  vi.mocked(f.store.insertIfAbsent).mockRejectedValueOnce(new Error("unavailable"));
  await expect(
    verifyDeviceProof({
      request: await f.request("POST", "/push/installations", f.owner.body),
      body: Buffer.from(JSON.stringify(f.owner.body)),
      key: f.owner.jwk,
      publicOrigin: "https://relay.example",
      now: epoch,
      store: f.store,
    }),
  ).rejects.toThrow("unavailable");
});

test("retains future-dated proof replay reservations across the entire inclusive acceptance window", async () => {
  const f = await pushFixture();
  relay = f.relay;
  const original = await f.request("POST", "/push/installations", f.owner.body, {
    proofClaims: { iat: epoch / 1000 + 60 },
  });
  const args = {
    request: original,
    body: Buffer.from(JSON.stringify(f.owner.body)),
    key: f.owner.jwk,
    publicOrigin: "https://relay.example",
    now: epoch,
    store: f.store,
  };
  await verifyDeviceProof(args);
  f.time(epoch + 120_000);
  await expect(verifyDeviceProof({ ...args, now: f.now() })).rejects.toThrow();
  f.time(epoch + 120_001);
  await expect(verifyDeviceProof({ ...args, now: f.now() })).rejects.toThrow();
});
