// AUTHORED-BY Codex GPT-6
import { afterEach, expect, test, vi } from "vitest";
import { epoch, event, storage, vector } from "../test/fixtures.js";
import { pushFixture } from "../test/push-fixtures.js";
import { issuer, webid } from "../test/resource-fixtures.js";
import type { Installation, PushRegistration, PushTopic } from "./push-state.js";
import { createRelay } from "./relay.js";

const active: ReturnType<typeof createRelay>[] = [];
afterEach(() => {
  for (const relay of active.splice(0)) relay.close();
  vi.restoreAllMocks();
});

async function setup(
  changes: Partial<ReturnType<Awaited<ReturnType<typeof pushFixture>>["registration"]>> = {},
  activated = true,
) {
  const f = await pushFixture();
  active.push(f.relay);
  const id = await f.create();
  if (activated)
    expect(
      (
        await f.call("POST", `/push/installations/${id}/activate`, {
          nonce: f.challenges()[0]?.nonce,
        })
      ).status,
    ).toBe(204);
  const registration = { ...f.registration(id), ...changes };
  const created = await f.call("PUT", "/push/registrations/account", registration);
  expect(created.status).toBe(201);
  const inbox = (await created.json()).inbox as string;
  const path = new URL(inbox).pathname;
  f.send.mockClear();
  const deliver = (body: unknown = { object: "https://pod.example/inbox/item" }) =>
    f.call("POST", path, body, { token: false, proof: false });
  return { ...f, id, registration, inbox, path, deliver };
}

test("Solid secret-only deliveries produce one private activity with stored kind/index", async () => {
  const f = await setup();
  for (const body of [
    { object: "https://pod.example/inbox/" },
    { object: { id: "https://pod.example/inbox/nested/item" } },
    { object: "https://pod.example/inbox/item", subscription: f.registration.topics[0]?.channel },
    {
      object: "https://pod.example/inbox/item",
      channel: { id: f.registration.topics[0]?.channel },
      protocol: "lws",
      kind: "challenge",
      actor: "https://secret.example/#actor",
    },
  ]) {
    expect((await f.deliver(body)).status).toBe(202);
    expect(f.send).toHaveBeenLastCalledWith(
      expect.objectContaining({ installationId: f.id, activated: true }),
      {
        v: 1,
        id: expect.stringMatching(/^[a-f0-9]{32}$/u),
        kind: "inbox",
        registrationId: "account",
        topicIndex: 0,
        sentAt: epoch,
      },
    );
  }
  expect(f.send).toHaveBeenCalledTimes(4);
  expect(new Set(f.send.mock.calls.map(([, payload]) => payload.id)).size).toBe(4);
  expect((await f.state()).registrations.get("account")?.unauthenticated).toBe(true);
  f.send.mockRejectedValueOnce(new Error("private provider error"));
  const failedSink = await f.deliver();
  expect(failedSink.status).toBe(202);
  expect(await failedSink.text()).toBe("");
  const noSink = createRelay({ ...f.options, pushSink: undefined });
  active.push(noSink);
  expect(
    (await noSink.handle(await f.request("POST", f.path, { object: "https://pod.example/inbox/" })))
      .status,
  ).toBe(202);
});

