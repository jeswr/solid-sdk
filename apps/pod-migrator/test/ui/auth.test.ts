// AUTHORED-BY GPT-6.1 Sol
import { describe, expect, it, vi } from "vitest";
import { detectImplementation } from "../../src/auth/connections.js";
import {
  connectionFor,
  fakeAuth,
  profileTurtle,
  sessionFor,
  sourceRoot,
  sourceWebId,
} from "./fixtures.js";

describe("profile and credential boundaries", () => {
  it("uses the signed-in subject's pim:storage and the side's bounded fetch", async () => {
    const auth = fakeAuth();
    const connection = connectionFor("source", auth);
    await connection.updateSession(sessionFor(auth));
    expect(connection.snapshot()).toMatchObject({
      status: "connected",
      root: sourceRoot,
      webId: sourceWebId,
    });
    expect(auth.publicFetch).toHaveBeenCalledWith(
      "https://source.example/profile/card",
      expect.objectContaining({ credentials: "omit", redirect: "manual" }),
    );
    expect(
      auth.fetch.mock.calls.every(
        ([url, init]) =>
          url === sourceRoot &&
          init?.method === "HEAD" &&
          init?.redirect === "manual" &&
          init?.credentials === "omit",
      ),
    ).toBe(true);
  });

  it("uses authenticated fetch only for the exact private WebID document", async () => {
    const auth = fakeAuth();
    auth.publicFetch.mockResolvedValue(new Response(null, { status: 403 }));
    await connectionFor("source", auth).updateSession(sessionFor(auth));
    expect(auth.fetch).toHaveBeenCalledWith(
      "https://source.example/profile/card",
      expect.objectContaining({ redirect: "manual", credentials: "omit" }),
    );
  });

  it("does not attach credentials on redirects, parse errors or server failures", async () => {
    for (const status of [302, 500]) {
      const auth = fakeAuth();
      auth.publicFetch.mockResolvedValue(
        new Response(null, { status, headers: { location: "https://evil.example" } }),
      );
      const connection = connectionFor("source", auth);
      await connection.updateSession(sessionFor(auth));
      expect(connection.snapshot().status).toBe("error");
      expect(auth.fetch).not.toHaveBeenCalled();
    }
  });

  it("requires an explicit selection for multiple storages; refuses injected choices", async () => {
    const auth = fakeAuth();
    auth.publicFetch.mockResolvedValue(
      new Response(
        `@prefix pim: <http://www.w3.org/ns/pim/space#>. <https://source.example/profile/card#me> pim:storage <https://storage.example/alice/>, <https://other.example/alice/>.`,
        { headers: { "content-type": "text/turtle" } },
      ),
    );
    const connection = connectionFor("source", auth);
    await connection.updateSession(sessionFor(auth));
    expect(connection.snapshot()).toMatchObject({ status: "choose-storage", root: null });
    expect(auth.fetch).not.toHaveBeenCalled();
    await connection.selectStorage("https://attacker.example/");
    expect(auth.fetch).not.toHaveBeenCalled();
    await connection.selectStorage("https://other.example/alice/");
    expect(connection.snapshot()).toMatchObject({
      status: "connected",
      root: "https://other.example/alice/",
    });
  });

  it.each([
    "http://storage.example/",
    "https://user:pass@storage.example/",
    "https://storage.example/%2fsecret/",
    "javascript:alert(1)",
  ])("rejects unsafe storage %s", async (root) => {
    const auth = fakeAuth();
    auth.publicFetch.mockResolvedValue(
      new Response(
        `<https://source.example/profile/card#me> <http://www.w3.org/ns/pim/space#storage> <${root}>.`,
        { headers: { "content-type": "text/turtle" } },
      ),
    );
    const connection = connectionFor("source", auth);
    await connection.updateSession(sessionFor(auth));
    expect(connection.snapshot()).toMatchObject({ status: "error", root: null });
  });

  it("never finishes a late profile read after logout", async () => {
    const auth = fakeAuth();
    let resolve: (response: Response) => void = () => {};
    auth.publicFetch.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const connection = connectionFor("source", auth);
    const reading = connection.updateSession(sessionFor(auth));
    await connection.logout();
    resolve(new Response(profileTurtle, { headers: { "content-type": "text/turtle" } }));
    await reading;
    expect(connection.snapshot()).toMatchObject({ status: "signed-out", root: null, webId: null });
  });
});

