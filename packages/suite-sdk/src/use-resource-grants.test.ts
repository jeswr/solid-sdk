// AUTHORED-BY Claude Opus 5.5
import { webcrypto } from "node:crypto";
import type { ResourceGrant } from "@jeswr/pod-auth";
import type { AccountManager } from "@jeswr/pod-auth/accounts";
import { createAccountManager } from "@jeswr/pod-auth/accounts";
import { createMemoryStore, createMockOp } from "@jeswr/pod-auth/testing";
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import {
  AccountsProvider,
  type AccountsSession,
  ResourceGrantError,
  type ResourceGrants,
  useAccounts,
  useResourceGrants,
} from "./index.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
const managers: AccountManager[] = [];
let accounts: AccountsSession;
let grants: ResourceGrants;
const renders: (readonly ResourceGrant[])[] = [];
function Probe() {
  accounts = useAccounts();
  grants = useResourceGrants();
  renders.push(grants.grants);
  return createElement("span", null, grants.grants.map((g) => g.root).join(","));
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

const shared = "https://carol.example/rooms/1/";

test("useResourceGrants follows the active account and its grant, revoke and scope actions", async () => {
  const f = fixture();
  const manager = f.load();
  await manager.add({ webId: f.alice.webId });
  await manager.add({ webId: f.bob.webId });
  await manager.switchTo(f.alice.webId!);
  const container = await mount(manager);
  expect(grants.supported).toBe(true);
  expect(grants.grants).toEqual([]);
  let grant!: ResourceGrant;
  await act(async () => {
    grant = await grants.grant(shared);
  });
  expect(grant.root).toBe(shared);
  expect(container.textContent).toBe(shared);
  expect(grants.isWithinGrantedScope(`${shared}messages.ttl`)).toBe(true);
  expect(grants.isWithinGrantedScope("https://carol.example/rooms/2/")).toBe(false);
  // Bob's core has its own (empty) grants; Alice's return when she is active again.
  await act(async () => accounts.switchTo(f.bob.webId!));
  expect(grants.grants).toEqual([]);
  expect(grants.isWithinGrantedScope(`${shared}messages.ttl`)).toBe(false);
  await act(async () => accounts.switchTo(f.alice.webId!));
  expect(grants.grants).toEqual([grant]);
  const stable = grants.grants;
  await act(async () => accounts.switchTo(f.alice.webId!));
  expect(grants.grants).toBe(stable);
  await act(async () => {
    expect(grants.revoke(grant)).toBe(true);
  });
  expect(grants.grants).toEqual([]);
  expect(container.textContent).toBe("");
  expect(grants.revoke(shared)).toBe(false);
  await act(async () => {
    await grants.grant(shared);
  });
  // Removing the account logs it out, which ends its grants.
  await act(async () => accounts.remove(f.alice.webId!));
  await act(async () => accounts.remove(f.bob.webId!));
  expect(grants.supported).toBe(false);
  expect(grants.grants).toEqual([]);
  expect(grants.revoke(shared)).toBe(false);
  expect(grants.isWithinGrantedScope(`${shared}x`)).toBe(false);
  await expect(grants.grant(shared)).rejects.toBeInstanceOf(ResourceGrantError);
});
