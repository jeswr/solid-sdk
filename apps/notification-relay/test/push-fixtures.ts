// AUTHORED-BY Codex GPT-6
import { randomUUID } from "node:crypto";
import { exportJWK, generateKeyPair, type JWTHeaderParameters, SignJWT } from "jose";
import { vi } from "vitest";
import { sha256 } from "../src/device-proof.js";
import type { PushSink } from "../src/push.js";
import { createRelay } from "../src/relay.js";
import { InMemoryRelayStore } from "../src/store.js";
import { epoch } from "./fixtures.js";
import { mobileClientId, publicUrl, resourceFixture, webid } from "./resource-fixtures.js";

export async function phone() {
  const keys = await generateKeyPair("ES256", { extractable: true });
  const jwk = await exportJWK(keys.publicKey);
  const body = {
    platform: "android",
    pushToken: "test-push-token",
    devicePublicKey: Buffer.concat([
      Buffer.from([4]),
      Buffer.from(jwk.x as string, "base64url"),
      Buffer.from(jwk.y as string, "base64url"),
    ]).toString("base64url"),
    authSecret: Buffer.alloc(16, 7).toString("base64url"),
    deviceSigningKey: jwk,
  };
  return { keys, jwk, body };
}
export async function pushFixture() {
  let clock = epoch;
  const now = () => clock;
  const store = new InMemoryRelayStore(now);
  const resource = await resourceFixture(store);
  const owner = await phone();
  const send = vi.fn<PushSink["send"]>(async () => {});
  const options = {
    publicUrl,
    fetch: resource.outboundFetch,
    mobileClientId,
    verifyIdToken: vi.fn(),
    now,
    store,
    pushSink: { send },
  };
  const relay = createRelay(options);
  async function request(
    method: string,
    path: string,
    json?: unknown,
    settings: {
      phone?: Awaited<ReturnType<typeof phone>>;
      proof?: boolean;
      token?: boolean;
      claims?: Record<string, unknown>;
      proofClaims?: Record<string, unknown>;
      header?: JWTHeaderParameters;
      body?: string | Uint8Array;
      headers?: Record<string, string>;
    } = {},
  ) {
    const url = `${publicUrl}${path}`;
    const body = settings.body ?? (json === undefined ? undefined : JSON.stringify(json));
    const headers = new Headers(settings.headers);
    if (body !== undefined && !headers.has("content-type"))
      headers.set("content-type", "application/json");
    if (settings.token !== false) {
      const token = await resource.token({
        ...resource.claims,
        exp: now() / 1000 + 3600,
        ...settings.claims,
      });
      headers.set("authorization", `DPoP ${token}`);
      headers.set("dpop", await resource.proof(token, { htm: method, htu: url.split("?")[0] }));
    }
    if (settings.proof !== false) {
      const device = settings.phone ?? owner;
      headers.set(
        "installation-proof",
        await new SignJWT({
          htm: method,
          htu: url.split("?")[0],
          iat: now() / 1000,
          body_sha256: sha256(body === undefined ? Buffer.alloc(0) : Buffer.from(body)),
          jti: randomUUID(),
          ...settings.proofClaims,
        })
          .setProtectedHeader(settings.header ?? { alg: "ES256", typ: "installation-proof+jwt" })
          .sign(device.keys.privateKey),
      );
    }
    return new Request(url, { method, headers, body });
  }
  const call = async (...args: Parameters<typeof request>) => relay.handle(await request(...args));
  async function create(device = owner) {
    const response = await call("POST", "/push/installations", device.body, { phone: device });
    if (response.status !== 201) throw new Error(`Create failed: ${response.status}`);
    return (await response.json()).installationId as string;
  }
  const registration = (installationId: string) => ({
    installationId,
    webId: webid,
    protocol: "solid",
    storage: "https://pod.example/",
    topics: [
      {
        index: 0,
        kind: "inbox",
        topic: "https://pod.example/inbox/",
        channel: "https://pod.example/channel/1",
        expiresAt: epoch + 7 * 86_400_000,
      },
    ],
  });
  const state = () => store.transaction((state) => state);
  return {
    ...resource,
    options,
    relay,
    store,
    owner,
    send,
    request,
    call,
    create,
    registration,
    state,
    time(value: number) {
      clock = value;
      resource.time(value);
    },
    now,
  };
}
