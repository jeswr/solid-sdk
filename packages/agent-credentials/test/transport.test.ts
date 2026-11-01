// AUTHORED-BY Codex GPT-6
import { createNodeGuardedFetch } from "@jeswr/guarded-fetch/node";
import { afterEach, expect, it, vi } from "vitest";
import { ALLOWED_ORIGINS, CALL_TIMEOUT_MS, call, GOOGLE, MAX_BODY } from "../src/providers.js";
import { createProviderTransport } from "../src/transport.js";

vi.mock("@jeswr/guarded-fetch/node", async (original) => {
  const actual = await original<typeof import("@jeswr/guarded-fetch/node")>();
  return { ...actual, createNodeGuardedFetch: vi.fn(actual.createNodeGuardedFetch) };
});
afterEach(() => vi.restoreAllMocks());
const dnsLookup = async () => [{ address: "1.1.1.1", family: 4 }];

it("uses DNS-pinning Node fetch in production with the provider call limits", () => {
  expect(createProviderTransport()).toBeTypeOf("function");
  expect(createNodeGuardedFetch).toHaveBeenCalledWith({
    allowLoopback: false,
    maxRedirects: 0,
    maxBytes: MAX_BODY,
    timeoutMs: CALL_TIMEOUT_MS,
  });
});

it("checks every official origin before DNS or transport and keeps call policy", async () => {
  const transport = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
    expect(init?.redirect).toBe("manual");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-token");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    return new Response('{"ok":true}');
  });
  const lookup = vi.fn(dnsLookup);
  const scoped = createProviderTransport({ transport, dnsLookup: lookup });
  for (const origin of ALLOWED_ORIGINS)
    expect(
      await call(
        scoped,
        `${origin}/fixture`,
        { headers: { authorization: "Bearer test-token" }, redirect: "follow" },
        "fixture",
      ),
    ).toEqual({ status: 200, body: { ok: true } });
  transport.mockClear();
  lookup.mockClear();
  for (const url of [
    "https://outside.example/token",
    "https://127.0.0.1/token",
    "http://oauth2.googleapis.com/token",
    "invalid-secret-url",
    "https://user:secret@oauth2.googleapis.com/token",
    `${GOOGLE.token}#secret`,
  ]) {
    const error = await scoped(url, {}).catch((error: unknown) => error);
    expect(error).toMatchObject({ code: "refused", message: "not an allowed provider URL" });
    expect(String(error)).not.toContain(url);
    expect((error as Error).cause).toBeUndefined();
  }
  expect(transport).not.toHaveBeenCalled();
  expect(lookup).not.toHaveBeenCalled();
});

it.each([
  301, 302, 303, 307, 308,
])("refuses HTTP %i without following or leaking its Location", async (status) => {
  for (const location of [GOOGLE.token, "https://outside.example/test-secret"]) {
    const transport = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.redirect).toBe("manual");
      return new Response(null, { status, headers: { location } });
    });
    const scoped = createProviderTransport({ transport, dnsLookup });
    await expect(scoped(GOOGLE.token, { redirect: "follow" })).rejects.toMatchObject({
      message: "provider request failed",
      code: "unavailable",
    });
    expect(transport).toHaveBeenCalledOnce();
  }
});

it("refuses loopback/private DNS answers and bounds the answer without network access", async () => {
  const transport = vi.fn(async () => new Response("x".repeat(MAX_BODY + 1)));
  for (const address of ["127.0.0.1", "::1", "10.0.0.1"]) {
    const scoped = createProviderTransport({
      transport,
      dnsLookup: async () => [{ address, family: address.includes(":") ? 6 : 4 }],
    });
    await expect(scoped(GOOGLE.token, {})).rejects.toThrow("provider request failed");
  }
  expect(transport).not.toHaveBeenCalled();
  await expect(createProviderTransport({ transport, dnsLookup })(GOOGLE.token, {})).rejects.toThrow(
    "provider request failed",
  );
});