test("binds Solid deliveries to channels and slash containment without URL normalization escapes", async () => {
  const f = await setup();
  for (const object of [
    undefined,
    null,
    {},
    { id: 42 },
    "not a URL",
    "https://pod.example/inbox-evil/item",
    "https://other.example/inbox/item",
    "https://pod.example:444/inbox/item",
    "https://pod.example/inbox/../inbox/item",
    "https://pod.example/inbox/./item",
    "https://pod.example/inbox/%2e%2e/inbox/item",
    "https://pod.example/inbox/.%2e/inbox/item",
    "https://pod.example/inbox/%2F..%2Fitem",
    "https://pod.example/inbox/%5citem",
    "https://user:pass@pod.example/inbox/item",
    "https://pod.example/inbox/item?secret=1",
    "https://pod.example/inbox/item?",
    "https://pod.example/inbox/item#fragment",
    "https://pod.example/inbox/item#",
    "https://pod.example/inbox/\\item",
  ])
    expect((await f.deliver({ object })).status).toBe(202);
  for (const channel of [null, 42, "https://pod.example/channel/other", { id: "wrong" }])
    expect((await f.deliver({ channel, object: "https://pod.example/inbox/item" })).status).toBe(
      202,
    );
  expect(
    (
      await f.deliver({
        subscription: "wrong",
        channel: f.registration.topics[0]?.channel,
        object: "https://pod.example/inbox/item",
      })
    ).status,
  ).toBe(202);
  expect(f.send).not.toHaveBeenCalled();
  expect((await f.state()).registrations.get("account")?.unauthenticated).toBeUndefined();
  // A resource topic matches itself, never its apparent descendants or a sibling prefix.
  const topic = {
    ...f.registration.topics[0],
    topic: "https://pod.example/note",
    kind: "chat",
    index: 9,
  };
  await f.call("PUT", "/push/registrations/account", { ...f.registration, topics: [topic] });
  for (const object of ["https://pod.example/note/child", "https://pod.example/notebook"])
    await f.deliver({ object });
  expect(f.send).not.toHaveBeenCalled();
  await f.deliver({ object: "https://pod.example/note" });
  expect(f.send.mock.calls[0]?.[1]).toMatchObject({ kind: "chat", topicIndex: 9 });
});

test("verifies genuine sender P2 tokens without a mobile client_id and refuses wrong/missing senders", async () => {
  const sender = "https://pod.example/profile#sender";
  const f = await setup({
    topics: [
      {
        index: 3,
        kind: "chat",
        topic: "https://pod.example/inbox/",
        channel: "https://pod.example/channel/3",
        sender,
        expiresAt: epoch + 60_000,
      },
    ],
  });
  const original = f.outboundFetch.getMockImplementation() as typeof fetch;
  f.outboundFetch.mockImplementation(async (input, init) => {
    if (String(input) === sender.split("#")[0])
      return new Response(
        `<${sender}> <http://www.w3.org/ns/solid/terms#oidcIssuer> <${issuer}> .`,
        {
          headers: { "content-type": "text/turtle" },
        },
      );
    return original(input, init);
  });
  expect((await f.deliver()).status).toBe(401);
  const body = { object: "https://pod.example/inbox/item" };
  const wrong = await f.call("POST", f.path, body, { claims: { client_id: undefined } });
  expect(wrong.status).toBe(401);
  expect(wrong.headers.get("www-authenticate")).toBe("DPoP");
  expect(await wrong.text()).toBe("");
  expect(f.send).not.toHaveBeenCalled();
  const request = await f.request("POST", f.path, body, {
    proof: false,
    claims: { webid: sender, client_id: undefined },
  });
  expect((await f.relay.handle(request.clone())).status).toBe(202);
  expect(f.send).toHaveBeenCalledTimes(1);
  expect(f.send.mock.calls[0]?.[1]).toMatchObject({ kind: "chat", topicIndex: 3 });
  expect((await f.state()).registrations.get("account")?.unauthenticated).toBeUndefined();
  expect((await f.relay.handle(request.clone())).status).toBe(401);
  // Webhooks still verify when mobile-client registration routes are disabled.
  const noMobile = createRelay({ ...f.options, mobileClientId: undefined });
  active.push(noMobile);
  expect(
    (
      await noMobile.handle(
        await f.request("POST", f.path, body, {
          claims: { webid: sender, client_id: "https://pod.example/client" },
        }),
      )
    ).status,
  ).toBe(202);
});

