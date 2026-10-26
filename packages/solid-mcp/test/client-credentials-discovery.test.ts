// AUTHORED-BY Codex GPT-6
import { describe, expect, it } from "vitest";
import { createCliFetch } from "../src/client-credentials.js";
import { search } from "../src/pod.js";
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

describe("anonymous WebID profile redirects", () => {
  it.each([
    301, 302, 303, 307, 308,
  ])("follows %i redirects anonymously, including relative and in-pod targets", async (status) => {
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
        return new Response(null, { status, headers: { location: `${POD}public-profile` } });
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
    expect(urls).toEqual([profile, "https://profile.example/card", `${POD}public-profile`]);
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

  it("discovers Type Index hints through a redirected external profile during search", async () => {
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
          headers: { location: "https://public.example/card" },
        });
      return new Response(`<${webId}> <${solid}publicTypeIndex> <${index}> .`, {
        headers: { "content-type": "text/turtle" },
      });
    });
    const hits = await search({ ...config, fetch, webId }, "favorite");
    expect(hits).toEqual([{ url: instance, name: "favorite.ttl", snippet: "type-index instance" }]);
    expect(profiles).toEqual([webId, "https://public.example/card"]);
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
