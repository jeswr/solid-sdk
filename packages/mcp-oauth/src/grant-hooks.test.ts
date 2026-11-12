// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { fixture, ISSUER, REDIRECT, RESOURCE, SESSION } from "../test/fixtures.js";
import { createAuthorizationServer } from "./index.js";
import { digest, GRANT_TTL, OAuthError } from "./protocol.js";
import type { AuthorizationServerOptions, Client, Grant } from "./types.js";

type GrantCreated = NonNullable<AuthorizationServerOptions["grantCreated"]>;

describe.each(["trusted", "callback"])("grant creation through %s completion", (route) => {
  async function complete(f: ReturnType<typeof fixture>, clientId: string) {
    if (route === "trusted") return f.server.authorize(f.authRequest(clientId), SESSION);
    await f.server.handle(f.authRequest(clientId));
    return f.server.handle(new Request(`${ISSUER}/callback?state=upstream-state`));
  }

  it("awaits the hook exactly once after durable grant storage and before storing a code", async () => {
    let release!: () => void;
    let notify!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      notify = resolve;
    });
    const grantCreated = vi.fn<GrantCreated>(async (event) => {
      expect(await f.stores.grants.get(event.grant.id)).toEqual(event.grant);
      expect(codes).not.toHaveBeenCalled();
      notify();
      await pending;
    });
    const f = fixture({ grantCreated });
    const clientId = await f.register({ client_name: "Assistant" });
    const codes = vi.spyOn(f.stores.codes, "put");
    const issuedAt = f.now();
    const completion = complete(f, clientId);
    await entered;
    expect(codes).not.toHaveBeenCalled();
    expect(grantCreated).toHaveBeenCalledExactlyOnceWith({
      grant: {
        id: expect.any(String),
        clientId,
        session: SESSION,
        resource: RESOURCE,
        scope: "mcp",
        expiresAt: issuedAt + GRANT_TTL,
        revoked: false,
        refreshAllowed: true,
      },
      client: await f.stores.clients.get(clientId),
      redirectUri: REDIRECT,
      issuedAt,
    });
    f.advance(2);
    release();
    const response = await completion;
    expect(response.status).toBe(302);
    const code = new URL(response.headers.get("location") as string).searchParams.get(
      "code",
    ) as string;
    expect(code).toBeTruthy();
    expect(codes).toHaveBeenCalledOnce();
    expect(await f.stores.codes.get(digest(code))).toMatchObject({
      grantId: grantCreated.mock.calls[0]?.[0].grant.id,
    });
    const tokens = await (await f.exchange(clientId, code)).json();
    expect((await f.refresh(clientId, tokens.refresh_token)).status).toBe(200);
    expect(grantCreated).toHaveBeenCalledOnce();
  });

  it("does not create a grant or call the hook on denial", async () => {
    const grantCreated = vi.fn<GrantCreated>();
    const f = fixture({ grantCreated, consent: async () => false });
    const grants = vi.spyOn(f.stores.grants, "put");
    const codes = vi.spyOn(f.stores.codes, "put");
    const response = await complete(f, await f.register());
    expect(new URL(response.headers.get("location") as string).searchParams.get("error")).toBe(
      "access_denied",
    );
    expect(grantCreated).not.toHaveBeenCalled();
    expect(grants).not.toHaveBeenCalled();
    expect(codes).not.toHaveBeenCalled();
  });

  it.each([
    new Error("private pod detail"),
    new OAuthError("access_denied"),
  ])("revokes the grant and session without a code when the hook throws %s", async (error) => {
    const grantCreated = vi.fn<GrantCreated>().mockRejectedValue(error);
    const f = fixture({ grantCreated });
    const codes = vi.spyOn(f.stores.codes, "put");
    const response = await complete(f, await f.register());
    expect(response.status).toBe(302);
    expect(
      Object.fromEntries(new URL(response.headers.get("location") as string).searchParams),
    ).toEqual({ existing: "1", error: "server_error", state: "client-state", iss: ISSUER });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("");
    expect(grantCreated).toHaveBeenCalledOnce();
    const event = grantCreated.mock.calls[0]?.[0] as Parameters<GrantCreated>[0];
    expect(await f.stores.grants.get(event.grant.id)).toMatchObject({ revoked: true });
    expect(await f.stores.grants.isSessionRevoked(SESSION.id)).toBe(true);
    expect(f.provider.revoke).toHaveBeenCalledExactlyOnceWith(SESSION.id);
    expect(codes).not.toHaveBeenCalled();
  });
});