test("selects a live stored topic by channel, and only falls back to object when no channel was supplied", async () => {
  const f = await setup({
    topics: [
      {
        index: 1,
        kind: "inbox",
        topic: "https://pod.example/inbox/",
        channel: "https://pod.example/channel/expired",
        expiresAt: epoch,
      },
      {
        index: 7,
        kind: "chat",
        topic: "https://pod.example/chat/",
        channel: "https://pod.example/channel/chat",
        expiresAt: epoch + 1000,
      },
    ],
  });
  // A valid channel cannot authorize an object from another stored topic.
  await f.deliver({
    subscription: "https://pod.example/channel/chat",
    object: "https://pod.example/inbox/item",
  });
  await f.deliver({
    subscription: "https://pod.example/channel/expired",
    object: "https://pod.example/chat/item",
  });
  expect(f.send).not.toHaveBeenCalled();
  for (const body of [
    { channel: "https://pod.example/channel/chat", object: "https://pod.example/chat/item" },
    { object: "https://pod.example/chat/item" },
    {
      subscription: { id: "https://pod.example/channel/chat" },
      channel: "https://pod.example/channel/chat",
      object: "https://pod.example/chat/item",
    },
  ]) {
    expect((await f.deliver(body)).status).toBe(202);
    expect(f.send).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        kind: "chat",
        topicIndex: 7,
      }),
    );
  }
  expect(f.send).toHaveBeenCalledTimes(3);
});

test("unknown IDs and wrong secrets are indistinguishable; queries, fragments and methods are refused", async () => {
  const f = await setup();
  const wrong = await f.call("POST", "/inbox/account/incorrect", {}, { token: false });
  const unknown = await f.call("POST", "/inbox/unknown/incorrect", {}, { token: false });
  expect([wrong.status, unknown.status]).toEqual([404, 404]);
  expect([...wrong.headers]).toEqual([...unknown.headers]);
  expect(await wrong.text()).toBe(await unknown.text());
  for (const path of [
    `${f.path}?query=1`,
    `${f.path}?`,
    `${f.path}#fragment`,
    `${f.path}#`,
    "/inbox/account/bad%20secret",
  ])
    expect((await f.call("POST", path, {})).status).toBe(404);
  expect((await f.call("GET", f.path)).status).toBe(404);
  expect(f.send).not.toHaveBeenCalled();
});

test("bounds raw webhook bodies to 64 KiB and returns constant malformed JSON errors", async () => {
  const f = await setup();
  for (const body of ["{", "", Uint8Array.from([0xff])]) {
    const response = await f.call("POST", f.path, undefined, { token: false, body });
    expect(response.status).toBe(400);
    expect(await response.text()).toBe("");
  }
  expect((await f.call("POST", f.path, undefined, { token: false })).status).toBe(400);
  expect(
    (await f.call("POST", f.path, undefined, { token: false, body: "x".repeat(65_537) })).status,
  ).toBe(413);
  const valid = JSON.stringify({ object: "https://pod.example/inbox/item" });
  expect(
    (await f.call("POST", f.path, undefined, { token: false, body: valid.padEnd(65_536) })).status,
  ).toBe(202);
  expect(f.send).toHaveBeenCalledTimes(1);
  for (const body of [null, [], "text", 42, {}]) expect((await f.deliver(body)).status).toBe(202);
  expect(f.send).toHaveBeenCalledTimes(1);
});

test("drops expired topics and registrations, and never pushes to inactive installations", async () => {
  const f = await setup({}, false);
  expect((await f.deliver()).status).toBe(202);
  expect(f.send).not.toHaveBeenCalled();
  expect((await f.state()).registrations.get("account")?.unauthenticated).toBe(true);
  await f.store.transaction((state) => {
    (state.installations.get(f.id) as Installation).activated = true;
    ((state.registrations.get("account") as PushRegistration).topics[0] as PushTopic).expiresAt =
      epoch;
  });
  expect((await f.deliver()).status).toBe(202);
  expect(f.send).not.toHaveBeenCalled();
  f.time(epoch + 30 * 86_400_000);
  expect((await f.deliver()).status).toBe(404);
  expect((await f.state()).installations.size).toBe(0);
});

