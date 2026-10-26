// AUTHORED-BY Codex GPT-6
import { lookup } from "node:dns/promises";
import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCliFetch as cliFetch } from "../src/client-credentials.js";
import { search } from "../src/pod.js";
import { createFetchPodPort } from "../src/pod-port.js";
import { containerTurtle, makeFakePod } from "./fake-pod.js";
import { ISSUER, mockCss, POD, proofOf } from "./fixtures/css.mjs";

const config = {
  podRoot: POD,
  readOnly: true,
  clientId: "fixture-id",
  clientSecret: "fixture-secret",
  oidcIssuer: ISSUER,
};
const profile = "https://profile.example/me";

let profileTransport: typeof fetch;
const createCliFetch = async (...args: Parameters<typeof cliFetch>) => {
  profileTransport = args[1] ?? globalThis.fetch;
  return cliFetch(...args);
};

// Redirect-policy fixtures replace sockets only. The dedicated pinning suite
// retains the real connect-time validating lookup.
vi.mock("@jeswr/guarded-fetch/node", async (importOriginal) => {
  const original = await importOriginal<typeof import("@jeswr/guarded-fetch/node")>();
  return {
    ...original,
    createPinningDispatcher: vi.fn(() => ({
      close: async () => {},
      request: async (options: {
        origin: string;
        path: string;
        method: string;
        headers: Record<string, string>;
        signal: AbortSignal;
      }) => {
        const response = await profileTransport(new URL(options.path, options.origin), {
          method: options.method,
          headers: options.headers,
          signal: options.signal,
          credentials: "omit",
          redirect: "manual",
        });
        return {
          statusCode: response.status,
          headers: Object.fromEntries(response.headers),
          body: response.body ? Readable.fromWeb(response.body) : Readable.from([]),
        };
      },
    })),
  };
});

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));
beforeEach(() => {
  vi.mocked(lookup)
    .mockReset()
    .mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
});

