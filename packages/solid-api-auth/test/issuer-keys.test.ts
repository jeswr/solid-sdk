// AUTHORED-BY Codex GPT-6.1-Sol
import { exportJWK, generateKeyPair, type JWK, jwtVerify, SignJWT } from "jose";
import { afterEach, expect, test, vi } from "vitest";
import { createIssuerKeyResolver, type IssuerKeyResolverOptions } from "../src/index.js";
import { issuerUrl } from "../src/issuer-keys.js";

const issuer = "https://issuer.example/tenant";
const uri = "https://keys.example/jwks";

async function fixture(options: Partial<IssuerKeyResolverOptions> = {}) {
  const makeKey = async (kid: string) => {
    const pair = await generateKeyPair("ES256");
    return { pair, jwk: { ...(await exportJWK(pair.publicKey)), kid } };
  };
  const oldKey = await makeKey("old");
  const rotated = await makeKey("rotated");
  const unknown = await makeKey("unknown");
  let published: JWK[] = [oldKey.jwk];
  let clock = 0;
  const outboundFetch = vi.fn<typeof fetch>(async (input) =>
    String(input).endsWith("/.well-known/openid-configuration")
      ? Response.json({
          issuer: String(input).replace("/.well-known/openid-configuration", ""),
          jwks_uri: uri,
        })
      : Response.json({ keys: published }),
  );
  const resolve = createIssuerKeyResolver({ outboundFetch, now: () => clock, ...options });
  const token = (key = oldKey) =>
    new SignJWT({ marker: key.jwk.kid })
      .setProtectedHeader({ alg: "ES256", kid: key.jwk.kid })
      .sign(key.pair.privateKey);
  const verify = async (key = oldKey, iss = issuer) =>
    jwtVerify(await token(key), (await resolve(iss)).jwks);
  return {
    oldKey,
    rotated,
    unknown,
    token,
    verify,
    resolve,
    outboundFetch,
    time: (value: number) => {
      clock = value;
    },
    publish: (keys: JWK[]) => {
      published = keys;
    },
  };
}

afterEach(() => vi.useRealTimers());

test.each([
  true,
  false,
])("coalesces forced refreshes; every waiter verifies its own signature (published=%s)", async (published) => {
  const f = await fixture();
  await f.verify();
  f.time(60_000);
  f.outboundFetch.mockClear();
  const pending = Promise.withResolvers<Response>();
  f.outboundFetch.mockImplementation(() => pending.promise);
  const results = Promise.allSettled(Array.from({ length: 20 }, () => f.verify(f.rotated)));
  await vi.waitFor(() => expect(f.outboundFetch).toHaveBeenCalledTimes(1));
  // Ordinary cached-key verification may continue during the forced load.
  await expect(f.verify()).resolves.toMatchObject({ payload: { marker: "old" } });
  pending.resolve(Response.json({ keys: [published ? f.rotated.jwk : f.oldKey.jwk] }));
  for (const result of await results)
    expect(result).toMatchObject(
      published
        ? { status: "fulfilled", value: { payload: { marker: "rotated" } } }
        : { status: "rejected", reason: { code: "ERR_JWKS_NO_MATCHING_KEY" } },
    );
  expect(f.outboundFetch).toHaveBeenCalledTimes(1);
  // A different token cannot inherit the successful waiter's verification.
  await expect(f.verify(f.unknown)).rejects.toMatchObject({ code: "ERR_JWKS_NO_MATCHING_KEY" });
  expect(f.outboundFetch).toHaveBeenCalledTimes(1);
});

test("shares one JWKS by URL across issuers but checks each discovery issuer", async () => {
  const f = await fixture();
  await Promise.all([f.verify(), f.verify(f.oldKey, "https://other.example/tenant")]);
  expect(f.outboundFetch.mock.calls.filter(([input]) => String(input) === uri)).toHaveLength(1);
  expect(f.outboundFetch).toHaveBeenCalledTimes(3);
  for (const [, init] of f.outboundFetch.mock.calls) {
    expect(init?.credentials).toBe("omit");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    for (const header of ["authorization", "dpop", "cookie"])
      expect(new Headers(init?.headers).has(header)).toBe(false);
  }
});

test("failed refreshes share the rejection, retain the original expiry and throttle retries", async () => {
  const f = await fixture();
  await f.verify();
  f.time(599_990);
  f.outboundFetch.mockClear();
  const pending = Promise.withResolvers<Response>();
  f.outboundFetch.mockImplementation(() => pending.promise);
  const results = Promise.allSettled(Array.from({ length: 20 }, () => f.verify(f.rotated)));
  await vi.waitFor(() => expect(f.outboundFetch).toHaveBeenCalledTimes(1));
  pending.resolve(new Response(null, { status: 503 }));
  for (const result of await results)
    expect(result).toMatchObject({
      status: "rejected",
      reason: { message: "Discovery unavailable" },
    });
  await f.verify();
  await expect(f.verify(f.rotated)).rejects.toMatchObject({ code: "ERR_JWKS_NO_MATCHING_KEY" });
  expect(f.outboundFetch).toHaveBeenCalledTimes(1);
  f.time(600_000);
  f.outboundFetch.mockImplementation(async (input) =>
    String(input) === uri
      ? Response.json({ keys: [f.rotated.jwk] })
      : Response.json({ issuer, jwks_uri: uri }),
  );
  await f.verify(f.rotated); // Original TTL expired despite the failed refresh; ordinary load works.
  expect(f.outboundFetch).toHaveBeenCalledTimes(3);
});