describe("trusted implementation detection", () => {
  it.each([
    ["https://storage.inrupt.com/pod/", null, "ess"],
    ["https://storage.eu.inrupt.com/pod/", null, "ess"],
    [sourceRoot, "Community Solid Server", "css"],
    [sourceRoot, "Community Solid Server/7.2.0", "css"],
    [sourceRoot, " solid-server/5.7.1 ", "nss"],
    [sourceRoot, null, undefined],
    [sourceRoot, "unrecognized", undefined],
    ["https://storage.inrupt.com.evil.test/", null, undefined],
    ["https://fakeinrupt.com/", null, undefined],
    ["https://inrupt.com/", null, undefined],
    ["https://storage.inrupt.com:444/", null, undefined],
    ["http://storage.inrupt.com/", "Community Solid Server", undefined],
    ["https://user@storage.inrupt.com/", null, undefined],
    [sourceRoot, "Not Community Solid Server", undefined],
    [sourceRoot, "solid-server/5.7.1, Community Solid Server", undefined],
  ])("identifies only explicit storage host/header evidence (%s, %s)", (root, header, expected) => {
    expect(detectImplementation(root as string, header)).toBe(expected);
  });

  it.each([
    "HEAD",
    "GET",
  ])("sets the implementation from the root %s header and separately discovers ACP", async (method) => {
    const auth = fakeAuth();
    const acl = `${sourceRoot}.acr`;
    auth.fetch.mockImplementation(async (input, init) => {
      if (input === acl) return new Response(null, { status: 403 });
      expect(input).toBe(sourceRoot);
      expect(init).toMatchObject({ redirect: "manual", credentials: "omit" });
      return new Response(null, {
        headers: {
          link: `<${acl}>; rel="acl", <http://www.w3.org/ns/solid/acp#AccessControlResource>; rel="type"`,
          ...(init?.method === method ? { "x-powered-by": "Community Solid Server" } : {}),
        },
      });
    });
    const connection = connectionFor("source", auth);
    await connection.updateSession(sessionFor(auth));
    expect(connection.snapshot()).toMatchObject({
      status: "connected",
      implementation: "css",
      accessSystem: "acp",
    });
    expect(
      auth.fetch.mock.calls.some(([url, init]) => url === sourceRoot && init?.method === "GET"),
    ).toBe(method === "GET");
  });

  it.each([
    "hidden",
    "error",
    "redirect",
    "network",
  ])("keeps ACP unknown when header evidence is %s", async (failure) => {
    const auth = fakeAuth();
    auth.fetch.mockImplementation(async () => {
      if (failure === "network") throw new Error("Network failure");
      return new Response(null, {
        status: failure === "error" ? 500 : failure === "redirect" ? 302 : 200,
        headers: {
          ...(failure === "hidden" ? {} : { "x-powered-by": "Community Solid Server" }),
          ...(failure === "redirect" ? { location: "https://evil.test/" } : {}),
        },
      });
    });
    const connection = connectionFor("source", auth);
    await connection.updateSession(sessionFor(auth));
    expect(connection.snapshot()).toMatchObject({ status: "connected", implementation: undefined });
    expect(auth.fetch.mock.calls.every(([url]) => url === sourceRoot)).toBe(true);
  });

  it("does not promote RDF issuer or implementation claims, into trusted evidence", async () => {
    const auth = fakeAuth();
    // Editable profile assertions cannot establish the storage implementation.
    auth.publicFetch.mockImplementation(
      async () =>
        new Response(
          `${profileTurtle}
      <https://source.example/profile/card#me> <http://www.w3.org/ns/solid/terms#oidcIssuer> <https://login.inrupt.com/>.
      <https://source.example/profile/card#me> <urn:implementation> "ess".`,
          { headers: { "content-type": "text/turtle" } },
        ),
    );
    auth.fetch.mockImplementation(async () => new Response(null));
    const connection = connectionFor("target", auth);
    await connection.updateSession(sessionFor(auth));
    expect(connection.snapshot().implementation).toBeUndefined();
  });

  it("identifies PodSpaces from its storage host even when the root header is hidden", async () => {
    const root = "https://storage.inrupt.com/alice/";
    const auth = fakeAuth();
    auth.publicFetch.mockImplementation(
      async () =>
        new Response(profileTurtle.replace(`<${sourceRoot}>`, `<${root}>`), {
          headers: { "content-type": "text/turtle" },
        }),
    );
    auth.fetch.mockImplementation(async () => new Response(null));
    const connection = connectionFor("target", auth);
    await connection.updateSession(sessionFor(auth));
    expect(connection.snapshot()).toMatchObject({
      status: "connected",
      root,
      implementation: "ess",
    });
  });

  it.each([
    [null, undefined],
    ["Community Solid Server/7.2.0", "css"],
    ["solid-server/5.7.1", "nss"],
  ])("does not infer ESS from an Inrupt issuer for non-Inrupt storage (%s)", async (header, expected) => {
    const auth = fakeAuth(sourceWebId, "https://login.inrupt.com/");
    auth.fetch.mockImplementation(
      async () => new Response(null, { headers: header ? { "x-powered-by": header } : {} }),
    );
    const connection = connectionFor("target", auth);
    await connection.updateSession(sessionFor(auth));
    expect((await auth.identity())?.issuer).toBe("https://login.inrupt.com/");
    expect(connection.snapshot()).toMatchObject({
      status: "connected",
      root: sourceRoot,
      implementation: expected,
    });
    expect(auth.fetch).toHaveBeenCalledWith(
      sourceRoot,
      expect.objectContaining({ method: "HEAD" }),
    );
  });

  it("identifies the ACP language without inferring a server from editable ACP mode IRIs", async () => {
    const auth = fakeAuth();
    const acl = `${sourceRoot}.acr`;
    auth.fetch.mockImplementation(async (url) =>
      url === acl
        ? new Response(
            "<urn:policy> <http://www.w3.org/ns/solid/acp#allow> <http://www.w3.org/ns/solid/acp#Read>.",
            { headers: { "content-type": "text/turtle" } },
          )
        : new Response(null, { headers: { link: `<${acl}>; rel="acl"` } }),
    );
    const connection = connectionFor("target", auth);
    await connection.updateSession(sessionFor(auth));
    expect(connection.snapshot()).toMatchObject({ implementation: undefined, accessSystem: "acp" });
  });

  it("tries GET when the root HEAD is unsupported", async () => {
    const auth = fakeAuth();
    auth.fetch.mockImplementation(async (_url, init) =>
      init?.method === "HEAD"
        ? new Response(null, { status: 405 })
        : new Response(null, { headers: { "x-powered-by": "solid-server/5.7.1" } }),
    );
    const connection = connectionFor("source", auth);
    await connection.updateSession(sessionFor(auth));
    expect(connection.snapshot().implementation).toBe("nss");
  });

  it("rechecks each selected storage and discards a superseded probe", async () => {
    const auth = fakeAuth();
    const other = "https://other.example/alice/";
    auth.publicFetch.mockImplementation(
      async () =>
        new Response(profileTurtle.replace(`<${sourceRoot}>`, `<${sourceRoot}>, <${other}>`), {
          headers: { "content-type": "text/turtle" },
        }),
    );
    let finish: (response: Response) => void = () => {};
    auth.fetch.mockImplementation(async (url) =>
      url === sourceRoot
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : new Response(null, { headers: { "x-powered-by": "solid-server/5.7.1" } }),
    );
    const connection = connectionFor("source", auth);
    await connection.updateSession(sessionFor(auth));
    const first = connection.selectStorage(sourceRoot);
    await connection.selectStorage(other);
    expect(connection.snapshot()).toMatchObject({ root: other, implementation: "nss" });
    finish(new Response(null, { headers: { "x-powered-by": "Community Solid Server" } }));
    await first;
    expect(connection.snapshot()).toMatchObject({ root: other, implementation: "nss" });
    // A subsequent selection must not reuse the previous implementation.
    auth.fetch.mockImplementation(async () => new Response(null));
    await connection.selectStorage(sourceRoot);
    expect(connection.snapshot()).toMatchObject({ root: sourceRoot, implementation: undefined });
  });

  it("does not publish a late root probe after logout", async () => {
    const auth = fakeAuth();
    let finish: (response: Response) => void = () => {};
    auth.fetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const connection = connectionFor("source", auth);
    const reading = connection.updateSession(sessionFor(auth));
    await vi.waitFor(() => expect(auth.fetch).toHaveBeenCalledOnce());
    await connection.logout();
    finish(new Response(null, { headers: { "x-powered-by": "Community Solid Server" } }));
    await reading;
    expect(connection.snapshot()).toMatchObject({
      status: "signed-out",
      root: null,
      implementation: undefined,
    });
    expect(auth.fetch).toHaveBeenCalledOnce();
  });
});
