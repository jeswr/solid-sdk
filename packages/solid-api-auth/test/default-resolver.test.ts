// AUTHORED-BY Codex GPT-6.1-Sol
import { createLocalJWKSet } from "jose";
import { expect, test, vi } from "vitest";
import { DpopApiVerifier } from "../src/index.js";
import { issuer, resourceFixture, webid } from "./resource-fixtures.js";

async function fixture() {
  const f = await resourceFixture();
  const now = Date.now();
  f.time(now);
  const request = () =>
    f.request({ ...f.claims, sub: "subject", iat: now / 1000, exp: now / 1000 + 3600 });
  return { ...f, request };
}

test("DpopApiVerifier uses the shared resolver by default and retains its trust gate", async () => {
  const f = await fixture();
  const verifier = new DpopApiVerifier({
    trustedIssuers: [issuer],
    webidFetch: f.outboundFetch,
    now: f.options.now,
  });
  await expect(verifier.authenticate(await f.request())).resolves.toMatchObject({
    webId: webid,
    issuer,
  });
  await verifier.authenticate(await f.request());
  expect(f.outboundFetch).toHaveBeenCalledTimes(4); // discovery + JWKS once; two profile reads
  await expect(verifier.authenticate(await f.request())).resolves.toMatchObject({ webId: webid });
  const untrusted = new DpopApiVerifier({
    trustedIssuers: ["https://other.example"],
    webidFetch: f.outboundFetch,
  });
  const calls = f.outboundFetch.mock.calls.length;
  await expect(untrusted.authenticate(await f.request())).rejects.toThrow("not trusted");
  expect(f.outboundFetch).toHaveBeenCalledTimes(calls);
});

test("injected issuer resolutions coalesce, recover from rejection and expire", async () => {
  const f = await fixture();
  const resolveIssuer = vi.fn(async () => ({ jwks: createLocalJWKSet({ keys: [f.jwk] }) }));
  const failure = Promise.withResolvers<never>();
  resolveIssuer.mockImplementationOnce(() => failure.promise);
  const verifier = new DpopApiVerifier({
    trustedIssuers: [issuer],
    resolveIssuer,
    bidirectionalMode: "off",
    now: f.options.now,
  });
  const requests = await Promise.all(Array.from({ length: 3 }, () => f.request()));
  const results = Promise.allSettled(requests.map((request) => verifier.authenticate(request)));
  await vi.waitFor(() => expect(resolveIssuer).toHaveBeenCalledTimes(1));
  failure.reject(new Error("unavailable"));
  for (const result of await results) expect(result).toMatchObject({ status: "rejected" });
  await verifier.authenticate(await f.request());
  expect(resolveIssuer).toHaveBeenCalledTimes(2);
  f.time(f.options.now() + 600_000);
  await verifier.authenticate(await f.request());
  expect(resolveIssuer).toHaveBeenCalledTimes(3);
});
