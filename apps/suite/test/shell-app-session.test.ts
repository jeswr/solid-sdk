// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { afterEach, expect, it, vi } from "vitest";
import { PodSessionProvider, usePodSessionState } from "../src/lib/session/pod-session";
import { AccountsContext } from "../src/shell/session/accounts-context";
import type { AccountsContextValue } from "../src/shell/session/accounts-provider";
import type { SuiteAccount } from "../src/shell/session/types";
import { act, deferred, h, mount } from "./drive-ui-dom";

vi.mock("../src/lib/demo-pod/browser", () => ({
  getDemoPod: vi.fn(() => {
    throw new Error("A Solid account must never open the demo pod");
  }),
  resetDemoPod: vi.fn(),
}));

const alice: SuiteAccount = {
  id: "solid:alice",
  kind: "solid",
  name: "Alice",
  webId: "https://pod.example/alice/#me",
  storageUrl: "https://pod.example/alice/",
  issuer: "https://id.example/",
};
function accounts(active: SuiteAccount | null = alice): AccountsContextValue {
  return {
    active,
    accounts: active ? [active] : [],
    status: active ? "ready" : "signed-out",
    fetch: vi.fn(async () => new Response("private pod data")),
    signIn: vi.fn(),
    signInDemo: vi.fn(),
    signInWith: vi.fn(),
    add: vi.fn(),
    switchTo: vi.fn(),
    signOut: vi.fn(),
    signOutAll: vi.fn(),
    reauth: vi.fn(),
    backendKinds: ["solid"],
  };
}
let state: ReturnType<typeof usePodSessionState>;
function Probe() {
  state = usePodSessionState();
  return null;
}
const tree = (value: AccountsContextValue) =>
  h(AccountsContext, { value }, h(PodSessionProvider, null, h(Probe)));
function session() {
  if (state.status !== "ready") throw new Error("Expected the shell account's pod session");
  return state.session;
}
afterEach(() => vi.restoreAllMocks());

it("uses the authenticated account and bounded fetch, with credential-free public reads", async () => {
  const value = accounts();
  await mount(tree(value));
  const pod = session();
  expect(pod).toMatchObject({
    mode: "solid",
    webId: alice.webId,
    displayName: "Alice",
    storageUrl: alice.storageUrl,
  });
  expect(await (await pod.fetch(`${alice.storageUrl}private`)).text()).toBe("private pod data");
  expect(value.fetch).toHaveBeenCalledWith(`${alice.storageUrl}private`, undefined);
  const transport = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("public"));
  if (pod.mode !== "solid") throw new Error("Expected Solid");
  await pod.publicFetch(alice.webId, { credentials: "include" });
  expect(transport).toHaveBeenCalledWith(alice.webId, { credentials: "omit" });
  const listener = vi.fn();
  const stop = pod.subscribe(listener);
  await act(() => window.dispatchEvent(new Event("focus")));
  expect(listener).toHaveBeenCalledWith(alice.storageUrl);
  stop();
  await act(() => window.dispatchEvent(new Event("focus")));
  expect(listener).toHaveBeenCalledOnce();
});

it("keeps the same session for inert expired content while blocking its fetch handles", async () => {
  const value = accounts();
  const mounted = await mount(tree(value));
  const pod = session();
  await mounted.render(tree({ ...value, status: "expired" }));
  expect(session()).toBe(pod);
  await expect(pod.fetch(alice.storageUrl)).rejects.toThrow("Sign in to continue");
  expect(value.fetch).not.toHaveBeenCalled();
});

it("fences old requests and handles when the account switches or signs out", async () => {
  const value = accounts();
  const response = deferred<Response>();
  value.fetch = vi.fn(() => response.promise);
  const mounted = await mount(tree(value));
  const first = session();
  const pending = first.fetch(alice.storageUrl);
  const rejected = expect(pending).rejects.toThrow("Sign in to continue");
  const bob = accounts({
    ...alice,
    id: "solid:bob",
    webId: "https://pod.example/bob/#me",
    storageUrl: "https://pod.example/bob/",
  });
  await mounted.render(tree(bob));
  response.resolve(new Response("Alice's late result"));
  await rejected;
  await expect(first.fetch(alice.storageUrl)).rejects.toThrow("Sign in to continue");
  expect(bob.fetch).not.toHaveBeenCalled();
  const second = session();
  expect(second).not.toBe(first);
  await mounted.render(tree(accounts(null)));
  expect(state.status).toBe("signed-out");
  await expect(second.fetch(bob.active?.storageUrl ?? "")).rejects.toThrow("Sign in to continue");
});

it("does not open a fallback pod while shell restoration is pending", async () => {
  await mount(tree({ ...accounts(null), status: "loading" }));
  expect(state.status).toBe("loading");
});

it("does not revive old handles when switching back to the same account object", async () => {
  const value = accounts();
  const mounted = await mount(tree(value));
  const first = session();
  await mounted.render(tree(accounts({ ...alice, id: "solid:bob" })));
  await mounted.render(tree(value));
  expect(session()).not.toBe(first);
  await expect(first.fetch(alice.storageUrl)).rejects.toThrow("Sign in to continue");
  expect(value.fetch).not.toHaveBeenCalled();
  expect((await session().fetch(alice.storageUrl)).ok).toBe(true);
});

it("blocks old handles when a session provider unmounts during sign-out", async () => {
  const value = accounts();
  const mounted = await mount(tree(value));
  const pod = session();
  await mounted.unmount();
  await expect(pod.fetch(alice.storageUrl)).rejects.toThrow("Sign in to continue");
  expect(value.fetch).not.toHaveBeenCalled();
});