test("failed refresh cooldown ends exactly after a minute", async () => {
  const f = await fixture();
  await f.verify();
  f.time(60_000);
  f.outboundFetch.mockResolvedValueOnce(new Response(null, { status: 503 }));
  await expect(f.verify(f.rotated)).rejects.toThrow("Discovery unavailable");
  f.time(119_999);
  await expect(f.verify(f.rotated)).rejects.toMatchObject({ code: "ERR_JWKS_NO_MATCHING_KEY" });
  f.publish([f.rotated.jwk]);
  f.time(120_000);
  await f.verify(f.rotated);
  expect(f.outboundFetch).toHaveBeenCalledTimes(4);
});

test("fresh JWKS and non-key failures never trigger a forced refresh", async () => {
  const f = await fixture();
  await f.verify();
  f.time(59_999);
  await expect(f.verify(f.rotated)).rejects.toMatchObject({ code: "ERR_JWKS_NO_MATCHING_KEY" });
  f.time(60_000);
  const forged = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: "old" })
    .sign(f.rotated.pair.privateKey);
  await expect(jwtVerify(forged, (await f.resolve(issuer)).jwks)).rejects.toMatchObject({
    code: "ERR_JWS_SIGNATURE_VERIFICATION_FAILED",
  });
  expect(f.outboundFetch).toHaveBeenCalledTimes(2);
});

test.each([
  "discovery",
  "keys",
  "body",
  "refresh",
])("hung %s loads abort, release their slots and recover", async (stage) => {
  const f = await fixture({ timeoutMs: 10 });
  if (stage === "refresh") {
    await f.verify();
    f.time(60_000);
  }
  vi.useFakeTimers();
  const pending = Promise.withResolvers<Response>();
  let signal: AbortSignal | null | undefined;
  const original = f.outboundFetch.getMockImplementation() as typeof fetch;
  f.outboundFetch.mockImplementation(async (input, init) => {
    if (stage === "discovery" || String(input) === uri) {
      signal = init?.signal;
      if (stage === "body") {
        const response = Response.json({ keys: [f.oldKey.jwk] });
        vi.spyOn(response, "json").mockImplementation(() => new Promise(() => {}));
        return response;
      }
      return pending.promise;
    }
    return original(input, init);
  });
  const result = expect(f.verify(stage === "refresh" ? f.rotated : f.oldKey)).rejects.toThrow(
    "timed out",
  );
  // WebCrypto signing uses the real event loop; let it reach the fetch before advancing timers.
  await vi.waitFor(() => expect(signal).toBeInstanceOf(AbortSignal));
  await vi.advanceTimersByTimeAsync(10);
  await result;
  expect(signal?.aborted).toBe(true);
  f.outboundFetch.mockImplementation(original);
  if (stage === "refresh") {
    await expect(f.verify(f.rotated)).rejects.toMatchObject({ code: "ERR_JWKS_NO_MATCHING_KEY" });
    f.publish([f.rotated.jwk]);
    f.time(120_000);
  }
  await f.verify(stage === "refresh" ? f.rotated : f.oldKey);
  pending.resolve(Response.json({ keys: [] })); // Late settlement cannot overwrite recovered keys.
  await f.verify(stage === "refresh" ? f.rotated : f.oldKey);
});

test.each([
  null,
  [],
  {},
  { issuer: "foreign", jwks_uri: uri },
  { issuer },
  { issuer, jwks_uri: "http://private.example/jwks" },
  { issuer, jwks_uri: `${uri}#key` },
])("rejects malformed or untrusted metadata %j and permits discovery recovery", async (document) => {
  const f = await fixture();
  f.outboundFetch.mockResolvedValueOnce(Response.json(document));
  await expect(f.verify()).rejects.toThrow();
  await f.verify();
  expect(f.outboundFetch).toHaveBeenCalledTimes(3);
});

test.each([
  undefined,
  "https://",
  "ftp://x.example",
  "https://u:p@x.example",
  "https://x:p@x.example",
  "https://x.example/a\\b",
  "https://x.example/\n",
  "http://x.example",
])("rejects unsafe URL %j", (value) => {
  expect(() => issuerUrl(value, true)).toThrow("Invalid URL");
});

test.each([
  "http://localhost:3000/tenant",
  "http://127.0.0.1:3000/tenant",
  "http://[::1]:3000/tenant",
])("permits explicit loopback discovery only (%s)", async (iss) => {
  const f = await fixture({ allowInsecureLoopback: true });
  f.outboundFetch.mockResolvedValueOnce(
    Response.json({ issuer: iss, jwks_uri: "http://localhost:3000/jwks" }),
  );
  await expect(f.verify(f.oldKey, iss)).resolves.toMatchObject({ payload: { marker: "old" } });
  expect(() => issuerUrl(iss)).toThrow("Invalid URL");
});

test("default clock works and issuer queries/fragments are refused before I/O", async () => {
  const f = await fixture({ now: undefined });
  await f.verify();
  for (const iss of [`${issuer}?x=1`, `${issuer}#fragment`])
    await expect(f.resolve(iss)).rejects.toThrow("Invalid issuer");
  expect(f.outboundFetch).toHaveBeenCalledTimes(2);
});

test("rejects ambiguous local keys without trying to refresh", async () => {
  const f = await fixture();
  f.publish([f.oldKey.jwk, f.oldKey.jwk]);
  await expect(f.verify()).rejects.toMatchObject({ code: "ERR_JWKS_MULTIPLE_MATCHING_KEYS" });
  expect(f.outboundFetch).toHaveBeenCalledTimes(2);
});

test("requires exact discovery issuer equality even when URL normalization would match", async () => {
  const f = await fixture();
  f.outboundFetch.mockResolvedValueOnce(Response.json({ issuer, jwks_uri: uri }));
  await expect(f.resolve("https://ISSUER.example/tenant")).rejects.toThrow("Issuer mismatch");
});
