// AUTHORED-BY Codex GPT-6
import { createHash, randomUUID } from "node:crypto";
import {
  calculateJwkThumbprint,
  exportJWK,
  generateKeyPair,
  type JWTHeaderParameters,
  SignJWT,
} from "jose";
import { vi } from "vitest";
import { createRelay } from "../src/relay.js";
import { createResourceTokenVerifier } from "../src/resource-auth.js";
import { InMemoryRelayStore, type RelayStore } from "../src/store.js";
import { epoch } from "./fixtures.js";

export const issuer = "https://issuer.example/tenant";
export const webid = "https://person.example/profile#me";
export const mobileClientId = "https://mobile.example/clientid.jsonld";
export const publicUrl = "https://relay.example";
export const target = `${publicUrl}/push/installations`;
export const profile = `@prefix solid: <http://www.w3.org/ns/solid/terms#> . <${webid}> solid:oidcIssuer <${issuer}> .`;

export async function resourceFixture(
  store?: Pick<RelayStore, "insertIfAbsent"> & Partial<Pick<RelayStore, "transaction">>,
) {
  const signer = await generateKeyPair("ES256", { extractable: true });
  const device = await generateKeyPair("ES256", { extractable: true });
  const jwk = await exportJWK(signer.publicKey);
  const deviceJwk = await exportJWK(device.publicKey);
  const jkt = await calculateJwkThumbprint(deviceJwk);
  let clock = epoch;
  const now = () => clock;
  const outboundFetch = vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (url === `${issuer}/.well-known/openid-configuration`)
      return Response.json({ issuer, jwks_uri: `${issuer}/jwks` });
    if (url === `${issuer}/jwks`) return Response.json({ keys: [jwk] });
    if (url === webid.split("#")[0])
      return new Response(profile, { headers: { "content-type": "text/turtle" } });
    throw new Error("Unexpected outbound request");
  });
  const memory = new InMemoryRelayStore(now);
  const shared: RelayStore = store
    ? {
        insertIfAbsent: store.insertIfAbsent.bind(store),
        transaction: store.transaction?.bind(store) ?? memory.transaction.bind(memory),
      }
    : memory;
  const options = { publicUrl, outboundFetch, store: shared, now };
  const verify = createResourceTokenVerifier(options);
  const claims = {
    iss: issuer,
    aud: ["solid", "other"],
    exp: epoch / 1000 + 3600,
    webid,
    client_id: mobileClientId,
    cnf: { jkt },
  };
  const token = (payload: Record<string, unknown> = claims) =>
    new SignJWT(payload)
      .setProtectedHeader({ alg: "ES256", typ: "at+jwt" })
      .sign(signer.privateKey);
  const proof = (
    accessToken: string,
    payload: Record<string, unknown> = {},
    header: JWTHeaderParameters = { alg: "ES256", typ: "dpop+jwt", jwk: deviceJwk },
  ) =>
    new SignJWT({
      jti: randomUUID(),
      htm: "POST",
      htu: target,
      iat: clock / 1000,
      ath: createHash("sha256").update(accessToken).digest("base64url"),
      ...payload,
    })
      .setProtectedHeader(header)
      .sign(device.privateKey);
  async function request(
    payload: Record<string, unknown> = claims,
    dpopClaims: Record<string, unknown> = {},
    url = target,
    method = "POST",
  ) {
    const accessToken = await token(payload);
    return new Request(url, {
      method,
      headers: { authorization: `DPoP ${accessToken}`, dpop: await proof(accessToken, dpopClaims) },
    });
  }
  const relay = () =>
    createRelay({
      publicUrl,
      fetch: outboundFetch,
      store: shared,
      now,
      mobileClientId,
      verifyIdToken: async () => {
        throw new Error("Legacy verifier must not run");
      },
    });
  return {
    options,
    verify,
    outboundFetch,
    claims,
    jwk,
    deviceJwk,
    signer,
    device,
    token,
    proof,
    request,
    relay,
    time: (value: number) => {
      clock = value;
    },
  };
}
