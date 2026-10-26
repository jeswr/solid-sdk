// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { createSpotifySourceAuth } from "./source-auth.js";

const API = "https://api.spotify.com/v1/me/tracks";
const TOKEN = "https://accounts.spotify.com/api/token";
const token = { accessToken: "fixture-old", refreshToken: "fixture-refresh", tokenType: "Bearer" };
const response = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status });

describe("Spotify PKCE SourceAuth", () => {
  it("refreshes once after 401, retries with the new token and retains rotated tokens in memory", async () => {
    const onToken = vi.fn();
    const transport = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input) === TOKEN) {
        const body = new URLSearchParams(String(init?.body));
        expect(Object.fromEntries(body)).toEqual({
          client_id: "fixture-client",
          grant_type: "refresh_token",
          refresh_token: "fixture-refresh",
        });
        expect(new Headers(init?.headers).has("authorization")).toBe(false);
        expect(init?.redirect).toBe("manual");
        return response(200, {
          access_token: "fixture-new",
          refresh_token: "fixture-rotated",
          expires_in: 3600,
        });
      }
      expect(new Headers(init?.headers).get("authorization")).toMatch(/^Bearer fixture-(old|new)$/);
      return response(
        new Headers(init?.headers).get("authorization") === "Bearer fixture-old" ? 401 : 200,
      );
    });
    const auth = createSpotifySourceAuth({
      clientId: "fixture-client",
      token,
      fetch: transport,
      onToken,
    });
    expect((await auth.fetch(API)).status).toBe(200);
    expect((await auth.fetch(API)).status).toBe(200);
    expect(transport.mock.calls.filter(([url]) => url === TOKEN)).toHaveLength(1);
    expect(onToken).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: "fixture-new", refreshToken: "fixture-rotated" }),
    );
    expect(token.accessToken).toBe("fixture-old");
  });

  it("coalesces concurrent 401s and retains the old refresh token when not rotated", async () => {
    const onToken = vi.fn();
    const transport = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input) === TOKEN) return response(200, { access_token: "fixture-new" });
      return response(
        new Headers(init?.headers).get("authorization") === "Bearer fixture-old" ? 401 : 200,
      );
    });
    const auth = createSpotifySourceAuth({
      clientId: "fixture-client",
      token,
      fetch: transport,
      onToken,
    });
    expect(
      (await Promise.all([auth.fetch(API), auth.fetch(API)])).map((res) => res.status),
    ).toEqual([200, 200]);
    expect(transport.mock.calls.filter(([url]) => url === TOKEN)).toHaveLength(1);
    expect(onToken.mock.calls[0]?.[0].refreshToken).toBe("fixture-refresh");
  });

  it("does not loop when the refreshed credential is also rejected", async () => {
    const transport = vi.fn<typeof fetch>(async (input) =>
      String(input) === TOKEN ? response(200, { access_token: "fixture-new" }) : response(401),
    );
    const auth = createSpotifySourceAuth({ clientId: "fixture-client", token, fetch: transport });
    expect((await auth.fetch(API)).status).toBe(401);
    expect(transport).toHaveBeenCalledTimes(3);
  });

  it.each([
    400,
    500,
    "missing",
    "empty",
    "null",
    "invalid-json",
    "empty-body",
  ])("fails closed on refresh failure %s", async (failure) => {
    const onToken = vi.fn();
    const transport = vi.fn<typeof fetch>(async (input) => {
      if (String(input) !== TOKEN) return response(401);
      if (typeof failure === "number")
        return response(failure, { error_description: "fixture-sensitive" });
      if (failure === "invalid-json") return new Response("{");
      if (failure === "empty-body") return new Response(null);
      return response(
        200,
        failure === "missing" ? {} : failure === "null" ? null : { access_token: " " },
      );
    });
    const auth = createSpotifySourceAuth({
      clientId: "fixture-client",
      token,
      fetch: transport,
      onToken,
    });
    await expect(auth.fetch(API)).rejects.toMatchObject({
      name: "IntegrationAuthError",
      adapterId: "spotify",
      reason: "exchange-failed",
    });
    expect(onToken).not.toHaveBeenCalled();
  });

  it.each([true, false])("caps refresh responses at 64 KiB (declared: %s)", async (declared) => {
    const cap = 64 * 1024;
    const bytes = new TextEncoder().encode(
      JSON.stringify({ access_token: "fixture-new" }).padEnd(cap + 1, " "),
    );
    const cancel = vi.fn();
    let offset = 0;
    const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => {
      if (offset >= bytes.byteLength) return controller.close();
      controller.enqueue(bytes.subarray(offset, offset + 1024));
      offset += 1024;
    });
    const oversized = new Response(new ReadableStream({ pull, cancel }, { highWaterMark: 0 }), {
      headers: declared ? { "content-length": String(bytes.byteLength) } : undefined,
    });
    const onToken = vi.fn();
    const transport = vi.fn<typeof fetch>(async (input) =>
      String(input) === TOKEN ? oversized : response(401),
    );
    const auth = createSpotifySourceAuth({
      clientId: "fixture-client",
      token,
      fetch: transport,
      onToken,
    });
    await expect(auth.fetch(API)).rejects.toMatchObject({
      name: "IntegrationAuthError",
      adapterId: "spotify",
      reason: "exchange-failed",
      cause: { name: "ResponseTooLargeError", message: expect.stringContaining("too large") },
    });
    expect(cancel).toHaveBeenCalledOnce();
    expect(pull).toHaveBeenCalledTimes(declared ? 0 : cap / 1024 + 1);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(onToken).not.toHaveBeenCalled();
    expect(token.accessToken).toBe("fixture-old");
  });

  it("accepts a refresh response at exactly 64 KiB", async () => {
    const onToken = vi.fn();
    const transport = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input) === TOKEN)
        return new Response(JSON.stringify({ access_token: "fixture-new" }).padEnd(64 * 1024, " "));
      return response(
        new Headers(init?.headers).get("authorization") === "Bearer fixture-old" ? 401 : 200,
      );
    });
    const auth = createSpotifySourceAuth({
      clientId: "fixture-client",
      token,
      fetch: transport,
      onToken,
    });
    expect((await auth.fetch(API)).status).toBe(200);
    expect(onToken).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ accessToken: "fixture-new" }),
    );
  });

  it("requires a refresh token and never retries mutating calls", async () => {
    const transport = vi.fn<typeof fetch>(async () => response(401));
    const auth = createSpotifySourceAuth({
      clientId: "fixture-client",
      token: { accessToken: "fixture-old", tokenType: "Bearer" },
      fetch: transport,
    });
    await expect(auth.fetch(API)).rejects.toMatchObject({ reason: "not-configured" });
    expect((await auth.fetch(new Request(API, { method: "POST" }))).status).toBe(401);
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("confines credentials to the API and refuses API and token redirects", async () => {
    const transport = vi.fn<typeof fetch>(async () => response(200));
    const auth = createSpotifySourceAuth({ clientId: "fixture-client", token, fetch: transport });
    for (const url of [
      "https://evil.test/v1/me/tracks",
      "http://api.spotify.com/v1/me/tracks",
      TOKEN,
      "https://user:pass@api.spotify.com/v1/me/tracks",
    ])
      await expect(auth.fetch(url)).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
    for (const tokenRedirect of [false, true]) {
      const redirectTransport = vi.fn<typeof fetch>(async (input) => {
        if (tokenRedirect && String(input) !== TOKEN) return response(401);
        return new Response(null, { status: 302, headers: { location: "https://evil.test/" } });
      });
      const redirectAuth = createSpotifySourceAuth({
        clientId: "fixture-client",
        token,
        fetch: redirectTransport,
      });
      await expect(redirectAuth.fetch(API)).rejects.toThrow();
      expect(redirectTransport.mock.calls.every(([, init]) => init?.redirect === "manual")).toBe(
        true,
      );
    }
  });
});
