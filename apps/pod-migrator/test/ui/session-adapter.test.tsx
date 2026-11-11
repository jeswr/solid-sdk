// AUTHORED-BY GPT-6.1 Sol
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { clearLegacyCredentials, IssuerChoiceRequiredError } from "@jeswr/app-session";
import { deferred, fakePodAuth, identity } from "@jeswr/app-session/testing";
import { createPodAuth } from "@jeswr/pod-auth";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/App.js";
import { createConnections } from "../../src/auth/connections.js";
import { legacyCredentials, serializeLogins } from "../../src/auth/pod-auth.js";
import {
  connectionFor,
  fakeAuth,
  fakeConnections,
  sourceRoot,
  sourceWebId,
  targetRoot,
} from "./fixtures.js";

vi.mock("@jeswr/pod-auth", async (original) => ({
  ...(await original<typeof import("@jeswr/pod-auth")>()),
  createPodAuth: vi.fn(),
}));
vi.mock("@jeswr/reactive-authentication/registerElements", () => ({}));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("two app-session cores", () => {
  it("uses distinct redirect namespaces under the Pages base, with the automatic boundary and pristine global fetch", async () => {
    vi.stubEnv("DEV", false);
    vi.mocked(createPodAuth).mockImplementation(() => fakePodAuth().auth);
    const originalFetch = globalThis.fetch;
    const connections = createConnections("https://jeswr.github.io", "/solid-sdk/pod-migrator/");
    const [source, target] = await Promise.all(
      connections.map((connection) => connection.getPodAuth()),
    );
    expect(source).not.toBe(target);
    const configs = vi.mocked(createPodAuth).mock.calls.map(([config]) => config);
    expect(configs).toHaveLength(2);
    const namespaces = configs.map((config) =>
      JSON.stringify([config.clientId, config.redirectUri]),
    );
    expect(new Set(namespaces).size).toBe(2);
    for (const [index, id] of ["source", "target"].entries()) {
      expect(configs[index]).toMatchObject({
        clientId: "https://jeswr.github.io/solid-sdk/pod-migrator/clientid.jsonld",
        redirectUri: `https://jeswr.github.io/solid-sdk/pod-migrator/callback/${id}/`,
        allowInsecureLoopback: false,
      });
      expect(configs[index]?.boundary).toBeUndefined();
    }
    expect(globalThis.fetch).toBe(originalFetch);
    expect(await connections[0].getPodAuth()).toBe(source);
    expect(createPodAuth).toHaveBeenCalledTimes(2);
  });

  it.each([true, false])("enables dynamic loopback registration only in dev (%s)", async (dev) => {
    vi.stubEnv("DEV", dev);
    vi.mocked(createPodAuth).mockImplementation(() => fakePodAuth().auth);
    await createConnections(location.origin)[0].getPodAuth();
    const config = vi.mocked(createPodAuth).mock.calls[0]?.[0];
    expect(config?.allowInsecureLoopback).toBe(dev);
    expect(config?.clientId).toEqual(
      dev ? { dynamicRegistration: true } : `${location.origin}/clientid.jsonld`,
    );
  });

  it("rejects concurrent logins before a second popup and releases the holder after cancellation", async () => {
    const first = fakePodAuth();
    const second = fakePodAuth();
    const cancelled = deferred<typeof identity>();
    first.auth.login.mockImplementation(async (_hint, options) => {
      options?.signal?.addEventListener("abort", () => cancelled.reject(options.signal?.reason), {
        once: true,
      });
      return cancelled.promise;
    });
    const source = await serializeLogins(async () => first.auth)();
    const target = await serializeLogins(async () => second.auth)();
    const controller = new AbortController();
    const pending = source.login({ issuer: identity.issuer }, { signal: controller.signal });
    await expect(target.login({ issuer: identity.issuer })).rejects.toThrow("other pod");
    expect(second.auth.login).not.toHaveBeenCalled();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(first.auth.logout).not.toHaveBeenCalled();
    expect(second.auth.logout).not.toHaveBeenCalled();
    await target.login({ issuer: identity.issuer });
    expect(second.auth.login).toHaveBeenCalledOnce();
  });

  it("restores each side once in StrictMode and signing out of source leaves target connected", async () => {
    const connections = fakeConnections();
    const source = await connections[0].getPodAuth();
    const target = await connections[1].getPodAuth();
    render(
      <StrictMode>
        <App connections={connections} />
      </StrictMode>,
    );
    await waitFor(() => {
      expect(connections[0].snapshot().root).toBe(sourceRoot);
      expect(connections[1].snapshot().root).toBe(targetRoot);
    });
    expect(source.restore).toHaveBeenCalledOnce();
    expect(target.restore).toHaveBeenCalledOnce();
    await act(() => connections[0].logout());
    await waitFor(() => expect(connections[0].snapshot().webId).toBeNull());
    expect(connections[1].snapshot()).toMatchObject({ status: "connected", root: targetRoot });
    expect((await target.identity())?.webId).toBeTruthy();
    expect(source.logout).toHaveBeenCalledOnce();
    expect(target.logout).not.toHaveBeenCalled();
  });

  it("uses the shared remembered-account card and retains the WebID for explicit issuer choice", async () => {
    const auth = fakeAuth(null);
    auth.remembered.mockResolvedValue([{ webId: sourceWebId, issuer: identity.issuer }]);
    auth.login.mockRejectedValueOnce(
      new IssuerChoiceRequiredError(["https://one.example/", "https://two.example/"]),
    );
    const connections = [connectionFor("source", auth), fakeConnections()[1]] as const;
    render(<App connections={connections} />);
    const source = within(screen.getByRole("region", { name: "source connection" }));
    fireEvent.click(await source.findByRole("button", { name: /source.example/ }));
    expect(await source.findByText("Choose the provider for source.example")).toBeVisible();
    fireEvent.click(source.getByRole("button", { name: /one.example/ }));
    await waitFor(() =>
      expect(auth.login).toHaveBeenLastCalledWith(
        { webId: sourceWebId, issuer: "https://one.example/" },
        { signal: expect.any(AbortSignal) },
      ),
    );
    await waitFor(() => expect(connections[0].snapshot().root).toBe(sourceRoot));
  });
});

it("clears exactly the old app's stores, preserving other apps, migration reports and themes", () => {
  const deletion = vi.fn();
  vi.stubGlobal("indexedDB", { deleteDatabase: deletion });
  for (const keys of Object.values(legacyCredentials)) {
    for (const key of keys.localStorage ?? []) localStorage.setItem(key, "obsolete");
    for (const key of keys.sessionStorage ?? []) sessionStorage.setItem(key, "obsolete");
  }
  for (const storage of [localStorage, sessionStorage]) {
    storage.setItem("pod-docs:keep", "other app");
    storage.setItem("pod-migrator:app-shell-theme", "dark");
    storage.setItem("pod-migrator:run-report:v1", "report");
    storage.setItem("pod-migrator:swapped:v1", "true");
  }
  for (const keys of Object.values(legacyCredentials)) clearLegacyCredentials(keys);
  expect(deletion.mock.calls).toEqual([
    ["pod-migrator:source:sessions"],
    ["pod-migrator:target:sessions"],
  ]);
  for (const storage of [localStorage, sessionStorage]) {
    expect(storage.length).toBe(4);
    expect(storage.getItem("pod-docs:keep")).toBe("other app");
    expect(storage.getItem("pod-migrator:run-report:v1")).toBe("report");
  }
});
