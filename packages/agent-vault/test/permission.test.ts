// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { describe, expect, it, vi } from "vitest";
import { PermissionPolicy, type PermissionRequest } from "../src/index.js";
import { deferred, SITE, setup } from "./helpers.js";

const r: PermissionRequest = { site: SITE, account: "alex", backend: "local", purpose: "login" };
describe("permission persistence and revocation", () => {
  it.each([
    "once",
    "always-for-site",
  ] as const)("never invalidates a pending %s approval across policy instances", async (answer) => {
    const { store } = setup();
    const prompt = deferred<typeof answer>();
    const asked = deferred<void>();
    const pending = new PermissionPolicy(store, {
      ask: () => {
        asked.resolve();
        return prompt.promise;
      },
    }).check(r, "x");
    const denied = expect(pending).rejects.toThrow("Vault denied");
    await asked.promise;
    const policy = new PermissionPolicy(store, { ask: async () => "never" });
    await expect(policy.check(r, "x")).rejects.toThrow("Vault denied");
    prompt.resolve(answer);
    await denied;
    const ask = vi.fn(async () => "always-for-site" as const);
    await expect(new PermissionPolicy(store, { ask }).check(r, "x")).rejects.toThrow(
      "Vault denied",
    );
    expect(ask).not.toHaveBeenCalled();
  });
  it.each([
    "once",
    "always-for-site",
  ] as const)("revocation invalidates a pending %s approval even after a fresh grant", async (answer) => {
    const { store } = setup();
    const prompt = deferred<typeof answer>();
    const asked = deferred<void>();
    const pending = new PermissionPolicy(store, {
      ask: () => {
        asked.resolve();
        return prompt.promise;
      },
    }).check(r, "x");
    const denied = expect(pending).rejects.toThrow("Vault denied");
    await asked.promise;
    const policy = new PermissionPolicy(store, { ask: async () => "always-for-site" });
    await policy.revoke(r, "x");
    await policy.check(r, "x");
    prompt.resolve(answer);
    await denied;
  });
  it("a late never wins over a newer persistent approval", async () => {
    const { store } = setup();
    const prompt = deferred<"never">();
    const asked = deferred<void>();
    const pending = new PermissionPolicy(store, {
      ask: () => {
        asked.resolve();
        return prompt.promise;
      },
    }).check(r, "x");
    const denied = expect(pending).rejects.toThrow("Vault denied");
    await asked.promise;
    const ask = vi.fn(async () => "always-for-site" as const);
    const policy = new PermissionPolicy(store, { ask });
    await policy.check(r, "x");
    prompt.resolve("never");
    await denied;
    await expect(policy.check(r, "x")).rejects.toThrow("Vault denied");
    expect(ask).toHaveBeenCalledTimes(1);
  });
  it("once prompts each time; always persists per backend/item/site/account/purpose", async () => {
    const { store } = setup();
    const ask = vi.fn(async () => "once" as const);
    const p = new PermissionPolicy(store, { ask });
    await p.check(r, "one");
    await p.check(r, "one");
    expect(ask).toHaveBeenCalledTimes(2);
    const always = vi.fn(async () => "always-for-site" as const);
    const a = new PermissionPolicy(store, { ask: always });
    await a.check(r, "one");
    await new PermissionPolicy(store, { ask }).check(r, "one");
    expect(ask).toHaveBeenCalledTimes(2);
    for (const [request, item] of [
      [{ ...r, purpose: "totp" }, "one"],
      [r, "two"],
      [{ ...r, site: "https://other.test" }, "one"],
      [{ ...r, account: "business" }, "one"],
      [{ ...r, backend: "other" }, "one"],
    ] as [PermissionRequest, string][])
      await a.check(request, item);
    expect(always).toHaveBeenCalledTimes(6);
    await a.revoke(r, "one");
    await p.check(r, "one");
    expect(ask).toHaveBeenCalledTimes(3);
  });
  it("never persists across restarts and revocation permits a fresh decision", async () => {
    const { store } = setup();
    const no = vi.fn(async () => "never" as const);
    const p = new PermissionPolicy(store, { ask: no });
    await expect(p.check(r, "x")).rejects.toThrow("Vault denied");
    await expect(new PermissionPolicy(store, { ask: no }).check(r, "x")).rejects.toThrow(
      "Vault denied",
    );
    expect(no).toHaveBeenCalledTimes(1);
    await p.revoke(r, "x");
    await expect(p.check(r, "x")).rejects.toThrow();
    expect(no).toHaveBeenCalledTimes(2);
  });
  it("refuses invalid answers and sanitises prompt failures", async () => {
    const { store } = setup();
    await expect(
      new PermissionPolicy(store, { ask: async () => "yes" as never }).check(r, "x"),
    ).rejects.toThrow("Vault denied");
    await expect(
      new PermissionPolicy(store, {
        ask: async () => {
          throw new Error("secret");
        },
      }).check(r, "x"),
    ).rejects.toThrow("Vault unavailable");
  });
});
