// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare module specifiers
import { inspect } from "util";
import { describe, expect, it, vi } from "vitest";
import {
  AgentVault,
  LocalEncryptedBackend,
  type LoginRequest,
  PermissionPolicy,
  Secret,
  type SecretBackend,
  type SessionBundle,
  type VaultOptions,
} from "../src/index.js";
import {
  account,
  capture,
  cookie,
  deferred,
  login,
  NOW,
  PASSWORD,
  SITE,
  setup,
} from "./helpers.js";

async function fixture(method = "password") {
  const base = setup();
  await account(base.profiles, "alex", "personal", method);
  const read = vi.fn(async () => login());
  const totp = vi.fn(async () => new Secret("123456"));
  const save = vi.fn(async () => ({ backend: "fake", ref: "saved", profile: "personal" }));
  const backend: SecretBackend = {
    id: "fake",
    find: vi.fn(async () => [{ backend: "fake", ref: "item", profile: "personal" }]),
    read,
    save,
    totp,
  };
  const ask = vi.fn(async () => "once" as const);
  const permissions = new PermissionPolicy(base.store, { ask });
  const passwordLogin = vi.fn<VaultOptions["passwordLogin"]>(async () => capture());
  const interactiveLogin = vi.fn<VaultOptions["interactiveLogin"]>(async () => capture());
  const options: VaultOptions = {
    ...base,
    permissions,
    backends: [backend],
    passwordLogin,
    interactiveLogin,
    now: () => NOW,
  };
  return { ...base, backend, ask, read, save, totp, passwordLogin, interactiveLogin, options };
}
describe("ensureSession host orchestration", () => {
  it.each([
    "password",
    "passkey",
    "magic-link",
    "otp",
  ])("superseded %s callbacks cannot read or overwrite a newer login", async (method) => {
    const f = await fixture(method);
    const entered = deferred<void>();
    const release = deferred<void>();
    let newest: SessionBundle | undefined;
    let read: SessionBundle | undefined;
    let update: unknown;
    const callback = async (request: LoginRequest) => {
      entered.resolve();
      await release.promise;
      read = await request.sessions.get(SITE, "alex");
      // Even possession of the newer revision must not let the old transaction write.
      update = await request.sessions.update(SITE, "alex", {
        ...(read ?? newest),
        cookies: [{ ...cookie(), value: "superseded-login" }],
      });
      return capture();
    };
    const outcome = new AgentVault({
      ...f.options,
      passwordLogin: async (request) => {
        await callback(request);
      },
      interactiveLogin: callback,
    })
      .ensureSession(SITE)
      .then(
        () => "accepted",
        () => "refused",
      );
    await entered.promise;
    await new AgentVault(f.options).ensureSession(SITE);
    newest = await f.sessions.get(SITE, "alex");
    const before = await (await f.sessions.state(SITE, "alex"))?.use((s) => s);
    const writes = vi.spyOn(f.store, "putPrivateRecord");
    release.resolve();
    expect(await outcome).toBe("refused");
    expect((await f.sessions.get(SITE, "alex"))?.cookies[0]?.value).toBe(cookie().value);
    expect(read).toBeUndefined();
    expect(update).toEqual({ accepted: false });
    expect(writes).not.toHaveBeenCalled();
    expect(await (await f.sessions.state(SITE, "alex"))?.use((s) => s)).toEqual(before);
  });
  it.each([
    "password",
    "passkey",
  ])("refuses a pending %s capture revoked before callback completion", async (method) => {
    const f = await fixture(method);
    const entered = deferred<void>();
    const release = deferred<void>();
    const callback = async () => {
      entered.resolve();
      await release.promise;
      return capture();
    };
    const vault = new AgentVault({
      ...f.options,
      passwordLogin: callback,
      interactiveLogin: callback,
    });
    const outcome = vault.ensureSession(SITE).then(
      () => "accepted",
      () => "refused",
    );
    await entered.promise;
    await f.sessions.stale(SITE, "alex");
    release.resolve();
    expect(await outcome).toBe("refused");
    expect(await f.sessions.get(SITE, "alex")).toBeUndefined();
  });
  it.each([
    "capture",
    "failure",
    "void",
  ] as const)("old login %s completion cannot overwrite or revoke a newer login", async (completion) => {
    const f = await fixture();
    const entered = deferred<void>();
    const release = deferred<void>();
    const waitForLogin = async () => {
      entered.resolve();
      await release.promise;
    };
    const passwordLogin: VaultOptions["passwordLogin"] =
      completion === "void"
        ? waitForLogin
        : async () => {
            await waitForLogin();
            if (completion === "failure") throw new Error(PASSWORD);
            return capture();
          };
    const outcome = new AgentVault({ ...f.options, passwordLogin }).ensureSession(SITE).then(
      () => "accepted",
      () => "refused",
    );
    await entered.promise;
    await f.sessions.store({
      site: SITE,
      account: "alex",
      bundle: { cookies: [{ ...cookie(), value: "new-login" }] },
      capturedAt: NOW,
      stale: false,
    });
    const before = await (await f.sessions.state(SITE, "alex"))?.use((s) => s);
    const writes = vi.spyOn(f.store, "putPrivateRecord");
    release.resolve();
    expect(await outcome).toBe("refused");
    expect(writes).not.toHaveBeenCalled();
    expect(await (await f.sessions.state(SITE, "alex"))?.use((s) => s)).toEqual(before);
    expect((await f.sessions.get(SITE, "alex"))?.cookies[0]?.value).toBe("new-login");
  });
  it("does not reuse an empty login transaction as an authenticated session", async () => {
    const f = await fixture();
    await f.sessions.beginLogin(SITE, "alex");
    await new AgentVault(f.options).ensureSession(SITE);
    expect(f.passwordLogin).toHaveBeenCalledTimes(1);
  });
  it("reads only after consent, logs in once, then reuses the encrypted session", async () => {
    const f = await fixture();
    const vault = new AgentVault(f.options);
    const a = await vault.ensureSession(SITE);
    expect(a).toHaveProperty("session");
    expect(f.ask).toHaveBeenCalledWith({
      site: SITE,
      account: "alex",
      backend: "fake",
      purpose: "login",
    });
    expect(f.read).toHaveBeenCalledWith("item", "login");
    await vault.ensureSession(SITE);
    expect(f.passwordLogin).toHaveBeenCalledTimes(1);
    expect(f.read).toHaveBeenCalledTimes(1);
    expect(inspect(a)).not.toContain(PASSWORD);
    expect(JSON.stringify(a)).not.toContain(PASSWORD);
  });
  it("asks for ambiguous persona before accessing a backend", async () => {
    const f = await fixture();
    await account(f.profiles, "business", "work");
    const vault = new AgentVault(f.options);
    expect(await vault.ensureSession(SITE)).toHaveProperty("ask");
    expect(f.backend.find).not.toHaveBeenCalled();
    await vault.ensureSession(SITE, { profileHint: "personal" });
    expect(f.read).toHaveBeenCalledTimes(1);
  });
  it("persists denial and never reads a denied secret", async () => {
    const f = await fixture();
    const ask = vi.fn(async () => "never" as const);
    const vault = new AgentVault({
      ...f.options,
      permissions: new PermissionPolicy(f.store, { ask }),
    });
    await expect(vault.ensureSession(SITE)).rejects.toThrow("Vault denied");
    await expect(vault.ensureSession(SITE)).rejects.toThrow("Vault denied");
    expect(ask).toHaveBeenCalledTimes(1);
    expect(f.read).not.toHaveBeenCalled();
    expect(f.passwordLogin).not.toHaveBeenCalled();
  });
  it.each([
    "passkey",
    "magic-link",
    "sso:identity",
  ])("captures interactive %s without password access", async (method) => {
    const f = await fixture(method === "sso:identity" ? "passkey" : method);
    if (method === "sso:identity") {
      await f.profiles.putAccount({
        id: "provider",
        site: "https://identity.test",
        profile: "personal",
        label: "Alex Example",
      });
      await f.profiles.putRoute({
        site: SITE,
        account: "alex",
        profile: "personal",
        method,
        provider: "identity",
        providerAccount: "provider",
      });
    }
    expect(await new AgentVault(f.options).ensureSession(SITE)).toHaveProperty("session");
    expect(f.interactiveLogin).toHaveBeenCalledTimes(1);
    expect(f.read).not.toHaveBeenCalled();
  });
  it("obtains backend OTP through a separate permission", async () => {
    const f = await fixture("otp");
    await new AgentVault(f.options).ensureSession(SITE);
    expect(f.ask).toHaveBeenCalledWith({
      site: SITE,
      account: "alex",
      backend: "fake",
      purpose: "totp",
    });
    expect(f.totp).toHaveBeenCalledTimes(1);
    expect(f.read).not.toHaveBeenCalled();
  });
  it("supports a password login OTP challenge and injected person OTP", async () => {
    const f = await fixture();
    const askOtp = vi.fn(async () => new Secret("654321"));
    const passwordLogin: VaultOptions["passwordLogin"] = async (r) => {
      expect(await (await r.otp()).use((c) => c === "654321")).toBe(true);
      return capture();
    };
    await new AgentVault({ ...f.options, passwordLogin, askOtp }).ensureSession(SITE, {
      credentials: login(),
    });
    expect(askOtp).toHaveBeenCalledTimes(1);
    expect(f.read).not.toHaveBeenCalled();
  });
  it("offers saving only person-supplied credentials, after success, with save permission", async () => {
    const f = await fixture();
    const backend = new LocalEncryptedBackend({ store: f.store, profile: "personal" });
    const offerSave = vi.fn(async () => ({ backend: backend.id }));
    const options = { ...f.options, backends: [backend], offerSave };
    const result = await new AgentVault(options).ensureSession(SITE, { credentials: login() });
    expect(result).toHaveProperty("session");
    expect(offerSave).toHaveBeenCalledTimes(1);
    expect(f.ask).toHaveBeenCalledWith({
      site: SITE,
      account: "alex",
      backend: backend.id,
      purpose: "save",
    });
    const saved = f.profiles.accounts(SITE)[0];
    expect(saved?.backend).toBe(backend.id);
    expect(saved?.item).toBe((await backend.find(SITE))[0]?.ref);
  });
  it("rejects multiple credential matches or wrong profiles without reading", async () => {
    const f = await fixture();
    f.backend.find = async () => [
      { backend: "fake", ref: "one", profile: "personal" },
      { backend: "fake", ref: "two", profile: "personal" },
    ];
    await expect(new AgentVault(f.options).ensureSession(SITE)).rejects.toThrow("Vault ambiguous");
    expect(f.read).not.toHaveBeenCalled();
    f.backend.find = async () => [{ backend: "fake", ref: "one", profile: "work" }];
    await expect(new AgentVault(f.options).ensureSession(SITE)).rejects.toThrow("Vault missing");
  });
  it("uses an explicitly bound item and filters other backend matches", async () => {
    const f = await fixture();
    const bound = f.profiles.accounts(SITE)[0];
    if (!bound) throw new Error("Missing fixture account");
    await f.profiles.putAccount({
      ...bound,
      backend: "fake",
      item: "chosen",
    });
    f.backend.find = async () => [
      { backend: "fake", ref: "other", profile: "personal" },
      { backend: "fake", ref: "chosen", profile: "personal" },
    ];
    await new AgentVault(f.options).ensureSession(SITE);
    expect(f.read).toHaveBeenCalledWith("chosen", "login");
  });
  it("accepts a callback that writes through executor SessionProvider and returns void", async () => {
    const f = await fixture();
    const passwordLogin: VaultOptions["passwordLogin"] = async (r) => {
      const initial = await r.sessions.get(SITE, "alex");
      const tracking = { ...cookie(), name: "tracking", value: "tracking" };
      const first = await r.sessions.update(SITE, "alex", { ...initial, cookies: [tracking] });
      expect(first).toEqual({ accepted: true, revision: expect.any(String) });
      const second = await r.sessions.update(SITE, "alex", {
        revision: first.revision,
        cookies: [cookie()],
      });
      expect(second).toEqual({ accepted: true, revision: expect.any(String) });
      expect(second.revision).not.toBe(first.revision);
    };
    expect(
      await new AgentVault({ ...f.options, passwordLogin }).ensureSession(SITE),
    ).toHaveProperty("session");
  });
  it("deduplicates concurrent logins and sanitises callback failures", async () => {
    const f = await fixture();
    const vault = new AgentVault(f.options);
    await Promise.all([vault.ensureSession(SITE), vault.ensureSession(SITE)]);
    expect(f.passwordLogin).toHaveBeenCalledTimes(1);
    await f.sessions.stale(SITE, "alex");
    f.passwordLogin.mockRejectedValue(new Error(PASSWORD));
    const error = await vault.ensureSession(SITE).catch((e) => e);
    expect(inspect(error, { showHidden: true })).not.toContain(PASSWORD);
    expect(error.message).toBe("Vault unavailable.");
    expect(await f.sessions.get(SITE, "alex")).toBeUndefined();
  });
});

