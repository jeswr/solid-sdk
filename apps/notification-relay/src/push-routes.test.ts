// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { afterEach, expect, test, vi } from "vitest";
import { epoch } from "../test/fixtures.js";
import { phone, pushFixture } from "../test/push-fixtures.js";
import {
  mobileClientId,
  publicUrl,
  resourceFixture,
  target,
  webid,
} from "../test/resource-fixtures.js";
import { matchesHash } from "./device-proof.js";
import { createPushApi } from "./push.js";
import type { Installation, PushRegistration } from "./push-state.js";
import { createRelay } from "./relay.js";

const active: ReturnType<typeof createRelay>[] = [];
afterEach(() => {
  for (const relay of active.splice(0)) relay.close();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
async function setup(overrides: Parameters<typeof pushFixture>[0] = {}) {
  const f = await pushFixture(overrides);
  active.push(f.relay);
  return f;
}

test("requires P2 and the mobile client on every create/change/refresh route", async () => {
  const f = await setup();
  const id = await f.create();
  for (const [method, path, body] of [
    ["POST", "/push/installations", f.owner.body],
    ["PATCH", `/push/installations/${id}`, { pushToken: "new" }],
    ["POST", `/push/installations/${id}/activate`, { nonce: "unknown" }],
    ["PUT", "/push/registrations/account", f.registration(id)],
    ["POST", "/push/registrations/account/rotate-inbox", undefined],
  ] as const) {
    for (const settings of [
      { token: false },
      { claims: { client_id: `${mobileClientId}/other` } },
      { claims: { client_id: undefined } },
      { claims: { aud: "other" } },
    ]) {
      const response = await f.call(method, path, body, settings);
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toBe("DPoP");
      expect(await response.text()).toBe("");
    }
  }
  const unconfigured = createRelay({ ...f.options, mobileClientId: undefined });
  active.push(unconfigured);
  expect(
    (await unconfigured.handle(await f.request("POST", "/push/installations", f.owner.body)))
      .status,
  ).toBe(401);
});

test("requires a fresh correct device proof for create, update, attach, activate and cleanup", async () => {
  const f = await setup();
  const id = await f.create();
  const attacker = await phone();
  await f.call("PUT", "/push/registrations/account", f.registration(id));
  for (const [method, path, body] of [
    ["POST", "/push/installations", f.owner.body],
    ["PATCH", `/push/installations/${id}`, { pushToken: "new" }],
    ["POST", `/push/installations/${id}/activate`, { nonce: f.challenges()[0]?.nonce }],
    ["PUT", "/push/registrations/other", f.registration(id)],
    ["DELETE", "/push/registrations/account", undefined],
    ["DELETE", `/push/installations/${id}`, undefined],
  ] as const) {
    for (const settings of [
      { proof: false },
      { proofClaims: { iat: epoch / 1000 - 61 } },
      { proofClaims: { iat: epoch / 1000 + 61 } },
      { phone: attacker },
    ]) {
      const response = await f.call(method, path, body, {
        ...settings,
        ...(method === "DELETE" ? { token: false } : {}),
      });
      expect(response.status, `${method} ${path}`).toBe(401);
    }
  }
  expect((await f.state()).installations.get(id)?.activated).toBe(false);
  expect(f.send).toHaveBeenCalledTimes(1);
});

test("creates inactive installations, protects nonce activation, and never sends ordinary pushes", async () => {
  const f = await setup();
  const id = await f.create();
  const installation = (await f.state()).installations.get(id) as Installation;
  expect(installation).toMatchObject({
    ...f.owner.body,
    installationId: id,
    activated: false,
    tokenVersion: 1,
  });
  expect(id).toMatch(/^[a-f0-9]{32}$/u);
  const challenge = f.challenges()[0];
  expect(challenge?.nonce).toMatch(/^[\w-]{22}$/u);
  expect(challenge).toEqual({
    v: 1,
    id: expect.stringMatching(/^[a-f0-9]{32}$/u),
    kind: "challenge",
    registrationId: id,
    topicIndex: 0,
    nonce: expect.stringMatching(/^[\w-]{22}$/u),
    sentAt: epoch,
  });
  expect(installation.challengeHash).not.toBe(challenge?.nonce);
  await f.call("PUT", "/push/registrations/account", f.registration(id));
  // A guessed secret cannot bypass activation through the push inbox.
  expect((await f.call("POST", "/inbox/account/secret", {})).status).toBe(404);
  expect(f.send).toHaveBeenCalledTimes(1);
  for (const nonce of ["guessed", "", "x".repeat(1000)])
    expect((await f.call("POST", `/push/installations/${id}/activate`, { nonce })).status).toBe(
      401,
    );
  const attacker = await phone();
  // Stolen push destination, registered with attacker-owned keys, receives a different nonce.
  const stolenId = await f.create(attacker);
  expect(
    (
      await f.call(
        "POST",
        `/push/installations/${stolenId}/activate`,
        { nonce: challenge?.nonce },
        { phone: attacker },
      )
    ).status,
  ).toBe(401);
  expect((await f.state()).installations.get(stolenId)?.activated).toBe(false);
  expect(
    (
      await f.call(
        "POST",
        `/push/installations/${id}/activate`,
        { nonce: challenge?.nonce },
        { phone: attacker },
      )
    ).status,
  ).toBe(401);
  expect(
    (await f.call("POST", `/push/installations/${id}/activate`, { nonce: challenge?.nonce }))
      .status,
  ).toBe(204);
  expect((await f.state()).installations.get(id)).toMatchObject({
    activated: true,
    challengeHash: "",
  });
  expect(
    (await f.call("POST", `/push/installations/${id}/activate`, { nonce: challenge?.nonce }))
      .status,
  ).toBe(401);
});

test("refreshes tokens/keys with the old key, invalidates old nonces and caps challenges at three/hour", async () => {
  const f = await setup();
  const id = await f.create();
  const firstNonce = f.challenges()[0]?.nonce;
  expect(
    (await f.call("POST", `/push/installations/${id}/activate`, { nonce: firstNonce })).status,
  ).toBe(204);
  expect(
    (await f.call("PATCH", `/push/installations/${id}`, { pushToken: f.owner.body.pushToken }))
      .status,
  ).toBe(200);
  expect(f.send).toHaveBeenCalledTimes(1);
  const replacement = await phone();
  expect(
    (
      await f.call("PATCH", `/push/installations/${id}`, {
        ...replacement.body,
        platform: undefined,
        pushToken: "new-token",
      })
    ).status,
  ).toBe(200);
  expect((await f.state()).installations.get(id)).toMatchObject({
    activated: false,
    tokenVersion: 2,
  });
  expect(
    (
      await f.call(
        "POST",
        `/push/installations/${id}/activate`,
        { nonce: firstNonce },
        { phone: replacement },
      )
    ).status,
  ).toBe(401);
  expect(
    (await f.call("PATCH", `/push/installations/${id}`, { pushToken: "another" })).status,
  ).toBe(401);
  expect(
    (
      await f.call(
        "PATCH",
        `/push/installations/${id}`,
        { pushToken: "new-token" },
        { phone: replacement },
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await f.call(
        "PATCH",
        `/push/installations/${id}`,
        { pushToken: "too-many" },
        { phone: replacement },
      )
    ).status,
  ).toBe(429);
  expect((await f.state()).installations.get(id)?.pushToken).toBe("new-token");
  f.time(epoch + 3_600_000);
  expect(
    (
      await f.call(
        "PATCH",
        `/push/installations/${id}`,
        { pushToken: "later" },
        { phone: replacement },
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await f.call(
        "POST",
        `/push/installations/${id}/activate`,
        { nonce: f.challenges().at(-1)?.nonce },
        { phone: replacement },
      )
    ).status,
  ).toBe(204);
});

test("owns registrations by WebID, requires possession to attach/move, and rotates hashed inbox secrets", async () => {
  const f = await setup();
  const id = await f.create();
  const body = f.registration(id);
  const response = await f.call("PUT", "/push/registrations/account", body);
  expect(response.status).toBe(201);
  const { inbox } = await response.json();
  const secret = new URL(inbox).pathname.split("/").at(-1);
  expect(secret).toMatch(/^[\w-]{43}$/u);
  const stored = (await f.state()).registrations.get("account") as PushRegistration;
  expect(stored).toMatchObject({ ...body, expiresAt: epoch + 30 * 86_400_000 });
  expect(stored.inboxSecretHash).not.toBe(secret);
  expect(matchesHash(secret, stored.inboxSecretHash)).toBe(true);
  expect(matchesHash("bad", stored.inboxSecretHash)).toBe(false);
  f.time(epoch + 1000);
  const refresh = await f.call("PUT", "/push/registrations/account", body, { proof: false });
  expect(refresh.status).toBe(200);
  expect(await refresh.json()).toEqual({ registrationId: "account" });
  expect((await f.state()).registrations.get("account")?.expiresAt).toBe(
    epoch + 1000 + 30 * 86_400_000,
  );
  const other = "https://someone.example/#me";
  // The real token verifier still checks the other account's endorsed issuer.
  f.outboundFetch.mockImplementation(async (input) => {
    if (String(input) === other.split("#")[0])
      return new Response(
        `<${other}> <http://www.w3.org/ns/solid/terms#oidcIssuer> <${f.claims.iss}> .`,
        { headers: { "content-type": "text/turtle" } },
      );
    throw new Error("unexpected fetch");
  });
  for (const [method, path, json] of [
    ["PUT", "/push/registrations/account", body],
    ["POST", "/push/registrations/account/rotate-inbox", undefined],
    ["DELETE", "/push/registrations/account", undefined],
  ] as const)
    expect(
      (await f.call(method, path, json, { proof: false, claims: { webid: other } })).status,
    ).toBe(401);
  expect(
    (
      await f.call(
        "PUT",
        "/push/registrations/account",
        { ...body, webId: other },
        { claims: { webid: other } },
      )
    ).status,
  ).toBe(401);
  const anotherPhone = await phone();
  expect(
    (
      await f.call(
        "PUT",
        "/push/registrations/foreign-phone",
        { ...body, webId: other },
        { claims: { webid: other }, phone: anotherPhone },
      )
    ).status,
  ).toBe(401);
  // A second account holding this phone may attach with its own P2 token.
  expect(
    (
      await f.call(
        "PUT",
        "/push/registrations/other-account",
        { ...body, webId: other },
        { claims: { webid: other } },
      )
    ).status,
  ).toBe(201);
  const rotated = await f.call("POST", "/push/registrations/account/rotate-inbox", undefined, {
    proof: false,
  });
  expect(rotated.status).toBe(200);
  const nextInbox = (await rotated.json()).inbox;
  expect(nextInbox).not.toBe(inbox);
  const hash = ((await f.state()).registrations.get("account") as PushRegistration).inboxSecretHash;
  expect(matchesHash(secret, hash)).toBe(false);
  expect(matchesHash(nextInbox.split("/").at(-1), hash)).toBe(true);
  // Moving to another installation needs its device key and retires an empty old installation.
  const secondId = await f.create(anotherPhone);
  expect(
    (
      await f.call(
        "PUT",
        "/push/registrations/account",
        { ...body, installationId: secondId },
        { proof: false },
      )
    ).status,
  ).toBe(401);
  expect(
    (
      await f.call(
        "PUT",
        "/push/registrations/account",
        { ...body, installationId: secondId },
        { phone: anotherPhone },
      )
    ).status,
  ).toBe(200);
  expect((await f.state()).installations.has(id)).toBe(true);
  expect(
    (await f.call("DELETE", "/push/registrations/other-account", undefined, { token: false }))
      .status,
  ).toBe(204);
  expect((await f.state()).installations.has(id)).toBe(false);
  expect(
    (await f.call("DELETE", "/push/registrations/account", undefined, { proof: false })).status,
  ).toBe(204);
  expect((await f.state()).installations.has(secondId)).toBe(false);
});

test("enforces four registrations and sixteen topics without preventing refresh at capacity", async () => {
  const f = await setup();
  const id = await f.create();
  const body = f.registration(id);
  const topics = Array.from({ length: 16 }, (_, index) => ({
    ...body.topics[0],
    index,
    kind: index % 2 ? "chat" : "inbox",
    sender: webid,
  }));
  for (let i = 0; i < 4; i++)
    expect((await f.call("PUT", `/push/registrations/a${i}`, { ...body, topics })).status).toBe(
      201,
    );
  expect((await f.call("PUT", "/push/registrations/fifth", body)).status).toBe(409);
  expect(
    (
      await f.call(
        "PUT",
        "/push/registrations/a0",
        { ...body, protocol: "lws", topics: [] },
        { proof: false },
      )
    ).status,
  ).toBe(200);
});

test("supports device-only offline cleanup, and cascades installation deletion across accounts", async () => {
  const f = await setup();
  const id = await f.create();
  await f.call("PUT", "/push/registrations/a", f.registration(id));
  await f.call("PUT", "/push/registrations/b", f.registration(id));
  const noPolicy = createRelay({ ...f.options, mobileClientId: undefined });
  active.push(noPolicy);
  expect(
    (
      await noPolicy.handle(
        await f.request("DELETE", "/push/registrations/a", undefined, { token: false }),
      )
    ).status,
  ).toBe(204);
  expect((await f.state()).installations.has(id)).toBe(true);
  // Even invalid/expired tokens cannot block a valid device proof on the OR-auth route.
  expect(
    (await f.call("DELETE", "/push/registrations/b", undefined, { claims: { aud: "invalid" } }))
      .status,
  ).toBe(204);
  expect((await f.state()).installations.size).toBe(0);
  const second = await f.create();
  const untouched = await f.create();
  await f.call("PUT", "/push/registrations/remaining", f.registration(untouched));
  await f.call("PUT", "/push/registrations/a", f.registration(second));
  await f.call("PUT", "/push/registrations/b", f.registration(second));
  expect(
    (
      await noPolicy.handle(
        await f.request("DELETE", `/push/installations/${second}`, undefined, { token: false }),
      )
    ).status,
  ).toBe(204);
  const state = await f.state();
  expect([...state.registrations.keys()]).toEqual(["remaining"]);
  expect([...state.installations.keys()]).toEqual([untouched]);
});

test("serializes interleaved last-registration deletions and concurrent attachment", async () => {
  const f = await setup();
  for (const attachBetween of [false, true]) {
    const id = await f.create();
    await f.call("PUT", "/push/registrations/a", f.registration(id));
    await f.call("PUT", "/push/registrations/b", f.registration(id));
    // Pause each request at its deletion commit, after both read the original state.
    const original = f.store.transaction.bind(f.store);
    const gates: Array<() => void> = [];
    let calls = 0;
    const spy = vi.spyOn(f.store, "transaction").mockImplementation(async (operation) => {
      const count = ++calls;
      if (count === 2 || count === 4) await new Promise<void>((resolve) => gates.push(resolve));
      return original(operation);
    });
    const first = f.call("DELETE", "/push/registrations/a", undefined, { proof: false });
    await vi.waitFor(() => expect(gates).toHaveLength(1));
    const second = f.call("DELETE", "/push/registrations/b", undefined, { proof: false });
    await vi.waitFor(() => expect(gates).toHaveLength(2));
    spy.mockRestore();
    gates[0]?.();
    expect((await first).status).toBe(204);
    if (attachBetween)
      expect((await f.call("PUT", "/push/registrations/c", f.registration(id))).status).toBe(201);
    gates[1]?.();
    expect((await second).status).toBe(204);
    const state = await f.state();
    expect(state.installations.has(id)).toBe(attachBetween);
    expect([...state.registrations.values()].filter((r) => r.installationId === id)).toHaveLength(
      attachBetween ? 1 : 0,
    );
  }
});

test("expires registrations at thirty days, retains refreshed siblings and sweeps idle state atomically", async () => {
  vi.useFakeTimers();
  const f = await setup();
  const id = await f.create();
  await f.call("PUT", "/push/registrations/a", f.registration(id));
  await f.call("PUT", "/push/registrations/b", f.registration(id));
  f.time(epoch + 1000);
  await f.call("PUT", "/push/registrations/b", f.registration(id), { proof: false });
  f.time(epoch + 30 * 86_400_000);
  await vi.advanceTimersByTimeAsync(60_000);
  expect([...(await f.state()).registrations.keys()]).toEqual(["b"]);
  expect((await f.state()).installations.has(id)).toBe(true);
  f.time(epoch + 30 * 86_400_000 + 1000);
  await vi.advanceTimersByTimeAsync(60_000);
  expect((await f.state()).installations.has(id)).toBe(false);
  vi.spyOn(f.store, "transaction").mockRejectedValueOnce(new Error("unavailable"));
  await vi.advanceTimersByTimeAsync(60_000);
});

test("admits installations atomically up to capacity and expires ones never attached", async () => {
  const f = await setup({ maxPushInstallations: 2 });
  const devices = [await phone(), await phone(), await phone()];
  const created = await Promise.all(
    devices.map((device) => f.call("POST", "/push/installations", device.body, { phone: device })),
  );
  expect(created.map((response) => response.status).sort()).toEqual([201, 201, 503]);
  expect((await f.state()).installations.size).toBe(2);
  const admitted = await Promise.all(
    created.flatMap((response, index) =>
      response.status === 201
        ? [
            response
              .json()
              .then((data) => ({ id: data.installationId as string, device: devices[index] })),
          ]
        : [],
    ),
  );
  const [attached, waiting] = admitted.map((entry) => entry.id);
  expect(
    (
      await f.call("PUT", "/push/registrations/a", f.registration(attached as string), {
        phone: admitted[0]?.device,
      })
    ).status,
  ).toBe(201);
  f.time(epoch + 86_400_000 - 1000);
  expect((await f.call("POST", "/push/installations", f.owner.body)).status).toBe(503);
  expect((await f.state()).installations.has(waiting as string)).toBe(true);
  f.time(epoch + 86_400_000);
  // The unattached installation's lifetime is over, which frees its slot; attachment keeps the other.
  expect((await f.call("POST", "/push/installations", f.owner.body)).status).toBe(201);
  const state = await f.state();
  expect(state.installations.has(waiting as string)).toBe(false);
  expect(state.installations.has(attached as string)).toBe(true);
  for (const limits of [
    { maxInstallations: 0 },
    { maxInstallations: 1.5 },
    { unattachedLifetimeMs: 0 },
    { unattachedLifetimeMs: Number.POSITIVE_INFINITY },
  ])
    expect(() =>
      createPushApi({
        publicOrigin: publicUrl,
        store: f.store,
        now: f.now,
        verifyResourceToken: f.verify,
        verifyWebhook: async () => {
          throw new Error("unused");
        },
        authorize: async () => {
          throw new Error("unused");
        },
        ...limits,
      }),
    ).toThrow(/Invalid/u);
});

test("caps installations per admitting WebID and frees the slot on deletion", async () => {
  const f = await setup({ maxPushInstallationsPerWebId: 2 });
  const devices = [await phone(), await phone(), await phone()];
  const ids: string[] = [];
  for (const device of devices.slice(0, 2)) ids.push(await f.create(device));
  // Another account's installation does not count against this WebID.
  await f.store.transaction((state) => {
    const mine = state.installations.get(ids[1] as string) as Installation;
    state.installations.set("other", {
      ...mine,
      installationId: "other",
      admittedBy: "https://other.example/profile#me",
    });
  });
  expect((await f.state()).installations.size).toBe(3);
  const third = devices[2] as (typeof devices)[number];
  expect((await f.call("POST", "/push/installations", third.body, { phone: third })).status).toBe(
    429,
  );
  expect(
    (
      await f.call("DELETE", `/push/installations/${ids[0]}`, undefined, {
        phone: devices[0],
        token: false,
      })
    ).status,
  ).toBe(204);
  expect(await f.create(third)).toMatch(/^[a-f0-9]{32}$/u);
  expect(() =>
    createPushApi({
      publicOrigin: publicUrl,
      store: f.store,
      now: f.now,
      authorize: async () => {
        throw new Error("unused");
      },
      verifyResourceToken: async () => {
        throw new Error("unused");
      },
      verifyWebhook: async () => {
        throw new Error("unused");
      },
      maxInstallationsPerWebId: 0,
    }),
  ).toThrow(/Invalid/u);
});

test("routes only the specified methods and paths and exposes proof CORS headers", async () => {
  const f = await setup();
  for (const [method, path] of [
    ["POST", "/push/unknown"],
    ["GET", "/push/installations"],
    ["PUT", "/push/installations/id"],
    ["DELETE", "/push/installations/id/activate"],
    ["POST", "/push/registrations"],
    ["PATCH", "/push/registrations/id"],
    ["POST", "/push/installations/id/rotate-inbox"],
    ["POST", "/push/registrations/id/activate"],
    ["POST", "/push/installations?query=1"],
    ["POST", "/push/installations#fragment"],
  ])
    expect((await f.call(method, path)).status).toBe(404);
  for (const [method, path, body] of [
    ["PATCH", "/push/installations/absent", { pushToken: "new" }],
    ["PUT", "/push/registrations/new", f.registration("absent")],
    ["DELETE", "/push/registrations/absent", undefined],
    ["POST", "/push/registrations/absent/rotate-inbox", undefined],
  ] as const)
    expect((await f.call(method, path, body)).status).toBe(404);
  const preflight = await f.relay.handle(
    new Request(target, { method: "OPTIONS", headers: { origin: publicUrl } }),
  );
  expect(preflight.status).toBe(204);
  expect(preflight.headers.get("access-control-allow-methods")).toContain("PATCH");
  expect(preflight.headers.get("access-control-allow-headers")).toContain("Installation-Proof");
});

test("fails closed without a sink/store, and reports failed challenge sends for bounded retries", async () => {
  const f = await setup();
  const noSink = createRelay({ ...f.options, pushSink: undefined });
  active.push(noSink);
  expect(
    (await noSink.handle(await f.request("POST", "/push/installations", f.owner.body))).status,
  ).toBe(503);
  f.send.mockRejectedValueOnce(new Error("provider secret"));
  const response = await f.call("POST", "/push/installations", f.owner.body);
  expect(response.status).toBe(201);
  const created = await response.json();
  expect(created.challengeSent).toBe(false);
  expect(
    (
      await noSink.handle(
        await f.request("PATCH", `/push/installations/${created.installationId}`, {
          pushToken: "new",
        }),
      )
    ).status,
  ).toBe(503);
  expect(
    (
      await f.call("PATCH", `/push/installations/${created.installationId}`, {
        pushToken: f.owner.body.pushToken,
      })
    ).status,
  ).toBe(200);
  vi.spyOn(f.store, "transaction").mockRejectedValueOnce(new Error("store secret"));
  const failed = await f.call("DELETE", "/push/registrations/a", undefined, { proof: false });
  expect(failed.status).toBe(503);
  expect(await failed.text()).toBe("");
});

test("shares device replay protection and state across relay instances", async () => {
  const f = await setup();
  const second = createRelay(f.options);
  active.push(second);
  const original = await f.request("POST", "/push/installations", f.owner.body);
  expect((await f.relay.handle(original.clone())).status).toBe(201);
  // A fresh P2 proof isolates device proof replay from DPoP replay.
  const replay = await f.request("POST", "/push/installations", f.owner.body);
  replay.headers.set("installation-proof", original.headers.get("installation-proof") as string);
  expect((await second.handle(replay)).status).toBe(401);
  const id = [...(await f.state()).installations.keys()][0];
  expect(
    (
      await second.handle(
        await f.request("DELETE", `/push/installations/${id}`, undefined, { token: false }),
      )
    ).status,
  ).toBe(204);
  const resource = await resourceFixture();
  const authReplay = await resource.request();
  // P2 replay is consumed before body validation.
  const a = createRelay({
    ...f.options,
    store: resource.options.store,
    fetch: resource.outboundFetch,
  });
  const b = createRelay({
    ...f.options,
    store: resource.options.store,
    fetch: resource.outboundFetch,
  });
  active.push(a, b);
  expect((await a.handle(authReplay.clone())).status).toBe(400);
  expect((await b.handle(authReplay.clone())).status).toBe(401);
});

test("rechecks device identity/version at commit after asynchronous verification", async () => {
  const f = await setup();
  const attacker = await phone();
  for (const mutation of ["delete", "version", "key"] as const) {
    const id = await f.create();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reached!: () => void;
    const started = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const reserve = f.store.insertIfAbsent.bind(f.store);
    const spy = vi.spyOn(f.store, "insertIfAbsent").mockImplementation(async (key, ttl) => {
      if (key.startsWith("installation:")) {
        reached();
        await held;
      }
      return reserve(key, ttl);
    });
    const pending = f.call("PATCH", `/push/installations/${id}`, { pushToken: "rotated" });
    await started;
    await f.store.transaction((state) => {
      if (mutation === "delete") state.installations.delete(id);
      else {
        const live = state.installations.get(id) as Installation;
        if (mutation === "version") live.tokenVersion++;
        else live.deviceSigningKey = attacker.jwk;
      }
    });
    release();
    expect((await pending).status).toBe(401);
    spy.mockRestore();
  }
});

test("rejects stale registration refresh/rotation/deletion commits after concurrent ownership changes", async () => {
  // Many installations under one test WebID; the per-WebID quota has its own test.
  const f = await setup({ maxPushInstallationsPerWebId: 100 });
  for (const operation of ["put", "rotate", "delete"] as const) {
    for (const mutation of ["delete", "webid", "installation"] as const) {
      const id = await f.create();
      const next = await f.create();
      const body = f.registration(id);
      const registrationId = `race-${operation}-${mutation}`;
      expect((await f.call("PUT", `/push/registrations/${registrationId}`, body)).status).toBe(201);
      let release!: () => void;
      let reached!: () => void;
      const started = new Promise<void>((resolve) => {
        reached = resolve;
      });
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const original = f.store.transaction.bind(f.store);
      let calls = 0;
      const commit = operation === "put" ? 3 : 2;
      const spy = vi.spyOn(f.store, "transaction").mockImplementation(async (callback) => {
        if (++calls === commit) {
          reached();
          await held;
        }
        return original(callback);
      });
      const pending =
        operation === "put"
          ? f.call("PUT", `/push/registrations/${registrationId}`, body, { proof: false })
          : f.call(
              operation === "rotate" ? "POST" : "DELETE",
              `/push/registrations/${registrationId}${operation === "rotate" ? "/rotate-inbox" : ""}`,
              undefined,
              { proof: false },
            );
      await started;
      await original((state) => {
        if (mutation === "delete") state.registrations.delete(registrationId);
        else {
          const live = state.registrations.get(registrationId) as PushRegistration;
          if (mutation === "webid") live.webId = "https://changed.example/#me";
          else live.installationId = next;
        }
      });
      release();
      expect((await pending).status).toBe(409);
      spy.mockRestore();
    }
  }
});

test("refuses device-only registration cleanup if its installation disappears before verification", async () => {
  const f = await setup();
  const id = await f.create();
  await f.call("PUT", "/push/registrations/a", f.registration(id));
  const original = f.store.transaction.bind(f.store);
  let calls = 0;
  vi.spyOn(f.store, "transaction").mockImplementation(async (callback) => {
    if (++calls === 2) await original((state) => state.installations.delete(id));
    return original(callback);
  });
  expect(
    (await f.call("DELETE", "/push/registrations/a", undefined, { token: false })).status,
  ).toBe(404);
});