describe("grant hook isolation and failures", () => {
  it.each([false, true])("isolates hook mutations, including on rejection (%s)", async (reject) => {
    let grantId!: string;
    const f = fixture({
      grantCreated: async (event) => {
        grantId = event.grant.id;
        const grant = event.grant as Grant;
        grant.id = "attacker-grant";
        grant.session.id = "attacker-session";
        grant.session.webId = "https://attacker.example/#me";
        grant.scope = "read";
        grant.revoked = true;
        (event.client as Client).client_id = "attacker-client";
        event.client.redirect_uris.length = 0;
        event.client.grant_types.length = 0;
        event.redirectUri = "https://attacker.example/callback";
        event.issuedAt = 0;
        if (reject) throw new Error("private detail");
      },
    });
    const clientId = await f.register();
    const response = await f.server.authorize(f.authRequest(clientId), SESSION);
    const destination = new URL(response.headers.get("location") as string);
    expect(destination.origin + destination.pathname).toBe("https://client.example/callback");
    expect(await f.stores.grants.get(grantId)).toMatchObject({
      id: grantId,
      session: SESSION,
      scope: "mcp",
      refreshAllowed: true,
      revoked: reject,
    });
    expect(await f.stores.clients.get(clientId)).toMatchObject({
      client_id: clientId,
      redirect_uris: [REDIRECT],
      grant_types: ["authorization_code", "refresh_token"],
    });
    if (reject) {
      expect(destination.searchParams.get("error")).toBe("server_error");
      expect(destination.searchParams.has("code")).toBe(false);
      expect(f.provider.revoke).toHaveBeenCalledExactlyOnceWith(SESSION.id);
    } else {
      const tokens = await (
        await f.exchange(clientId, destination.searchParams.get("code") as string)
      ).json();
      await expect(
        f.server.verifyAccessToken(tokens.access_token, RESOURCE),
      ).resolves.toMatchObject({
        webId: SESSION.webId,
        sessionId: SESSION.id,
        clientId,
        scope: "mcp",
        grantId,
      });
    }
  });

  it("keeps a failed hook closed when broker cleanup fails, retaining durable revocation", async () => {
    const grantCreated = vi.fn<GrantCreated>().mockRejectedValue(new Error("private detail"));
    const f = fixture({ grantCreated });
    const codes = vi.spyOn(f.stores.codes, "put");
    vi.mocked(f.provider.revoke).mockRejectedValueOnce(new OAuthError("access_denied"));
    const response = await f.server.authorize(f.authRequest(await f.register()), SESSION);
    expect(new URL(response.headers.get("location") as string).searchParams.get("error")).toBe(
      "server_error",
    );
    expect(codes).not.toHaveBeenCalled();
    expect(await f.stores.grants.isSessionRevoked(SESSION.id)).toBe(true);
    const grantId = grantCreated.mock.calls[0]?.[0].grant.id as string;
    expect(await f.stores.grants.get(grantId)).toMatchObject({ revoked: true });
    await f.server.revokeGrant(grantId);
    expect(f.provider.revoke).toHaveBeenCalledTimes(2);
  });

  it("still revokes the grant and the pod session when the session tombstone fails", async () => {
    const grantCreated = vi.fn<GrantCreated>().mockRejectedValue(new Error("private detail"));
    const f = fixture({ grantCreated });
    const codes = vi.spyOn(f.stores.codes, "put");
    vi.spyOn(f.stores.grants, "revokeSession").mockRejectedValueOnce(new Error("store down"));
    const response = await f.server.authorize(f.authRequest(await f.register()), SESSION);
    expect(new URL(response.headers.get("location") as string).searchParams.get("error")).toBe(
      "server_error",
    );
    expect(codes).not.toHaveBeenCalled();
    const grantId = grantCreated.mock.calls[0]?.[0].grant.id as string;
    expect(await f.stores.grants.get(grantId)).toMatchObject({ revoked: true });
    expect(f.provider.revoke).toHaveBeenCalledTimes(1);
  });

  it("still revokes the grant and the pod session when the tombstone throws synchronously", async () => {
    const grantCreated = vi.fn<GrantCreated>().mockRejectedValue(new Error("private detail"));
    const f = fixture({ grantCreated });
    const codes = vi.spyOn(f.stores.codes, "put");
    vi.spyOn(f.stores.grants, "revokeSession").mockImplementationOnce(() => {
      throw new Error("sync store failure");
    });
    const response = await f.server.authorize(f.authRequest(await f.register()), SESSION);
    expect(new URL(response.headers.get("location") as string).searchParams.get("error")).toBe(
      "server_error",
    );
    expect(codes).not.toHaveBeenCalled();
    const grantId = grantCreated.mock.calls[0]?.[0].grant.id as string;
    expect(await f.stores.grants.get(grantId)).toMatchObject({ revoked: true });
    expect(f.provider.revoke).toHaveBeenCalledTimes(1);
  });

  it("still revokes the session when grant revocation throws synchronously", async () => {
    const grantCreated = vi.fn<GrantCreated>().mockRejectedValue(new Error("private detail"));
    const f = fixture({ grantCreated });
    const revokeSession = vi.spyOn(f.stores.grants, "revokeSession");
    vi.spyOn(f.stores.grants, "revoke").mockImplementationOnce(() => {
      throw new Error("sync store failure");
    });
    const response = await f.server.authorize(f.authRequest(await f.register()), SESSION);
    expect(new URL(response.headers.get("location") as string).searchParams.get("error")).toBe(
      "server_error",
    );
    expect(revokeSession).toHaveBeenCalledOnce();
    expect(f.provider.revoke).toHaveBeenCalledTimes(1);
  });

  it("never calls the hook when grant storage fails", async () => {
    const grantCreated = vi.fn<GrantCreated>();
    const f = fixture({ grantCreated });
    const codes = vi.spyOn(f.stores.codes, "put");
    vi.spyOn(f.stores.grants, "put").mockRejectedValueOnce(new Error("store unavailable"));
    const response = await f.server.authorize(f.authRequest(await f.register()), SESSION);
    expect(new URL(response.headers.get("location") as string).searchParams.get("error")).toBe(
      "server_error",
    );
    expect(grantCreated).not.toHaveBeenCalled();
    expect(codes).not.toHaveBeenCalled();
  });
});