test("LWS reuses RFC 9421 verification and trusts matched subscriptions independently of URL layout", async () => {
  const v = await vector();
  const f = await setup({ protocol: "lws", storage });
  f.outboundFetch.mockResolvedValue(Response.json(v.document));
  const delivery = { ...event, protocol: "solid", subscription: f.registration.topics[0]?.channel };
  const signed = v.signed(delivery, { url: f.inbox });
  const request = () =>
    new Request(f.inbox, {
      method: "POST",
      headers: signed.headers,
      body: new Uint8Array(signed.body),
    });
  expect((await f.relay.handle(request())).status).toBe(202);
  expect(f.send).toHaveBeenCalledTimes(1);
  expect(f.send.mock.calls[0]?.[1]).toMatchObject({ kind: "inbox", topicIndex: 0 });
  expect(f.outboundFetch).toHaveBeenLastCalledWith(storage, {
    headers: { accept: "application/lws+cid" },
    redirect: "error",
    credentials: "omit",
  });
  expect((await f.state()).registrations.get("account")?.unauthenticated).toBeUndefined();
  // The shared store suppresses replays on another relay instance too.
  const second = createRelay(f.options);
  active.push(second);
  f.outboundFetch.mockResolvedValue(Response.json(v.document));
  expect((await second.handle(request())).status).toBe(202);
  expect(f.send).toHaveBeenCalledTimes(1);
});

test.each([
  "digest",
  "stale",
  "authentication",
  "storage",
  "prefix",
  "description",
  "subscription",
  "missing-subscription",
  "type",
  "unsigned",
])("drops invalid LWS %s vectors without exposing verification details", async (failure) => {
  const v = await vector();
  const f = await setup({ protocol: "lws", storage });
  const description = structuredClone(v.document);
  if (failure === "authentication") description.authentication = [];
  if (failure === "description") description.id = "https://other.example/storage";
  f.outboundFetch.mockResolvedValue(Response.json(description));
  const json = {
    ...event,
    subscription:
      failure === "missing-subscription"
        ? undefined
        : failure === "subscription"
          ? "foreign"
          : f.registration.topics[0]?.channel,
    ...(failure === "storage" ? { storage: "https://foreign.example/description" } : {}),
    ...(failure === "type" ? { type: "Other" } : {}),
    protocol: "solid",
    object: "https://pod.example/inbox/",
  };
  const signed = v.signed(json, {
    url: f.inbox,
    ...(failure === "stale" ? { created: epoch / 1000 - 301 } : {}),
    ...(failure === "prefix"
      ? { params: `;created=${epoch / 1000};keyid="${storage}-evil#key";alg="ed25519"` }
      : {}),
  });
  if (failure === "digest") signed.headers["content-digest"] = "sha-256=:AAAA:";
  if (failure === "unsigned") delete signed.headers["signature-input"];
  f.outboundFetch.mockClear();
  const response = await f.relay.handle(
    new Request(f.inbox, {
      method: "POST",
      headers: signed.headers,
      body: new Uint8Array(signed.body),
    }),
  );
  expect(response.status).toBe(202);
  expect(await response.text()).toBe("");
  expect(f.send).not.toHaveBeenCalled();
  if (
    [
      "prefix",
      "digest",
      "stale",
      "storage",
      "subscription",
      "missing-subscription",
      "type",
      "unsigned",
    ].includes(failure)
  )
    expect(f.outboundFetch).not.toHaveBeenCalled();
});

