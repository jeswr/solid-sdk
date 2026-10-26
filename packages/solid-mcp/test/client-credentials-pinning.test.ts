// AUTHORED-BY Codex GPT-6.1-Sol
import { Readable } from "node:stream";
import { createPinningDispatcher } from "@jeswr/guarded-fetch/node";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCliFetch } from "../src/client-credentials.js";
import { ISSUER, mockCss, POD } from "./fixtures/css.mjs";

const sockets = vi.hoisted(() => ({ connected: [] as string[] }));

// Replace socket creation; retain the actual connect-time validating lookup.
vi.mock("@jeswr/guarded-fetch/node", async (importOriginal) => {
  const original = await importOriginal<typeof import("@jeswr/guarded-fetch/node")>();
  return {
    ...original,
    createPinningDispatcher: vi.fn((options) => ({
      close: async () => {},
      request: async (request) => {
        expect(request.origin).toBe("https://profile.example");
        expect(request.path).toBe("/card");
        expect(request.method).toBe("GET");
        expect(request.headers).not.toHaveProperty("authorization");
        expect(request.headers).not.toHaveProperty("dpop");
        const lookup = original.createValidatingLookup(
          options.resolveAll,
          options.allowLoopback,
          false,
        );
        await new Promise<void>((resolve, reject) => {
          lookup("profile.example", { all: true }, (error, addresses) => {
            if (error) return reject(error);
            if (typeof addresses === "string") throw new Error("Expected pinned addresses");
            sockets.connected.push(...addresses.map(({ address }) => address));
            resolve();
          });
        });
        return {
          statusCode: 200,
          headers: { "content-type": "text/plain" },
          body: Readable.from([Buffer.from("public profile")]),
        };
      },
    })),
  };
});

afterEach(() => {
  vi.clearAllMocks();
  sockets.connected.length = 0;
});

describe("anonymous redirect connection pinning", () => {
  it.each([
    ["10.0.0.1", false],
    ["127.0.0.1", false],
    ["169.254.169.254", false],
    ["93.184.216.34", true],
  ])("validates and pins the connect-time answer %s (allowed: %s)", async (address, allowed) => {
    const css = mockCss();
    const dnsLookup = vi
      .fn()
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValueOnce([{ address, family: 4 }]);
    const transport = await createCliFetch(
      {
        podRoot: POD,
        readOnly: true,
        clientId: "fixture-id",
        clientSecret: "fixture-secret",
        oidcIssuer: ISSUER,
      },
      async (input, init) => {
        const request = new Request(input, init);
        if (request.url.startsWith(ISSUER)) return css.fetch(input, init);
        expect(request.url).toBe("https://profile.example/me");
        expect(request.headers.get("authorization")).toBeNull();
        expect(request.headers.get("dpop")).toBeNull();
        expect(request.credentials).toBe("omit");
        expect(request.redirect).toBe("manual");
        return new Response(null, { status: 302, headers: { location: "/card" } });
      },
      dnsLookup,
    );
    const result = transport("https://profile.example/me", {
      headers: { authorization: "DPoP fixture-token-1", dpop: "fixture" },
    });
    if (allowed) expect(await (await result).text()).toBe("public profile");
    else await expect(result).rejects.toThrow("Invalid anonymous profile redirect");
    expect(sockets.connected).toEqual(allowed ? [address] : []);
    expect(dnsLookup).toHaveBeenCalledTimes(2);
    expect(createPinningDispatcher).toHaveBeenCalledExactlyOnceWith({
      allowLoopback: false,
      resolveAll: dnsLookup,
    });
  });
});
