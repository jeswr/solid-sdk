// AUTHORED-BY Codex GPT-6.1-Sol
import { webcrypto } from "node:crypto";
import type { AccountManager } from "@jeswr/pod-auth/accounts";
import { createAccountManager } from "@jeswr/pod-auth/accounts";
import { type PodAuthSession, usePodAuth } from "@jeswr/pod-auth/react";
import { createMemoryStore, createMockOp } from "@jeswr/pod-auth/testing";
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import { AccountsProvider, type AccountsSession, useAccounts } from "./index.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
const managers: AccountManager[] = [];
let accounts: AccountsSession;
let session: PodAuthSession;
function Probe() {
  accounts = useAccounts();
  session = usePodAuth();
  return createElement("span", null, session.webId ?? "anonymous");
}
function fixture() {
  const alice = createMockOp({ refreshTokens: true });
  const bobRoot = "https://pod.example/bob/";
  const bob = createMockOp({
    issuer: "https://bob-op.example/",
    webId: "https://id.example/bob#me",
    subject: "https://id.example/bob",
    storages: [bobRoot],
    protectedUrls: [bobRoot],
    refreshTokens: true,
  });
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("ArrayBuffer", Buffer.alloc(0).buffer.constructor);
  vi.stubGlobal("location", { origin: "https://app.example" });
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    return (
      request.url.startsWith(bob.issuer) ||
      request.url.startsWith(bobRoot) ||
      request.url.startsWith("https://id.example/bob")
        ? bob
        : alice
    ).fetch(request);
  });
  const options = {
    clientId: alice.clientId,
    redirectUri: alice.redirectUri,
    storage: { sessions: createMemoryStore(), caches: createMemoryStore() },
    ui: {
      getWebId: async () => alice.webId!,
      getCode: (url: URL, signal: AbortSignal) =>
        (url.origin === new URL(bob.issuer).origin ? bob : alice).getCode(url, signal),
    },
  };
  const load = () => {
    const manager = createAccountManager(options);
    managers.push(manager);
    return manager;
  };
  return { alice, bob, bobRoot, load };
}
afterEach(async () => {
  if (root) await act(() => root!.unmount());
  root = undefined;
  document.body.replaceChildren();
  for (const manager of managers.splice(0)) manager.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function mount(manager: AccountManager) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(
      createElement(
        StrictMode,
        null,
        createElement(AccountsProvider, { manager }, createElement(Probe)),
      ),
    ),
  );
  return container;
}

test("useAccounts switches existing usePodAuth consumers to the actual active core without requests/navigation", async () => {
  const f = fixture();
  const manager = f.load();
  await manager.add({ webId: f.alice.webId });
  await manager.add({ webId: f.bob.webId });
  const container = await mount(manager);
  expect(container.textContent).toBe(f.bob.webId);
  const switchTo = accounts.switchTo;
  const oldFetch = session.fetch;
  const requests = f.alice.requests.length + f.bob.requests.length;
  await act(async () => accounts.switchTo(f.alice.webId!));
  expect(f.alice.requests.length + f.bob.requests.length).toBe(requests);
  expect(container.textContent).toBe(f.alice.webId);
  expect(accounts.active?.webId).toBe(f.alice.webId);
  expect(session.auth).toBe(manager.authFor(f.alice.webId!));
  expect(session.fetch).toBe(manager.fetchFor(f.alice.webId!));
  expect(session.fetch).not.toBe(oldFetch);
  expect(accounts.switchTo).toBe(switchTo);
  expect((await session.fetch(f.alice.root + "private")).status).toBe(200);
  await act(async () => accounts.add({ webId: f.alice.webId }));
  expect(session.fetch).toBe(manager.fetchFor(f.alice.webId!));
  await act(async () => accounts.remove(f.alice.webId!));
  expect(container.textContent).toBe(f.bob.webId);
  await act(async () => accounts.remove(f.bob.webId!));
  expect(container.textContent).toBe("anonymous");
  expect(accounts.accounts).toEqual([]);
  expect(accounts.active).toBeNull();
  expect(session.status).toBe("unauthenticated");
});

test("empty provider supports login, manager replacement, server rendering and subscription cleanup", async () => {
  const f = fixture();
  const manager = f.load();
  const container = await mount(manager);
  expect(container.textContent).toBe("anonymous");
  await act(async () => session.login({ webId: f.alice.webId }));
  expect(container.textContent).toBe(f.alice.webId);
  const next = f.load();
  await next.add({ webId: f.bob.webId });
  await act(async () =>
    root!.render(createElement(AccountsProvider, { manager: next }, createElement(Probe))),
  );
  expect(container.textContent).toBe(f.bob.webId);
  await act(async () => manager.switchTo(f.alice.webId!));
  expect(container.textContent).toBe(f.bob.webId);
  expect(
    renderToString(createElement(AccountsProvider, { manager: next }, createElement(Probe))),
  ).toContain("anonymous");
  await act(async () => root!.unmount());
  root = undefined;
  await next.switchTo(f.bob.webId!);
});

test("useAccounts outside its provider gives a targeted error", () => {
  expect(() => renderToString(createElement(Probe))).toThrow("inside an <AccountsProvider>");
});