describe("anonymous WebID profile redirects", () => {
  it.each([
    ["HEAD", 200],
    ["GET", 204],
    ["GET", 205],
    ["GET", 304],
  ])("preserves bodyless pinned responses (%s, %s)", async (method, status) => {
    const css = mockCss();
    const requests: string[] = [];
    const fetch = await createCliFetch(config, async (input, init) => {
      const request = new Request(input, init);
      if (request.url.startsWith(ISSUER)) return css.fetch(input, init);
      expect(request.method).toBe(method);
      requests.push(request.url);
      return request.url === profile
        ? new Response(null, { status: 302, headers: { location: "/card" } })
        : new Response(null, { status, headers: { "x-profile": "fixture" } });
    });
    const response = await fetch(profile, { method });
    expect(response.status).toBe(status);
    expect(response.body).toBeNull();
    expect(response.headers.get("x-profile")).toBe("fixture");
    expect(requests).toEqual([profile, "https://profile.example/card"]);
  });

  it.each([
    301, 302, 303, 307, 308,
  ])("follows %i same-origin redirects anonymously, including relative targets", async (status) => {
    const css = mockCss();
    const urls: string[] = [];
    const fetch = await createCliFetch(config, async (input, init) => {
      const request = new Request(input, init);
      if (request.url.startsWith(ISSUER)) return css.fetch(input, init);
      urls.push(request.url);
      expect(request.headers.get("authorization")).toBeNull();
      expect(request.headers.get("dpop")).toBeNull();
      expect(request.headers.get("accept")).toBe("text/turtle");
      expect(request.redirect).toBe("manual");
      expect(request.credentials).toBe("omit");
      if (request.url === profile)
        return new Response(null, { status, headers: { location: "/card" } });
      if (request.url === "https://profile.example/card")
        return new Response(null, {
          status,
          headers: { location: "https://profile.example/public-profile" },
        });
      return new Response("public profile");
    });
    const response = await fetch(profile, {
      headers: {
        authorization: "DPoP fixture-token-1",
        dpop: "fixture",
        accept: "text/turtle",
      },
    });
    expect(await response.text()).toBe("public profile");
    expect(urls).toEqual([
      profile,
      "https://profile.example/card",
      "https://profile.example/public-profile",
    ]);
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(lookup).toHaveBeenCalledWith("profile.example", { all: true });
    expect(css.stats.tokens).toBe(1);
  });

  it("bounds redirect chains and cancels their response bodies", async () => {
    const css = mockCss();
    let requests = 0;
    let cancelled = 0;
    const fetch = await createCliFetch(config, async (input, init) => {
      const request = new Request(input, init);
      if (request.url.startsWith(ISSUER)) return css.fetch(input, init);
      requests++;
      return new Response(
        new ReadableStream({
          cancel() {
            cancelled++;
          },
        }),
        { status: 302, headers: { location: `/profile-${requests}` } },
      );
    });
    await expect(fetch(profile)).rejects.toThrow(/too many.*redirect/i);
    expect(requests).toBe(6);
    expect(cancelled).toBe(requests);
  });

  it.each([
    "data:text/plain,profile",
    "file:///profile",
    "https://user:pass@example.com/",
    "https://user:pass@profile.example/card",
    "http://profile.example/card",
    "https://foreign.example/card",
    "https://profile.example:8443/card",
    "//profile.example/card",
    `${POD}public-profile`,
    "http://127.0.0.1/card",
  ])("rejects unsafe redirect target %s before fetching it", async (location) => {
    const css = mockCss();
    const urls: string[] = [];
    const fetch = await createCliFetch(config, async (input, init) => {
      const request = new Request(input, init);
      if (request.url.startsWith(ISSUER)) return css.fetch(input, init);
      urls.push(request.url);
      return new Response(null, { status: 302, headers: { location } });
    });
    await expect(fetch(profile)).rejects.toThrow(/invalid.*redirect/i);
    expect(urls).toEqual([profile]);
  });

  it.each([
    "127.0.0.1",
    "2130706433",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.0.1",
    "169.254.169.254",
    "[::1]",
    "[fc00::1]",
    "[::ffff:127.0.0.1]",
    "metadata.google.internal",
  ])("refuses same-origin redirects to non-public host %s", async (host) => {
    const css = mockCss();
    const source = new URL(`https://${host}/me`).href;
    const urls: string[] = [];
    const fetch = await createCliFetch(config, async (input, init) => {
      const request = new Request(input, init);
      if (request.url.startsWith(ISSUER)) return css.fetch(input, init);
      urls.push(request.url);
      return new Response(null, { status: 302, headers: { location: "/card" } });
    });
    await expect(fetch(source)).rejects.toThrow(/invalid.*redirect/i);
    expect(urls).toEqual([source]);
  });

  it.each([
    [{ address: "10.0.0.1", family: 4 }],
    [{ address: "fc00::1", family: 6 }],
    [{ address: "169.254.169.254", family: 4 }],
    [
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ],
    [],
  ])("rechecks every same-origin hop against DNS answers %j", async (...addresses) => {
    vi.mocked(lookup)
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValueOnce(addresses);
    const css = mockCss();
    const urls: string[] = [];
    let cancelled = 0;
    const fetch = await createCliFetch(config, async (input, init) => {
      const request = new Request(input, init);
      if (request.url.startsWith(ISSUER)) return css.fetch(input, init);
      urls.push(request.url);
      return new Response(
        new ReadableStream({
          cancel() {
            cancelled++;
          },
        }),
        { status: 302, headers: { location: `/card-${urls.length}` } },
      );
    });
    await expect(fetch(profile)).rejects.toThrow(/invalid.*redirect/i);
    expect(urls).toEqual([profile, "https://profile.example/card-1"]);
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(cancelled).toBe(2);
  });

  it("fails closed when a redirect destination cannot resolve", async () => {
    vi.mocked(lookup).mockRejectedValue(new Error("fixture DNS failure"));
    const css = mockCss();
    const urls: string[] = [];
    const fetch = await createCliFetch(config, async (input, init) => {
      const request = new Request(input, init);
      if (request.url.startsWith(ISSUER)) return css.fetch(input, init);
      urls.push(request.url);
      return new Response(null, { status: 302, headers: { location: "/card" } });
    });
    await expect(fetch(profile)).rejects.toThrow(/invalid.*redirect/i);
    expect(urls).toEqual([profile]);
  });

  it.each([
    "http://127.0.0.1:3000/me",
    "http://localhost:3000/me",
    "http://[::1]:3000/me",
    "https://localhost:3000/me",
  ])("preserves explicitly configured loopback profile redirects at %s", async (webId) => {
    vi.mocked(lookup).mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    const css = mockCss();
    const urls: string[] = [];
    const fetch = await createCliFetch({ ...config, webId }, async (input, init) => {
      const request = new Request(input, init);
      if (request.url.startsWith(ISSUER)) return css.fetch(input, init);
      urls.push(request.url);
      expect(request.headers.get("authorization")).toBeNull();
      expect(request.headers.get("dpop")).toBeNull();
      if (request.url === webId)
        return new Response(null, { status: 302, headers: { location: "/card" } });
      return new Response("local profile");
    });
    expect(await (await fetch(webId)).text()).toBe("local profile");
    expect(urls).toEqual([webId, new URL("/card", webId).href]);
  });

  it("preserves same-origin loopback redirects outside the configured local pod subtree", async () => {
    const css = mockCss();
    const webId = "http://127.0.0.1:3000/profile";
    const urls: string[] = [];
    const fetch = await createCliFetch(
      { ...config, podRoot: "http://127.0.0.1:3000/pod/" },
      async (input, init) => {
        const request = new Request(input, init);
        if (request.url.startsWith(ISSUER)) return css.fetch(input, init);
        urls.push(request.url);
        expect(request.headers.get("authorization")).toBeNull();
        expect(request.headers.get("dpop")).toBeNull();
        if (request.url === webId)
          return new Response(null, { status: 302, headers: { location: "/card" } });
        return new Response("local profile");
      },
    );
    expect(await (await fetch(webId)).text()).toBe("local profile");
    expect(urls).toEqual([webId, "http://127.0.0.1:3000/card"]);
  });

  it("refuses non-loopback DNS answers even for a configured local WebID", async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: "10.0.0.1", family: 4 }]);
    const css = mockCss();
    const webId = "http://localhost:3000/me";
    const urls: string[] = [];
    const fetch = await createCliFetch({ ...config, webId }, async (input, init) => {
      const request = new Request(input, init);
      if (request.url.startsWith(ISSUER)) return css.fetch(input, init);
      urls.push(request.url);
      return new Response(null, { status: 302, headers: { location: "/card" } });
    });
    await expect(fetch(webId)).rejects.toThrow(/invalid.*redirect/i);
    expect(urls).toEqual([webId]);
  });

  it.each<RequestInit>([
    { redirect: "manual" },
    { method: "POST", body: "do not replay" },
  ])("leaves non-following requests and writes unchanged: %j", async (init) => {
    const css = mockCss();
    let requests = 0;
    const fetch = await createCliFetch(config, async (input, options) => {
      const request = new Request(input, options);
      if (request.url.startsWith(ISSUER)) return css.fetch(input, options);
      requests++;
      return new Response(null, { status: 302, headers: { location: "/card" } });
    });
    expect((await fetch(profile, init)).status).toBe(302);
    expect(requests).toBe(1);
  });

  it.each([
    "fetch",
    "PodPort",
  ])("discovers Type Index hints through a redirected external profile using %s", async (source) => {
    const css = mockCss();
    const webId = `${profile}#me`;
    const index = `${POD}type-index`;
    const instance = `${POD}favorite.ttl`;
    const solid = "http://www.w3.org/ns/solid/terms#";
    const pod = makeFakePod({
      [POD]: { contentType: "text/turtle", body: containerTurtle(POD, []) },
      [index]: {
        contentType: "text/turtle",
        body: `<#registration> <${solid}instance> <${instance}> .`,
      },
    });
    const profiles: string[] = [];
    const authenticated: string[] = [];
    const fetch = await createCliFetch(config, async (input, init) => {
      const request = new Request(input, init);
      if (request.url.startsWith(ISSUER)) return css.fetch(input, init);
      if (request.url.startsWith(POD)) {
        expect(request.headers.get("authorization")).toBe("DPoP fixture-token-1");
        proofOf(request, "fixture-token-1");
        authenticated.push(request.url);
        return pod.fetch(input, init);
      }
      profiles.push(request.url);
      expect(request.headers.get("authorization")).toBeNull();
      expect(request.headers.get("dpop")).toBeNull();
      expect(request.redirect).toBe("manual");
      expect(request.credentials).toBe("omit");
      if (request.url === webId)
        return new Response(null, {
          status: 303,
          headers: { location: "https://profile.example/card" },
        });
      return new Response(`<${webId}> <${solid}publicTypeIndex> <${index}> .`, {
        headers: { "content-type": "text/turtle" },
      });
    });
    const podConfig = { ...config, fetch, webId };
    const hits = await search(
      source === "PodPort" ? createFetchPodPort(podConfig) : podConfig,
      "favorite",
    );
    expect(hits).toEqual([{ url: instance, name: "favorite.ttl", snippet: "type-index instance" }]);
    expect(profiles).toEqual([webId, "https://profile.example/card"]);
    expect(authenticated).toContain(index);
  });
});

