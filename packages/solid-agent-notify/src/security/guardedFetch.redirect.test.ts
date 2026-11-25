// AUTHORED-BY Codex GPT-6.1-Sol
import { beforeEach, expect, it, vi } from "vitest";
import { GuardedFetchError, guardedFetch, SsrfError } from "./guardedFetch.js";

const { transport } = vi.hoisted(() => ({ transport: vi.fn<typeof fetch>() }));
vi.mock("@jeswr/guarded-fetch/node", async () => {
  const { createGuardedFetch } = await import("@jeswr/guarded-fetch");
  return {
    createNodeGuardedFetch: (options: Parameters<typeof createGuardedFetch>[0]) =>
      createGuardedFetch({
        ...options,
        // Inert fixture transport: no socket or independent DNS lookup is opened.
        pinningFetch: transport,
        fetch: transport,
        dnsLookup: async () => [{ address: "8.8.8.8", family: 4 }],
      }),
  };
});

const start = "https://public.example/alias";
const target = "https://public.example/card";
const ttl = '<#me> <http://schema.org/name> "Fixture" .';

beforeEach(() => transport.mockReset());

it("opts GET into guarded following and retains the effective URL", async () => {
  transport
    .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: target } }))
    .mockResolvedValueOnce(new Response(ttl, { headers: { "content-type": "text/turtle" } }));
  expect(await guardedFetch(start)).toMatchObject({ finalUrl: target, status: 200, text: ttl });
  expect(transport.mock.calls.map(([url]) => url)).toEqual([start, target]);
  expect(transport.mock.calls.map(([, init]) => init?.redirect)).toEqual(["manual", "manual"]);
});

it("revalidates a GET redirect before contacting a private target", async () => {
  transport.mockResolvedValueOnce(
    new Response(null, { status: 302, headers: { location: "https://10.0.0.1/private" } }),
  );
  await expect(guardedFetch(start)).rejects.toBeInstanceOf(SsrfError);
  expect(transport).toHaveBeenCalledTimes(1);
});

it.each([
  301, 302, 303, 307, 308,
])("keeps POST %i redirects manual and refuses them", async (status) => {
  transport.mockResolvedValueOnce(new Response(null, { status, headers: { location: target } }));
  await expect(
    guardedFetch(start, { method: "POST", body: "fixture", skipContentTypeAllowlist: true }),
  ).rejects.toBeInstanceOf(GuardedFetchError);
  expect(transport).toHaveBeenCalledTimes(1);
  expect(transport.mock.calls[0]?.[1]).toMatchObject({
    method: "POST",
    body: "fixture",
    redirect: "manual",
  });
});

it("does not disclose the request URL or Location secrets when refusing a POST redirect", async () => {
  transport.mockResolvedValueOnce(
    new Response(null, {
      status: 302,
      headers: {
        location: "https://alice:password@login.example/callback?code=oauth-secret#access-token",
      },
    }),
  );
  const error = await guardedFetch(`${start}?sig=request-secret`, {
    method: "POST",
    body: "fixture",
    skipContentTypeAllowlist: true,
  }).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(GuardedFetchError);
  for (const secret of ["alice", "password", "oauth-secret", "access-token", "request-secret"]) {
    expect(String(error)).not.toContain(secret);
  }
  expect(String(error)).toContain("302");
});
