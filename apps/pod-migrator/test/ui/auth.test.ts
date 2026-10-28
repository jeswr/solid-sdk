// AUTHORED-BY Codex GPT-6
import { createSolidAuth } from "@jeswr/solid-auth-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  authConfig,
  createConnections,
  detectImplementation,
  PodConnection,
} from "../../src/auth/connections.js";
import { fakeAuth, profileTurtle, sourceRoot, sourceWebId } from "./fixtures.js";

vi.mock("@jeswr/solid-auth-core", () => ({ createSolidAuth: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

describe("independent sign-ins", () => {
  it("creates two instances with disjoint durable and redirect keys, and no issuer/global fetch arming", () => {
    vi.mocked(createSolidAuth).mockImplementation(() => fakeAuth(null));
    const connections = createConnections("https://migrate.example");
    expect(connections[0].auth).not.toBe(connections[1].auth);
    const configs = vi.mocked(createSolidAuth).mock.calls.map(([config]) => config);
    expect(configs).toHaveLength(2);
    for (const key of [
      "dbName",
      "rememberedAccountsKey",
      "recentAccountsKey",
      "redirectFlowKey",
      "redirectSentinelKey",
      "redirectUri",
    ] as const) {
      expect(configs[0]?.[key]).toBeTruthy();
      expect(configs[0]?.[key]).not.toBe(configs[1]?.[key]);
    }
    expect(configs[0]).toMatchObject({
      patchGlobalFetch: false,
      includeIssuerOrigin: false,
      allowedOrigins: [],
      callbackUri: "https://migrate.example/callback/source",
      redirectUri: "https://migrate.example/callback/source",
    });
    expect(configs[1]?.redirectUri).toBe("https://migrate.example/callback/target");
    expect(configs[1]?.clientId).toBe("https://migrate.example/clientid.jsonld");
    expect(authConfig("source", "https://migrate.example").includeWebIdOrigin).toBe(true);
  });

  it("registers and handles callbacks under the GitHub Pages base", async () => {
    const base = "/solid-sdk/pod-migrator/";
    vi.mocked(createSolidAuth).mockImplementation(() => fakeAuth(null));
    const connections = createConnections("https://jeswr.github.io", base);
    const configs = vi.mocked(createSolidAuth).mock.calls.map(([config]) => config);
    for (const [index, id] of ["source", "target"].entries()) {
      expect(configs[index]?.redirectUri).toBe(`https://jeswr.github.io${base}callback/${id}`);
      expect(configs[index]?.callbackUri).toBe(configs[index]?.redirectUri);
      expect(configs[index]?.clientId).toBe(`https://jeswr.github.io${base}clientid.jsonld`);
    }
    await Promise.all(
      connections.map((connection) =>
        connection.initialize(`https://jeswr.github.io${base}callback/target/?code=x&state=y`),
      ),
    );
    expect(connections[0].auth.handleRedirect).not.toHaveBeenCalled();
    expect(connections[1].auth.handleRedirect).toHaveBeenCalledOnce();
  });

  it("handles the callback only for its own side, before restore", async () => {
    const source = fakeAuth();
    const target = fakeAuth(null);
    await Promise.all([
      new PodConnection("source", source).initialize(
        "https://app.example/callback/target?code=code&state=state",
      ),
      new PodConnection("target", target).initialize(
        "https://app.example/callback/target?code=code&state=state",
      ),
    ]);
    expect(source.handleRedirect).not.toHaveBeenCalled();
    expect(target.handleRedirect).toHaveBeenCalledOnce();
    expect(target.handleRedirect.mock.invocationCallOrder[0]).toBeLessThan(
      target.restore.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("uses a completed callback's session directly and initializes once", async () => {
    const auth = fakeAuth();
    auth.handleRedirect.mockResolvedValue({ outcome: "completed", webId: sourceWebId });
    const connection = new PodConnection("source", auth);
    await Promise.all([
      connection.initialize("https://app.example/callback/source?code=x"),
      connection.initialize("https://app.example/callback/source?code=x"),
    ]);
    expect(auth.handleRedirect).toHaveBeenCalledOnce();
    expect(auth.restore).not.toHaveBeenCalled();
    expect(connection.snapshot().root).toBe(sourceRoot);
  });

  it("does not fall back to an old session after a declined callback", async () => {
    const auth = fakeAuth();
    auth.handleRedirect.mockResolvedValue({ outcome: "error", error: "declined" });
    const connection = new PodConnection("source", auth);
    await connection.initialize("https://app.example/callback/source?error=denied");
    expect(auth.restore).not.toHaveBeenCalled();
    expect(auth.publicFetch).not.toHaveBeenCalled();
    expect(connection.snapshot()).toMatchObject({ status: "error", root: null });
  });

  it("starts full-page login for a WebID or issuer", async () => {
    const auth = fakeAuth(null);
    const connection = new PodConnection("source", auth);
    await connection.login(sourceWebId, "webid");
    expect(auth.beginRedirectLogin).toHaveBeenLastCalledWith({
      webId: sourceWebId,
      prompt: "consent",
    });
    await connection.login("https://login.inrupt.com", "issuer");
    expect(auth.beginRedirectLogin).toHaveBeenLastCalledWith({
      oidcIssuer: "https://login.inrupt.com/",
      prompt: "consent",
    });
    await connection.login("https://user:secret@issuer.example", "issuer");
    expect(auth.beginRedirectLogin).toHaveBeenCalledTimes(2);
  });
});

describe("profile and credential boundaries", () => {
  it("uses the signed-in subject's pim:storage and arms only the storage origin", async () => {
    const auth = fakeAuth();
    const connection = new PodConnection("source", auth);
    await connection.initialize("https://app.example/");
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
      auth.authenticatedFetch.mock.calls.every(
        ([url, init]) =>
          url === sourceRoot &&
          init?.method === "HEAD" &&
          init?.redirect === "manual" &&
          init?.credentials === "omit",
      ),
    ).toBe(true);
    expect(auth.reArmAllowedOrigins).toHaveBeenCalledExactlyOnceWith(["https://storage.example"]);
  });

  it("uses authenticated fetch only for the exact private WebID document", async () => {
    const auth = fakeAuth();
    auth.publicFetch.mockResolvedValue(new Response(null, { status: 403 }));
    await new PodConnection("source", auth).readProfile();
    expect(auth.authenticatedFetch).toHaveBeenCalledWith(
      "https://source.example/profile/card",
      expect.objectContaining({ redirect: "manual", credentials: "omit" }),
    );
    expect(auth.reArmAllowedOrigins).toHaveBeenCalledExactlyOnceWith(["https://storage.example"]);
  });

  it("does not attach credentials on redirects, parse errors or server failures", async () => {
    for (const status of [302, 500]) {
      const auth = fakeAuth();
      auth.publicFetch.mockResolvedValue(
        new Response(null, { status, headers: { location: "https://evil.example" } }),
      );
      const connection = new PodConnection("source", auth);
      await connection.readProfile();
      expect(connection.snapshot().status).toBe("error");
      expect(auth.authenticatedFetch).not.toHaveBeenCalled();
      expect(auth.reArmAllowedOrigins).not.toHaveBeenCalled();
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
    const connection = new PodConnection("source", auth);
    await connection.readProfile();
    expect(connection.snapshot()).toMatchObject({ status: "choose-storage", root: null });
    expect(auth.reArmAllowedOrigins).not.toHaveBeenCalled();
    await connection.selectStorage("https://attacker.example/");
    expect(auth.reArmAllowedOrigins).not.toHaveBeenCalled();
    await connection.selectStorage("https://other.example/alice/");
    expect(auth.reArmAllowedOrigins).toHaveBeenCalledExactlyOnceWith(["https://other.example"]);
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
    const connection = new PodConnection("source", auth);
    await connection.readProfile();
    expect(connection.snapshot()).toMatchObject({ status: "error", root: null });
    expect(auth.reArmAllowedOrigins).not.toHaveBeenCalled();
  });

  it("fails closed when arming the storage is refused", async () => {
    const auth = fakeAuth();
    auth.reArmAllowedOrigins.mockReturnValue(false);
    const connection = new PodConnection("source", auth);
    await connection.readProfile();
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
    const connection = new PodConnection("source", auth);
    const reading = connection.readProfile();
    await connection.logout();
    resolve(new Response(profileTurtle, { headers: { "content-type": "text/turtle" } }));
    await reading;
    expect(connection.snapshot()).toMatchObject({ status: "signed-out", root: null, webId: null });
    expect(auth.reArmAllowedOrigins).not.toHaveBeenCalled();
  });

  it("keeps failed sign-out retryable while clearing the connected storage", async () => {
    const auth = fakeAuth();
    const connection = new PodConnection("source", auth);
    await connection.readProfile();
    auth.logout.mockRejectedValueOnce(new Error("Durable cleanup failed"));
    await connection.logout();
    expect(connection.snapshot()).toMatchObject({
      status: "error",
      root: null,
      webId: sourceWebId,
    });
    await connection.logout();
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
    auth.authenticatedFetch.mockImplementation(async (input, init) => {
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
    const connection = new PodConnection("source", auth);
    await connection.readProfile();
    expect(connection.snapshot()).toMatchObject({
      status: "connected",
      implementation: "css",
      accessSystem: "acp",
    });
    expect(
      auth.authenticatedFetch.mock.calls.some(
        ([url, init]) => url === sourceRoot && init?.method === "GET",
      ),
    ).toBe(method === "GET");
  });

  it.each([
    "hidden",
    "error",
    "redirect",
    "network",
  ])("keeps ACP unknown when header evidence is %s", async (failure) => {
    const auth = fakeAuth();
    auth.authenticatedFetch.mockImplementation(async () => {
      if (failure === "network") throw new Error("Network failure");
      return new Response(null, {
        status: failure === "error" ? 500 : failure === "redirect" ? 302 : 200,
        headers: {
          ...(failure === "hidden" ? {} : { "x-powered-by": "Community Solid Server" }),
          ...(failure === "redirect" ? { location: "https://evil.test/" } : {}),
        },
      });
    });
    const connection = new PodConnection("source", auth);
    await connection.readProfile();
    expect(connection.snapshot()).toMatchObject({ status: "connected", implementation: undefined });
    expect(auth.authenticatedFetch.mock.calls.every(([url]) => url === sourceRoot)).toBe(true);
  });

  it("does not promote RDF issuer or implementation claims, or pending login input, into trusted evidence", async () => {
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
    auth.authenticatedFetch.mockImplementation(async () => new Response(null));
    const connection = new PodConnection("target", auth);
    await connection.login("https://login.inrupt.com", "issuer");
    await connection.readProfile();
    expect(auth.issuer).toBe("https://issuer.example/");
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
    auth.authenticatedFetch.mockImplementation(async () => new Response(null));
    const connection = new PodConnection("target", auth);
    await connection.readProfile();
    expect(connection.snapshot()).toMatchObject({
      status: "connected",
      root,
      implementation: "ess",
    });
    expect(auth.reArmAllowedOrigins).toHaveBeenCalledExactlyOnceWith([
      "https://storage.inrupt.com",
    ]);
  });

  it.each([
    [null, undefined],
    ["Community Solid Server/7.2.0", "css"],
    ["solid-server/5.7.1", "nss"],
  ])("does not infer ESS from an Inrupt issuer for non-Inrupt storage (%s)", async (header, expected) => {
    const auth = fakeAuth();
    auth.issuer = "https://login.inrupt.com/";
    auth.authenticatedFetch.mockImplementation(
      async () => new Response(null, { headers: header ? { "x-powered-by": header } : {} }),
    );
    const connection = new PodConnection("target", auth);
    await connection.readProfile();
    expect(connection.snapshot()).toMatchObject({
      status: "connected",
      root: sourceRoot,
      implementation: expected,
    });
    expect(auth.authenticatedFetch).toHaveBeenCalledWith(
      sourceRoot,
      expect.objectContaining({ method: "HEAD" }),
    );
  });

  it("identifies the ACP language without inferring a server from editable ACP mode IRIs", async () => {
    const auth = fakeAuth();
    const acl = `${sourceRoot}.acr`;
    auth.authenticatedFetch.mockImplementation(async (url) =>
      url === acl
        ? new Response(
            "<urn:policy> <http://www.w3.org/ns/solid/acp#allow> <http://www.w3.org/ns/solid/acp#Read>.",
            { headers: { "content-type": "text/turtle" } },
          )
        : new Response(null, { headers: { link: `<${acl}>; rel="acl"` } }),
    );
    const connection = new PodConnection("target", auth);
    await connection.readProfile();
    expect(connection.snapshot()).toMatchObject({ implementation: undefined, accessSystem: "acp" });
  });

  it("tries GET when the root HEAD is unsupported", async () => {
    const auth = fakeAuth();
    auth.authenticatedFetch.mockImplementation(async (_url, init) =>
      init?.method === "HEAD"
        ? new Response(null, { status: 405 })
        : new Response(null, { headers: { "x-powered-by": "solid-server/5.7.1" } }),
    );
    const connection = new PodConnection("source", auth);
    await connection.readProfile();
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
    auth.authenticatedFetch.mockImplementation(async (url) =>
      url === sourceRoot
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : new Response(null, { headers: { "x-powered-by": "solid-server/5.7.1" } }),
    );
    const connection = new PodConnection("source", auth);
    await connection.readProfile();
    const first = connection.selectStorage(sourceRoot);
    await connection.selectStorage(other);
    expect(connection.snapshot()).toMatchObject({ root: other, implementation: "nss" });
    finish(new Response(null, { headers: { "x-powered-by": "Community Solid Server" } }));
    await first;
    expect(connection.snapshot()).toMatchObject({ root: other, implementation: "nss" });
    // A subsequent selection must not reuse the previous implementation.
    auth.authenticatedFetch.mockImplementation(async () => new Response(null));
    await connection.selectStorage(sourceRoot);
    expect(connection.snapshot()).toMatchObject({ root: sourceRoot, implementation: undefined });
  });

  it("does not publish a late root probe after logout", async () => {
    const auth = fakeAuth();
    let finish: (response: Response) => void = () => {};
    auth.authenticatedFetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const connection = new PodConnection("source", auth);
    const reading = connection.readProfile();
    await vi.waitFor(() => expect(auth.authenticatedFetch).toHaveBeenCalledOnce());
    await connection.logout();
    finish(new Response(null, { headers: { "x-powered-by": "Community Solid Server" } }));
    await reading;
    expect(connection.snapshot()).toMatchObject({
      status: "signed-out",
      root: null,
      implementation: undefined,
    });
    expect(auth.authenticatedFetch).toHaveBeenCalledOnce();
  });
});
