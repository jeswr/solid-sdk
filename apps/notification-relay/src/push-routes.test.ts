// AUTHORED-BY Codex GPT-6
import { expect, test } from "vitest";
import { mobileClientId, publicUrl, resourceFixture, target } from "../test/resource-fixtures.js";
import { createRelay } from "./relay.js";
import { InMemoryRelayStore } from "./store.js";

test("authenticates every push skeleton and returns 501 for the planned handlers", async () => {
  const f = await resourceFixture();
  const relay = f.relay();
  try {
    for (const [method, path] of [
      ["POST", "/push/installations"],
      ["PATCH", "/push/installations/device"],
      ["POST", "/push/installations/device/activate"],
      ["PUT", "/push/registrations/account"],
      ["POST", "/push/registrations/account/rotate-inbox"],
      ["DELETE", "/push/registrations/account"],
      ["DELETE", "/push/installations/device"],
    ]) {
      const url = `${publicUrl}${path}`;
      const response = await relay.handle(
        await f.request(f.claims, { htm: method, htu: url }, url, method),
      );
      expect(response.status).toBe(501);
      expect(response.headers.has("www-authenticate")).toBe(false);
    }
    for (const [method, path] of [
      ["POST", "/push/unknown"],
      ["GET", "/push/installations"],
    ]) {
      const url = `${publicUrl}${path}`;
      expect(
        (await relay.handle(await f.request(f.claims, { htm: method, htu: url }, url, method)))
          .status,
      ).toBe(404);
    }
    const preflight = await relay.handle(
      new Request(target, { method: "OPTIONS", headers: { origin: publicUrl } }),
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-methods")).toContain("PATCH");
    expect(preflight.headers.get("access-control-allow-headers")).toContain("DPoP");
  } finally {
    relay.close();
  }
});

test("challenges missing, invalid or non-mobile tokens without disclosing credentials", async () => {
  const f = await resourceFixture();
  const relay = f.relay();
  try {
    for (const request of [
      new Request(target, { method: "POST" }),
      await f.request({ ...f.claims, client_id: `${mobileClientId}/other` }),
      await f.request({ ...f.claims, client_id: undefined }),
      await f.request({ ...f.claims, aud: "other" }),
      await f.request(f.claims, { htm: "GET" }),
    ]) {
      const response = await relay.handle(request);
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toBe("DPoP");
      expect(await response.text()).toBe("");
    }
  } finally {
    relay.close();
  }
  const unconfigured = createRelay({
    publicUrl,
    fetch: f.outboundFetch,
    verifyIdToken: async () => ({ subject: "old-client", expiresAt: Date.now() + 60_000 }),
  });
  try {
    const response = await unconfigured.handle(await f.request());
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("DPoP");
  } finally {
    unconfigured.close();
  }
});

test("rejects jti replay across two relay instances sharing a store and concurrent requests", async () => {
  const f = await resourceFixture(new InMemoryRelayStore());
  const first = f.relay();
  const second = f.relay();
  try {
    const request = await f.request();
    expect((await first.handle(request.clone())).status).toBe(501);
    const replay = await second.handle(request.clone());
    expect(replay.status).toBe(401);
    expect(replay.headers.get("www-authenticate")).toBe("DPoP");
    const concurrent = await f.request();
    expect(
      (await Promise.all([first.handle(concurrent.clone()), second.handle(concurrent.clone())]))
        .map((r) => r.status)
        .sort(),
    ).toEqual([401, 501]);
  } finally {
    first.close();
    second.close();
  }
});