describe("in-pod WebID profile redirects", () => {
  it.each([
    301, 302, 303, 307, 308,
  ])("discovers Type Index hints through a %i redirect with a fresh proof for each hop", async (status) => {
    const css = mockCss();
    const webId = `${POD}profile#me`;
    const card = `${POD}profile/card`;
    const index = `${POD}type-index`;
    const instance = `${POD}favorite.ttl`;
    const solid = "http://www.w3.org/ns/solid/terms#";
    const pod = makeFakePod({
      [POD]: { contentType: "text/turtle", body: containerTurtle(POD, []) },
      [webId]: {
        contentType: "text/turtle",
        body: "",
        redirectTo: "profile/card",
        redirectStatus: status,
      },
      [card]: {
        contentType: "text/turtle",
        body: `<${webId}> <${solid}publicTypeIndex> <${index}> .`,
      },
      [index]: {
        contentType: "text/turtle",
        body: `<#registration> <${solid}instance> <${instance}> .`,
      },
    });
    const urls: string[] = [];
    const proofs: string[] = [];
    const fetch = await createCliFetch(config, async (input, init) => {
      const request = new Request(input, init);
      if (request.url.startsWith(ISSUER)) return css.fetch(input, init);
      expect(request.headers.get("authorization")).toBe("DPoP fixture-token-1");
      expect(request.redirect).toBe("manual");
      expect(request.credentials).toBe("omit");
      proofs.push(proofOf(request, "fixture-token-1").jti);
      urls.push(request.url);
      return pod.fetch(input, init);
    });
    expect(await search({ ...config, fetch, webId }, "favorite")).toEqual([
      { url: instance, name: "favorite.ttl", snippet: "type-index instance" },
    ]);
    expect(urls).toEqual([webId, card, index, POD]);
    expect(new Set(proofs).size).toBe(urls.length);
    expect(css.stats.tokens).toBe(1);
  });

  it.each([
    "https://foreign.example/card",
    "https://pod.example/other/card",
  ])("refuses a profile redirect to %s and preserves the fallback scan", async (location) => {
    const css = mockCss();
    const webId = `${POD}profile#me`;
    const card = `${POD}profile/card`;
    const urls: string[] = [];
    const pod = makeFakePod({
      [POD]: {
        contentType: "text/turtle",
        body: containerTurtle(POD, [{ name: "favorite.txt" }]),
      },
      [webId]: { contentType: "text/turtle", body: "", redirectTo: "profile/card" },
      [card]: { contentType: "text/turtle", body: "", redirectTo: location },
    });
    const fetch = await createCliFetch(config, async (input, init) => {
      const request = new Request(input, init);
      if (request.url.startsWith(ISSUER)) return css.fetch(input, init);
      urls.push(request.url);
      return pod.fetch(input, init);
    });
    expect(await search({ ...config, fetch, webId }, "favorite")).toEqual([
      { url: `${POD}favorite.txt`, name: "favorite.txt", snippet: "name/url match" },
    ]);
    expect(urls).toEqual([webId, card, POD]);
  });

  it("bounds an in-pod profile redirect chain and falls back to the pod scan", async () => {
    const css = mockCss();
    const webId = `${POD}profile#me`;
    const pod = makeFakePod({
      [POD]: { contentType: "text/turtle", body: containerTurtle(POD, []) },
    });
    let redirects = 0;
    const fetch = await createCliFetch(config, async (input, init) => {
      const request = new Request(input, init);
      if (request.url.startsWith(ISSUER)) return css.fetch(input, init);
      if (request.url === POD) return pod.fetch(input, init);
      return new Response(null, {
        status: 302,
        headers: { location: `${POD}profile-${++redirects}` },
      });
    });
    expect(await search({ ...config, fetch, webId }, "favorite")).toEqual([]);
    expect(redirects).toBe(11);
  });
});
