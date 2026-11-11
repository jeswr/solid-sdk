// AUTHORED-BY Codex GPT-6
import { generateKeyPairSync } from "node:crypto";
import { expect, test, vi } from "vitest";
import { activity, challenge, installation } from "../test/delivery-fixtures.js";
import { configuredRelay } from "./config.js";
import { configuredDelivery } from "./push-config.js";

type Sink = NonNullable<ReturnType<typeof configuredDelivery>>;
const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ type: "pkcs8", format: "pem" })
  .toString();
const ec = generateKeyPairSync("ec", { namedCurve: "P-256" })
  .privateKey.export({ type: "pkcs8", format: "pem" })
  .toString();
const fcmEnv = {
  RELAY_FCM_PROJECT_ID: "relay-project",
  RELAY_FCM_SERVICE_ACCOUNT: JSON.stringify({
    client_email: "relay@example.test",
    private_key: rsa,
  }),
};
const apnsEnv = {
  RELAY_APNS_KEY: ec,
  RELAY_APNS_KEY_ID: "key-id",
  RELAY_APNS_TEAM_ID: "team-id",
  RELAY_APNS_BUNDLE_ID: "org.jeswr.suite",
};

test("builds only fully configured platforms and exposes the invalidation composition seam", async () => {
  expect(configuredDelivery({})).toBeUndefined();
  const android = configuredDelivery(fcmEnv) as Sink;
  const ios = configuredDelivery(apnsEnv) as Sink;
  const both = configuredDelivery({ ...fcmEnv, ...apnsEnv, RELAY_APNS_SANDBOX: "1" }) as Sink;
  try {
    await expect(android.send({ ...installation, platform: "ios" }, challenge)).rejects.toThrow(
      "configured",
    );
    await expect(ios.send(installation, challenge)).rejects.toThrow("configured");
    const onInvalid = vi.fn();
    android.options.onInvalid = onInvalid;
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ access_token: "access", expires_in: 3600 }))
      .mockResolvedValueOnce(Response.json({}, { status: 404 }));
    const wired = configuredDelivery(fcmEnv, onInvalid, fetch) as Sink;
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      await wired.send(installation, activity);
      await vi.waitFor(() =>
        expect(onInvalid).toHaveBeenCalledWith({
          installationId: installation.installationId,
          tokenVersion: 1,
        }),
      );
    } finally {
      wired.close();
      log.mockRestore();
    }
  } finally {
    android.close();
    ios.close();
    both.close();
  }
});

test("partial or empty provider settings and invalid sandbox values are startup errors", () => {
  for (const values of [fcmEnv, apnsEnv]) {
    for (const name of Object.keys(values)) {
      const missing = { ...values };
      delete missing[name as keyof typeof missing];
      expect(() => configuredDelivery(missing)).toThrow("Incomplete");
      expect(() => configuredDelivery({ ...values, [name]: "" })).toThrow("Incomplete");
    }
  }
  for (const value of ["0", "true", "", "sandbox"])
    expect(() => configuredDelivery({ ...apnsEnv, RELAY_APNS_SANDBOX: value })).toThrow(
      "Incomplete",
    );
  expect(() => configuredDelivery({ RELAY_APNS_SANDBOX: "1" })).toThrow("Incomplete");
});

test("invalid JSON, keys and accounts produce secret-free startup errors", () => {
  for (const serviceAccount of [
    "secret-not-json",
    "null",
    "{}",
    JSON.stringify({ client_email: 1, private_key: rsa }),
    JSON.stringify({ client_email: "mail", private_key: 1 }),
    JSON.stringify({ client_email: "mail", private_key: "secret-key" }),
  ])
    expect(() =>
      configuredDelivery({ ...fcmEnv, RELAY_FCM_SERVICE_ACCOUNT: serviceAccount }),
    ).toThrow(/^Invalid push provider configuration$/u);
  expect(() => configuredDelivery({ ...apnsEnv, RELAY_APNS_KEY: "secret-key" })).toThrow(
    /^Invalid push provider configuration$/u,
  );
});

test("composition returns the real sink for invalidation wiring and closes it with the relay", async () => {
  const injected = { send: vi.fn(async () => {}) };
  const env = {
    ...fcmEnv,
    RELAY_PUBLIC_URL: "https://relay.example",
    RELAY_ID_TOKEN_AUDIENCE: "https://app.example/clientid",
    RELAY_TRUSTED_ISSUERS: JSON.stringify([
      { issuer: "https://issuer.example", jwksUri: "https://issuer.example/jwks" },
    ]),
  };
  const relay = configuredRelay(env, { pushSink: injected });
  const close = vi.spyOn(relay.deliverySink as Sink, "close");
  relay.close();
  expect(close).toHaveBeenCalledTimes(1);
  await expect((relay.deliverySink as Sink).send(installation, challenge)).rejects.toThrow(
    "unavailable",
  );
  const normal = configuredRelay(env);
  normal.close();
});
