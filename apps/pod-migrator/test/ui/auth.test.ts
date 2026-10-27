// AUTHORED-BY Codex GPT-6
import { createSolidAuth } from "@jeswr/solid-auth-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { authConfig, createConnections, PodConnection } from "../../src/auth/connections.js";
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
    expect(auth.authenticatedFetch).not.toHaveBeenCalled();
    expect(auth.reArmAllowedOrigins).toHaveBeenCalledExactlyOnceWith(["https://storage.example"]);
  });

  it("uses authenticated fetch only for the exact private WebID document", async () => {
    const auth = fakeAuth();
    auth.publicFetch.mockResolvedValue(new Response(null, { status: 403 }));
    await new PodConnection("source", auth).readProfile();
    expect(auth.authenticatedFetch).toHaveBeenCalledExactlyOnceWith(
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
    connection.selectStorage("https://attacker.example/");
    expect(auth.reArmAllowedOrigins).not.toHaveBeenCalled();
    connection.selectStorage("https://other.example/alice/");
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