it("a denied optional save leaves the successful password session active", async () => {
  const f = await fixture();
  const backend = new LocalEncryptedBackend({ store: f.store, profile: "personal" });
  const vault = new AgentVault({
    ...f.options,
    backends: [backend],
    offerSave: async () => ({ backend: backend.id }),
    permissions: new PermissionPolicy(f.store, { ask: async () => "never" }),
  });
  expect(await vault.ensureSession(SITE, { credentials: login() })).toMatchObject({
    save: "denied",
  });
  expect(await f.sessions.get(SITE, "alex")).toBeDefined();
  expect(await backend.find(SITE)).toEqual([]);
});
it("rejects a cross-profile save destination before writing", async () => {
  const f = await fixture();
  const save = vi.fn();
  const backend: SecretBackend = {
    ...f.backend,
    profiles: ["personal", "work"],
    profileFor: () => "work",
    save,
  };
  const vault = new AgentVault({
    ...f.options,
    backends: [backend],
    offerSave: async () => ({ backend: backend.id, ref: "business/new" }),
  });
  expect(await vault.ensureSession(SITE, { credentials: login() })).toMatchObject({
    save: "failed",
  });
  expect(save).not.toHaveBeenCalled();
  expect(await f.sessions.get(SITE, "alex")).toBeDefined();
});
it("re-login through executor updates replaces stale token metadata", async () => {
  const f = await fixture();
  await f.sessions.store({
    site: SITE,
    account: "alex",
    bundle: { cookies: [] },
    tokens: { access: "expired", refresh: "old-refresh", expiresAt: NOW - 1000 },
    capturedAt: NOW - 10000,
    stale: true,
  });
  const passwordLogin: VaultOptions["passwordLogin"] = async (r) => {
    await capture().use(async (c) =>
      r.sessions.update(SITE, "alex", {
        ...(await r.sessions.get(SITE, "alex")),
        cookies: c.cookies,
      }),
    );
  };
  expect(await new AgentVault({ ...f.options, passwordLogin }).ensureSession(SITE)).toHaveProperty(
    "session",
  );
  expect(await (await f.sessions.state(SITE, "alex"))?.use((s) => s.tokens)).toBeUndefined();
});
it("uses the person OTP asker when no backend item exists", async () => {
  const f = await fixture("otp");
  const askOtp = vi.fn(async () => new Secret("123456"));
  const result = await new AgentVault({ ...f.options, backends: [], askOtp }).ensureSession(SITE);
  expect(result).toHaveProperty("session");
  expect(askOtp).toHaveBeenCalledTimes(1);
  expect(f.read).not.toHaveBeenCalled();
});
it("re-authenticates when the named session cookie expired but an unrelated cookie remains", async () => {
  const f = await fixture();
  await f.profiles.putRoute({
    site: SITE,
    account: "alex",
    profile: "personal",
    method: "password",
    sessionCookies: ["sid"],
  });
  await f.sessions.beginLogin(SITE, "alex");
  await capture().use(async (c) =>
    f.sessions.update(SITE, "alex", {
      ...(await f.sessions.get(SITE, "alex")),
      cookies: [
        { ...(c.cookies[0] as (typeof c.cookies)[number]), expires: 0 },
        { ...(c.cookies[0] as (typeof c.cookies)[number]), name: "analytics" },
      ],
    }),
  );
  await new AgentVault(f.options).ensureSession(SITE);
  expect(f.passwordLogin).toHaveBeenCalledTimes(1);
});
it("requires origin agreement or the selected backend's explicit origin rule", async () => {
  const f = await fixture();
  const credentialSite = "https://sub.shop.test";
  f.read.mockImplementation(async () =>
    login().use((c) => new Secret({ ...c, site: credentialSite })),
  );
  await expect(new AgentVault(f.options).ensureSession(SITE)).rejects.toThrow("Vault invalid");
  expect(f.passwordLogin).not.toHaveBeenCalled();
  f.backend.allowsOrigin = (site, candidate) => site === SITE && candidate === credentialSite;
  expect(await new AgentVault(f.options).ensureSession(SITE)).toHaveProperty("session");
});
