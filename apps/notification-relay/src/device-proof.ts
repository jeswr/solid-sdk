// AUTHORED-BY Codex GPT-6
import { createHash, timingSafeEqual } from "node:crypto";
import { calculateJwkThumbprint, importJWK, type JWK, jwtVerify } from "jose";
import { object, requirePush } from "./push-validation.js";
import type { RelayStore } from "./store.js";

export const sha256 = (value: string | Buffer): string =>
  createHash("sha256").update(value).digest("base64url");
/** Hash first so all comparisons are between equal-length buffers. */
export function matchesHash(value: string, hash: string): boolean {
  return timingSafeEqual(Buffer.from(sha256(value)), Buffer.from(hash));
}

/** installation-proof+jwt, ES256; binds raw body bytes and the configured public path. */
export async function verifyDeviceProof(options: {
  request: Request;
  body: Buffer;
  key: JWK;
  publicOrigin: string;
  now: number;
  store: RelayStore;
}): Promise<string> {
  const { request, body, key, publicOrigin, now, store } = options;
  const proof = request.headers.get("installation-proof");
  requirePush(proof && proof.length <= 4096, 401);
  const { payload, protectedHeader } = await jwtVerify(proof, await importJWK(key, "ES256"), {
    algorithms: ["ES256"],
    typ: "installation-proof+jwt",
    requiredClaims: ["htm", "htu", "iat", "body_sha256", "jti"],
    currentDate: new Date(now),
  });
  object(protectedHeader, ["alg", "typ"]);
  object(payload, ["htm", "htu", "iat", "body_sha256", "jti"]);
  requirePush(
    payload.htm === request.method &&
      payload.htu === `${publicOrigin}${new URL(request.url).pathname}` &&
      Number.isSafeInteger(payload.iat) &&
      Math.abs(now / 1000 - (payload.iat as number)) <= 60 &&
      payload.body_sha256 === sha256(body) &&
      typeof payload.jti === "string" &&
      payload.jti.length > 0 &&
      payload.jti.length <= 128,
    401,
  );
  const thumbprint = await calculateJwkThumbprint(key);
  // Include one millisecond past the inclusive ±60 s boundary, even for future iat.
  requirePush(
    await store.insertIfAbsent(
      `installation:${sha256(JSON.stringify([thumbprint, payload.jti]))}`,
      120_001,
    ),
    401,
  );
  return thumbprint;
}
