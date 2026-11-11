// AUTHORED-BY Codex GPT-6
import { generateKeyPairSync } from "node:crypto";
import { decodeJwt, decodeProtectedHeader, jwtVerify } from "jose";
import { afterEach, expect, test, vi } from "vitest";
import { buildFcmMessage, createFcmTransport } from "./fcm.js";

const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const serviceAccount = {
  client_email: "relay@project.iam.gserviceaccount.com",
  private_key: keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
};
const options = { serviceAccount, projectId: "test-project" };
const message = buildFcmMessage("device-token", "encrypted");
afterEach(() => vi.unstubAllGlobals());
const json = (body: unknown, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify(body), { status, headers });

test("builds exactly a non-collapsible high-priority data message", () => {
  expect(message).toEqual({
    message: {
      token: "device-token",
      data: { p: "encrypted" },
      android: { priority: "HIGH", ttl: "86400s" },
    },
  });
});

test("signs a verifiable RS256 bearer assertion, posts to fixed endpoints, caches and refreshes five minutes before expiry", async () => {
  let clock = 1_800_000_000_000;
  const fetch = vi.fn<typeof globalThis.fetch>(async () => json({ name: "accepted" }));
  fetch.mockResolvedValueOnce(json({ access_token: "access-one", expires_in: 3600 }));
  const transport = createFcmTransport({ ...options, fetch, now: () => clock });
  expect(await transport.send(message)).toEqual({ status: 200 });
  const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
  expect(url).toBe("https://oauth2.googleapis.com/token");
  expect(init).toMatchObject({
    method: "POST",
    redirect: "error",
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
  expect(init.signal).toBeInstanceOf(AbortSignal);
  const form = init.body as URLSearchParams;
  expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
  const assertion = form.get("assertion") as string;
  expect(decodeProtectedHeader(assertion)).toEqual({ alg: "RS256", typ: "JWT" });
  const verified = await jwtVerify(assertion, keys.publicKey, {
    algorithms: ["RS256"],
    currentDate: new Date(clock),
  });
  expect(verified.payload).toEqual({
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: url,
    iat: clock / 1000,
    exp: clock / 1000 + 3600,
  });
  expect(fetch.mock.calls[1]).toEqual([
    "https://fcm.googleapis.com/v1/projects/test-project/messages:send",
    expect.objectContaining({
      method: "POST",
      redirect: "error",
      body: JSON.stringify(message),
      headers: { authorization: "Bearer access-one", "content-type": "application/json" },
    }),
  ]);
  clock += 3_300_000 - 1;
  await transport.send(message);
  expect(fetch).toHaveBeenCalledTimes(3);
  clock++;
  fetch.mockResolvedValueOnce(json({ access_token: "access-two", expires_in: 3600 }));
  await transport.send(message);
  expect(fetch).toHaveBeenCalledTimes(5);
  expect(
    decodeJwt(
      ((fetch.mock.calls[3] as [string, RequestInit])[1].body as URLSearchParams).get(
        "assertion",
      ) as string,
    ).iat,
  ).toBe(clock / 1000);
});

test("shares concurrent refresh and permits a fresh attempt after network failure", async () => {
  let release!: (response: Response) => void;
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null));
  fetch.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const transport = createFcmTransport({ ...options, fetch });
  const a = transport.send(message);
  const b = transport.send(message);
  expect(fetch).toHaveBeenCalledTimes(1);
  release(json({ access_token: "access", expires_in: 3600 }));
  expect(await Promise.all([a, b])).toEqual([{ status: 200 }, { status: 200 }]);
  const failedFetch = vi
    .fn<typeof globalThis.fetch>()
    .mockRejectedValueOnce(new Error("network"))
    .mockResolvedValueOnce(json({ access_token: "access", expires_in: 3600 }))
    .mockResolvedValueOnce(json({}));
  const failed = createFcmTransport({ ...options, fetch: failedFetch });
  await expect(failed.send(message)).rejects.toThrow("network");
  expect(await failed.send(message)).toEqual({ status: 200 });
});

test("maps FCM detail error codes and Retry-After, preserving status on malformed bodies", async () => {
  const bodies = [
    { error: { details: [{ "@type": "unrelated" }, { errorCode: "UNREGISTERED" }] } },
    { error: { details: [null, {}] } },
    { error: { details: "invalid" } },
    { error: {} },
    {},
    null,
    "malformed",
  ];
  for (const [index, body] of bodies.entries()) {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(json({ access_token: "access", expires_in: 3600 }))
      .mockResolvedValueOnce(
        body === "malformed"
          ? new Response("not JSON", { status: 404 })
          : json(body, 404, { "retry-after": "30" }),
      );
    expect(await createFcmTransport({ ...options, fetch }).send(message)).toEqual({
      status: 404,
      ...(body === "malformed" ? {} : { retryAfter: "30" }),
      ...(index === 0 ? { reason: "UNREGISTERED" } : {}),
    });
  }
});

test("returns token endpoint statuses for sink failure handling and rejects malformed token responses", async () => {
  for (const status of [400, 401, 403, 429, 503]) {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      json({ error: "refused" }, status, { "retry-after": "8" }),
    );
    expect(await createFcmTransport({ ...options, fetch }).send(message)).toEqual({
      status,
      retryAfter: "8",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  }
  for (const body of [
    null,
    {},
    { access_token: 1 },
    { access_token: "" },
    { access_token: "a", expires_in: "3600" },
    { access_token: "a", expires_in: 0 },
    { access_token: "a", expires_in: -1 },
    "malformed",
  ]) {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      body === "malformed" ? new Response("bad") : json(body),
    );
    expect(await createFcmTransport({ ...options, fetch }).send(message)).toEqual({ status: 502 });
  }
});

test("clears cached credentials on auth failures and uses default fetch/clock", async () => {
  for (const status of [401, 403]) {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(json({ access_token: "old", expires_in: 3600 }))
      .mockResolvedValueOnce(json({}, status))
      .mockResolvedValueOnce(json({ access_token: "new", expires_in: 3600 }))
      .mockResolvedValueOnce(new Response(null));
    vi.stubGlobal("fetch", fetch);
    const transport = createFcmTransport(options);
    expect(await transport.send(message)).toEqual({ status });
    expect(await transport.send(message)).toEqual({ status: 200 });
    expect(fetch).toHaveBeenCalledTimes(4);
  }
});

test("validates project/account/key configuration", () => {
  for (const override of [
    { projectId: "a/b" },
    { serviceAccount: { ...serviceAccount, client_email: "" } },
    { serviceAccount: { ...serviceAccount, private_key: "invalid" } },
    {
      serviceAccount: {
        ...serviceAccount,
        private_key: generateKeyPairSync("ec", { namedCurve: "P-256" })
          .privateKey.export({ type: "pkcs8", format: "pem" })
          .toString(),
      },
    },
  ])
    expect(() => createFcmTransport({ ...options, ...override })).toThrow();
});
