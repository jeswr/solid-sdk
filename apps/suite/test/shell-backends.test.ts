// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACCOUNTS_KEY } from "../src/shell/lib/accounts-store";
import { DemoBackend, demoAccount } from "../src/shell/session/demo-backend";
import { SolidBackend } from "../src/shell/session/solid-backend";

afterEach(() => vi.unstubAllGlobals());
describe("session backend seam", () => {
  it.each([
    "notaurl",
    "javascript:alert(1)",
    "file:///tmp/profile",
    "https://user:pass@example.org/",
  ])("rejects invalid discovery URL %s", async (issuer) => {
    await expect(new SolidBackend().signIn({ issuer })).rejects.toMatchObject({
      code: "invalid-url",
      message: "We couldn't find a sign-in service at that address",
    });
  });
  it("defers authentication until mounted in a browser", async () => {
    const backend = new SolidBackend();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(backend.signIn({ webId: "https://example.org/profile#me" })).rejects.toMatchObject(
      {
        code: "unavailable",
      },
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(await backend.restore()).toBeNull();
    expect(backend.kind).toBe("solid");
    backend.onExpired(() => {})();
  });
  it("signs into demo instantly and restores only its active pointer", async () => {
    const backend = new DemoBackend();
    expect(await backend.signIn()).toEqual(demoAccount);
    expect(await backend.restore()).toBeNull();
    const getItem = vi.fn(() => JSON.stringify({ accounts: [demoAccount], activeId: "demo" }));
    vi.stubGlobal("localStorage", { getItem });
    expect(await backend.restore()).toEqual(demoAccount);
    expect(getItem).toHaveBeenCalledWith(ACCOUNTS_KEY);
    getItem.mockReturnValue(JSON.stringify({ accounts: [demoAccount], activeId: null }));
    expect(await backend.restore()).toBeNull();
    expect(backend.kind).toBe("demo");
    const response = await backend.fetchFor()(demoAccount.webId);
    expect(response.status).toBe(200);
    await backend.signOut();
    backend.onExpired()();
  });
});
