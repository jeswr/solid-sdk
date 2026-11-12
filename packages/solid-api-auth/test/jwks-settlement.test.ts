// AUTHORED-BY Codex GPT-6.1-Sol
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { expect, test, vi } from "vitest";
import { epoch, resourceFixture, target, webid } from "./resource-fixtures.js";

const overlap = vi.hoisted(() => ({
  hold: false,
  rejected: Promise.withResolvers<void>(),
  release: Promise.withResolvers<void>(),
}));

// Delay one real missing-key rejection until another request has finished refreshing.
vi.mock("jose", async (original) => {
  const jose = await original<typeof import("jose")>();
  return {
    ...jose,
    createLocalJWKSet: (...args: Parameters<typeof jose.createLocalJWKSet>) => {
      const keys = jose.createLocalJWKSet(...args);
      return async (...params: Parameters<typeof keys>) => {
        try {
          return await keys(...params);
        } catch (error) {
          if (overlap.hold) {
            overlap.hold = false;
            overlap.rejected.resolve();
            await overlap.release.promise;
          }
          throw error;
        }
      };
    },
  };
});

test.each([
  "valid",
  "missing",
  "invalid",
])("retries the latest JWKS before cooldown after overlapping settlement (%s)", async (mode) => {
  overlap.rejected = Promise.withResolvers<void>();
  overlap.release = Promise.withResolvers<void>();
  const f = await resourceFixture();
  await f.verify(await f.request());
  f.time(epoch + 60_000);
  const key = await generateKeyPair("ES256");
  const jwk = { ...(await exportJWK(key.publicKey)), kid: "rotated" };
  const absent = await generateKeyPair("ES256");
  const absentJwk = { ...(await exportJWK(absent.publicKey)), kid: "absent" };
  const delayedKey = mode === "missing" ? { pair: absent, jwk: absentJwk } : { pair: key, jwk };
  const token = await new SignJWT(f.claims)
    .setProtectedHeader({ alg: "ES256", kid: jwk.kid })
    .sign(key.privateKey);
  const delayedToken = await new SignJWT(f.claims)
    .setProtectedHeader({ alg: "ES256", kid: delayedKey.jwk.kid })
    .sign(delayedKey.pair.privateKey);
  const request = async (accessToken = token) =>
    new Request(target, {
      method: "POST",
      headers: { authorization: `DPoP ${accessToken}`, dpop: await f.proof(accessToken) },
    });
  f.outboundFetch.mockClear();
  f.outboundFetch.mockImplementation(async () =>
    Response.json({ keys: mode === "invalid" ? [jwk, jwk] : [jwk] }),
  );
  overlap.hold = true;
  const delayed = f.verify(await request(delayedToken));
  const result = Promise.allSettled([delayed]);
  await overlap.rejected.promise;
  try {
    if (mode === "invalid") {
      await expect(f.verify(await request())).rejects.toMatchObject({
        code: "ERR_JWKS_MULTIPLE_MATCHING_KEYS",
      });
    } else {
      await expect(f.verify(await request())).resolves.toMatchObject({ webid });
    }
  } finally {
    overlap.release.resolve();
  }
  expect(await result).toMatchObject([
    mode === "valid"
      ? { status: "fulfilled", value: { webid } }
      : {
          status: "rejected",
          reason: {
            code:
              mode === "missing" ? "ERR_JWKS_NO_MATCHING_KEY" : "ERR_JWKS_MULTIPLE_MATCHING_KEYS",
          },
        },
  ]);
  expect(f.outboundFetch).toHaveBeenCalledTimes(1);
});
