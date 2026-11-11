// AUTHORED-BY Codex GPT-6
import { createGuardedFetch } from "@jeswr/guarded-fetch";
import { createNodeGuardedFetch } from "@jeswr/guarded-fetch/node";
import { expect, test, vi } from "vitest";
import { resourceFixture } from "../test/resource-fixtures.js";
import { createRelayOutboundFetch, isTestOutboundFetch } from "./outbound.js";
import { createResourceTokenVerifier } from "./resource-auth.js";

test("production guard refuses HTTP, private, loopback and link-local addresses", async () => {
  const outbound = createRelayOutboundFetch();
  expect(isTestOutboundFetch(outbound)).toBe(false);
  for (const url of [
    "http://8.8.8.8",
    "https://10.0.0.1",
    "https://172.16.0.1",
    "https://192.168.0.1",
    "https://127.0.0.1",
    "https://[::1]",
    "https://169.254.169.254",
    "https://[fe80::1]",
    "https://[fc00::1]",
  ])
    await expect(outbound(url)).rejects.toThrow();
});

test("injected Node guard refuses private DNS answers and mixed public/private rebinding sets", async () => {
  for (const addresses of [
    [{ address: "10.0.0.1", family: 4 }],
    [
      { address: "8.8.8.8", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ],
  ]) {
    const resolveAll = vi.fn(async () => addresses);
    const outboundFetch = createNodeGuardedFetch({
      maxBytes: 262_144,
      timeoutMs: 5_000,
      maxRedirects: 3,
      resolveAll,
    });
    const f = await resourceFixture();
    const verify = createResourceTokenVerifier({ ...f.options, outboundFetch });
    await expect(verify(await f.request())).rejects.toThrow();
    expect(resolveAll).toHaveBeenCalledTimes(1);
  }
});

test("the Node transport rechecks a DNS answer that changes before connection", async () => {
  const resolveAll = vi
    .fn()
    .mockResolvedValueOnce([{ address: "8.8.8.8", family: 4 }])
    .mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);
  const outboundFetch = createNodeGuardedFetch({
    maxBytes: 262_144,
    timeoutMs: 5_000,
    maxRedirects: 3,
    resolveAll,
  });
  const f = await resourceFixture();
  await expect(
    createResourceTokenVerifier({ ...f.options, outboundFetch })(await f.request()),
  ).rejects.toThrow();
  expect(resolveAll).toHaveBeenCalledTimes(2);
});

test("injected loopback guard revalidates redirects, bounds bytes and enforces its deadline", async () => {
  const f = await resourceFixture();
  const issuer = "http://127.0.0.1:3500";
  const paths: string[] = [];
  const transport = vi.fn<typeof fetch>(async (input) => {
    const path = new URL(String(input)).pathname;
    paths.push(path);
    if (path === "/.well-known/openid-configuration")
      return Response.json({ issuer, jwks_uri: `${issuer}/jwks` });
    if (path === "/jwks") return Response.json({ keys: [f.jwk] });
    if (path === "/profile")
      return new Response(
        `@prefix s: <http://www.w3.org/ns/solid/terms#> . <${issuer}/profile#me> s:oidcIssuer <${issuer}> .`,
        { headers: { "content-type": "text/turtle" } },
      );
    if (path === "/private")
      return new Response(null, {
        status: 302,
        headers: { location: "https://169.254.169.254/latest/meta-data" },
      });
    if (path.startsWith("/redirect/")) {
      const hops = Number(path.split("/").at(-1));
      return new Response(null, {
        status: 302,
        headers: { location: hops ? `/redirect/${hops - 1}` : "/profile" },
      });
    }
    if (path === "/declared-oversize")
      return new Response(null, { headers: { "content-length": "262145" } });
    if (path === "/streamed-oversize")
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(262_145));
            controller.close();
          },
        }),
      );
    if (path === "/slow")
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array([1]));
          },
        }),
      );
    throw new Error("Unexpected fixture request");
  });
  // IP literals have no DNS-rebinding window. Exercise the same guard core with a
  // deterministic byte transport because this sandbox cannot open listening sockets.
  const testGuard = (options: { allowLoopbackForTests: boolean }) =>
    createGuardedFetch({
      fetch: transport,
      dnsLookup: null,
      requireDnsPinning: true,
      maxBytes: 262_144,
      timeoutMs: 5_000,
      maxRedirects: 3,
      allowLoopback: options.allowLoopbackForTests,
    });
  const outboundFetch = testGuard({ allowLoopbackForTests: true });
  const verify = createResourceTokenVerifier({
    ...f.options,
    outboundFetch,
    allowLoopbackForTests: true,
  });
  const request = await f.request({ ...f.claims, iss: issuer, webid: `${issuer}/profile#me` });
  expect((await verify(request)).issuer).toBe(issuer);
  expect(paths).toEqual(["/.well-known/openid-configuration", "/jwks", "/profile"]);
  expect((await outboundFetch(`${issuer}/redirect/2`)).status).toBe(200);
  await expect(outboundFetch(`${issuer}/redirect/3`)).rejects.toThrow("redirects");
  await expect(outboundFetch(`${issuer}/private`)).rejects.toThrow();
  for (const path of ["declared-oversize", "streamed-oversize"])
    await expect(outboundFetch(`${issuer}/${path}`)).rejects.toThrow();
  vi.useFakeTimers();
  try {
    const slow = expect(outboundFetch(`${issuer}/slow`)).rejects.toThrow(/timed out/iu);
    await vi.advanceTimersByTimeAsync(5_000);
    await slow;
  } finally {
    vi.useRealTimers();
  }
  await expect(outboundFetch("https://10.0.0.1")).rejects.toThrow();
  expect(paths).not.toContain("/latest/meta-data");
  const nodeTestTransport = createRelayOutboundFetch({ allowLoopbackForTests: true });
  expect(isTestOutboundFetch(nodeTestTransport)).toBe(true);
  await expect(nodeTestTransport("https://10.0.0.1")).rejects.toThrow();
});