describe("public grant revocation", () => {
  it("treats unknown IDs as no-ops", async () => {
    const f = fixture();
    const revoke = vi.spyOn(f.stores.grants, "revoke");
    const revokeSession = vi.spyOn(f.stores.grants, "revokeSession");
    await expect(f.server.revokeGrant("unknown")).resolves.toBeUndefined();
    await expect(f.server.revokeGrant("unknown")).resolves.toBeUndefined();
    expect(revoke).not.toHaveBeenCalled();
    expect(revokeSession).not.toHaveBeenCalled();
    expect(f.provider.revoke).not.toHaveBeenCalled();
  });

  it("idempotently retires the entire session across workers, preserving unrelated sessions", async () => {
    const f = fixture();
    const clientId = await f.register();
    const tokens = await (await f.exchange(clientId, await f.code(clientId))).json();
    const sibling = await (await f.exchange(clientId, await f.code(clientId))).json();
    const pendingCode = await f.code(clientId);
    const other = await f.server.authorize(f.authRequest(clientId), { ...SESSION, id: "other" });
    const otherCode = new URL(other.headers.get("location") as string).searchParams.get(
      "code",
    ) as string;
    const unrelated = await (await f.exchange(clientId, otherCode)).json();
    const { grantId } = await f.server.verifyAccessToken(tokens.access_token, RESOURCE);
    const worker = createAuthorizationServer({
      issuer: ISSUER,
      resource: RESOURCE,
      stores: f.stores,
      signingKey: f.key,
      podSessions: f.provider,
      consent: f.consent,
      now: f.now,
    });
    await worker.revokeGrant(grantId);
    await worker.revokeGrant(grantId);
    expect(await f.stores.grants.get(grantId)).toMatchObject({ revoked: true });
    expect(await f.stores.grants.isSessionRevoked(SESSION.id)).toBe(true);
    expect(f.provider.revoke).toHaveBeenCalledWith(SESSION.id);
    for (const revoked of [tokens, sibling]) {
      await expect(
        f.server.verifyAccessToken(revoked.access_token, RESOURCE),
      ).rejects.toMatchObject({
        error: "invalid_token",
      });
      expect(await (await f.refresh(clientId, revoked.refresh_token)).json()).toEqual({
        error: "invalid_grant",
      });
    }
    expect(await (await f.exchange(clientId, pendingCode)).json()).toEqual({
      error: "invalid_grant",
    });
    const completion = await f.server.authorize(f.authRequest(clientId), SESSION);
    expect(new URL(completion.headers.get("location") as string).searchParams.get("error")).toBe(
      "access_denied",
    );
    await expect(
      f.server.verifyAccessToken(unrelated.access_token, RESOURCE),
    ).resolves.toMatchObject({ sessionId: "other" });
    expect((await f.refresh(clientId, unrelated.refresh_token)).status).toBe(200);
  });

  it("propagates cleanup failures and retries an already revoked grant", async () => {
    const f = fixture();
    const clientId = await f.register();
    const tokens = await (await f.exchange(clientId, await f.code(clientId))).json();
    const { grantId } = await f.server.verifyAccessToken(tokens.access_token, RESOURCE);
    vi.mocked(f.provider.revoke).mockRejectedValueOnce(new Error("cleanup failed"));
    await expect(f.server.revokeGrant(grantId)).rejects.toThrow("cleanup failed");
    expect(await f.stores.grants.isSessionRevoked(SESSION.id)).toBe(true);
    await f.server.revokeGrant(grantId);
    expect(f.provider.revoke).toHaveBeenCalledTimes(2);
    await expect(f.server.verifyAccessToken(tokens.access_token, RESOURCE)).rejects.toMatchObject({
      error: "invalid_token",
    });
    expect(await (await f.refresh(clientId, tokens.refresh_token)).json()).toEqual({
      error: "invalid_grant",
    });
  });
});