test("rechecks expiry, installation and subscription bindings after asynchronous verification", async () => {
  const f = await setup({
    topics: [
      {
        index: 0,
        kind: "inbox",
        topic: "https://pod.example/inbox/",
        channel: "https://pod.example/channel/1",
        sender: webid,
        expiresAt: epoch + 1000,
      },
    ],
  });
  const original = f.store.transaction.bind(f.store);
  const baseline = await f.state();
  for (const mutation of [
    "delete",
    "binding",
    "expiry",
    "inactive",
    "no-installation",
    "registration-expiry",
  ]) {
    await original((state) => {
      state.installations = structuredClone(baseline.installations);
      state.registrations = structuredClone(baseline.registrations);
    });
    f.time(epoch);
    const reserve = f.store.insertIfAbsent.bind(f.store);
    const spy = vi.spyOn(f.store, "insertIfAbsent").mockImplementation(async (key, ttl) => {
      if (key.startsWith("dpop:"))
        await original((state) => {
          const registration = state.registrations.get("account") as PushRegistration;
          if (mutation === "delete") state.registrations.delete("account");
          if (mutation === "binding") registration.inboxSecretHash = "rotated";
          if (mutation === "expiry") f.time(epoch + 1000);
          if (mutation === "registration-expiry") registration.expiresAt = epoch;
          if (mutation === "inactive")
            (state.installations.get(f.id) as Installation).activated = false;
          if (mutation === "no-installation") state.installations.delete(f.id);
        });
      return reserve(key, ttl);
    });
    const response = await f.call("POST", f.path, { object: "https://pod.example/inbox/item" });
    expect(response.status).toBe(202);
    expect(f.send).not.toHaveBeenCalled();
    spy.mockRestore();
  }
});

test("provider invalidation atomically removes only the matching current token and its registrations", async () => {
  const f = await setup();
  await f.call("PUT", "/push/registrations/sibling", f.registration);
  const other = await f.create();
  await f.call("PUT", "/push/registrations/other", { ...f.registration, installationId: other });
  expect((await f.state()).installations.get(f.id)?.tokenUpdatedAt).toBe(epoch);
  f.time(epoch + 1000);
  expect(
    (await f.call("PATCH", `/push/installations/${f.id}`, { pushToken: "refreshed" })).status,
  ).toBe(200);
  expect((await f.state()).installations.get(f.id)).toMatchObject({
    tokenVersion: 2,
    tokenUpdatedAt: epoch + 1000,
  });
  for (const invalidation of [
    { installationId: "missing", tokenVersion: 1 },
    { installationId: f.id, tokenVersion: 1 },
    { installationId: f.id, tokenVersion: 2, providerTimestamp: epoch },
    { installationId: f.id, tokenVersion: 2, providerTimestamp: epoch + 1000 },
  ]) {
    await f.relay.invalidatePush(invalidation);
    expect((await f.state()).installations.has(f.id)).toBe(true);
  }
  await f.relay.invalidatePush({
    installationId: f.id,
    tokenVersion: 2,
    providerTimestamp: epoch + 1001,
  });
  expect([...(await f.state()).installations.keys()]).toEqual([other]);
  expect([...(await f.state()).registrations.keys()]).toEqual(["other"]);
  await f.relay.invalidatePush({ installationId: other, tokenVersion: 1 });
  expect((await f.state()).installations.size).toBe(0);
  expect((await f.state()).registrations.size).toBe(0);
});

test("token timestamps change only with the token, and invalidations compare inside their commit", async () => {
  const f = await setup();
  f.time(epoch + 1000);
  expect(
    (
      await f.call("PATCH", `/push/installations/${f.id}`, {
        authSecret: Buffer.alloc(16, 9).toString("base64url"),
      })
    ).status,
  ).toBe(200);
  expect((await f.state()).installations.get(f.id)).toMatchObject({
    tokenVersion: 2,
    tokenUpdatedAt: epoch,
  });
  const original = f.store.transaction.bind(f.store);
  const spy = vi.spyOn(f.store, "transaction").mockImplementationOnce(async (operation) => {
    await original((state) => {
      const installation = state.installations.get(f.id) as Installation;
      installation.tokenVersion++;
      installation.tokenUpdatedAt = epoch + 2000;
    });
    return original(operation);
  });
  await f.relay.invalidatePush({ installationId: f.id, tokenVersion: 2 });
  spy.mockRestore();
  expect((await f.state()).installations.has(f.id)).toBe(true);
});
