// AUTHORED-BY Codex GPT-6
import { beforeEach, expect, it, vi } from "vitest";
import { getDemoPod, resetDemoPod } from "../src/lib/demo-pod/browser";
import { PodSessionProvider, usePodSessionState } from "../src/lib/session/native-session";
import type { AccountsContextValue } from "../src/shell/session/accounts-provider";
import { h, mount } from "./drive-ui-dom";

const optionalAccounts = vi.hoisted(() => vi.fn<() => AccountsContextValue | null>());
vi.mock("@/shell/session/accounts-context", () => ({ useOptionalAccounts: optionalAccounts }));
beforeEach(() => optionalAccounts.mockReturnValue(null));

vi.mock("@/lib/session/pod-session", async () => import("../src/lib/session/native-session"));
vi.mock("../src/lib/session/pod-session", async () => import("../src/lib/session/native-session"));
vi.mock("@/lib/refs", async () => import("../src/lib/refs"));
vi.mock("@/components/interim-shell/suite-frame", () => ({ SuiteFrame: () => null }));
vi.mock("@jeswr/suite-ui", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  Toaster: () => null,
}));
vi.mock("../src/lib/demo-pod/browser", () => ({
  getDemoPod: vi.fn(() => {
    throw new Error("The native target must not open the demo pod");
  }),
  resetDemoPod: vi.fn(),
}));

import { CalendarProvider } from "../src/apps/calendar/state/calendar-context";
import { ContactsProvider } from "../src/apps/contacts/state/contacts-context";
import { DriveApp } from "../src/apps/drive/components/drive-app";

it.each([
  { Component: DriveApp, name: "Drive" },
  { Component: CalendarProvider, name: "Calendar" },
  { Component: ContactsProvider, name: "Contacts" },
] as const)("keeps the native $name signed out without opening data", async ({
  Component,
  name,
}) => {
  const mounted = await mount(
    h(PodSessionProvider, { children: h(Component, { children: h("span", null, "Pod content") }) }),
  );
  expect(mounted.host.textContent).toContain(`Sign in to open your ${name}`);
  expect(mounted.host.textContent).not.toContain("Pod content");
});

it("provides the shared session shape without consulting the installed extension", async () => {
  let state: ReturnType<typeof usePodSessionState> | undefined;
  function Probe() {
    state = usePodSessionState();
    return h("span", null, state.status);
  }
  const solid = vi.fn(() => {
    throw new Error("The native session must not read window.solid");
  });
  Object.defineProperty(window, "solid", { configurable: true, get: solid });
  try {
    const mounted = await mount(h(PodSessionProvider, { children: h(Probe) }));
    expect(mounted.host.textContent).toBe("signed-out");
    expect(state?.extension).toEqual({ present: false, granted: false, webId: null });
    await state?.connectExtension();
    expect(solid).not.toHaveBeenCalled();
  } finally {
    Reflect.deleteProperty(window, "solid");
  }
});

it("maps the native shell account and preserves its session through expiry and reauthentication", async () => {
  const account = {
    id: "solid:alice",
    kind: "solid" as const,
    name: "Alice",
    webId: "https://pod.example/profile#me",
    storageUrl: "https://pod.example/",
  };
  const fetch = vi.fn(async () => new Response("private data"));
  const accounts: AccountsContextValue = {
    active: account,
    accounts: [account],
    status: "ready",
    fetch,
    isActiveAccount: (id) => id === account.id,
    signIn: vi.fn(),
    signInDemo: vi.fn(),
    signInWith: vi.fn(),
    backendKinds: ["solid"],
    add: vi.fn(),
    switchTo: vi.fn(),
    signOut: vi.fn(),
    signOutAll: vi.fn(),
    reauth: vi.fn(),
  };
  optionalAccounts.mockReturnValue(accounts);
  let state!: ReturnType<typeof usePodSessionState>;
  function Probe() {
    state = usePodSessionState();
    return null;
  }
  const tree = () => h(PodSessionProvider, { children: h(Probe) });
  const view = await mount(tree());
  if (state.status !== "ready") throw new Error("Expected the native shell account");
  const pod = state.session;
  expect(pod).toMatchObject({
    mode: "solid",
    webId: account.webId,
    storageUrl: account.storageUrl,
    displayName: "Alice",
  });
  expect(await (await pod.fetch(account.storageUrl)).text()).toBe("private data");
  expect(fetch).toHaveBeenCalledWith(account.storageUrl, undefined);
  fetch.mockClear();

  optionalAccounts.mockReturnValue({ ...accounts, status: "expired" });
  await view.render(tree());
  expect(state).toMatchObject({ status: "ready", session: pod });
  await expect(pod.fetch(account.storageUrl)).rejects.toThrow("Sign in to continue");
  expect(fetch).not.toHaveBeenCalled();

  optionalAccounts.mockReturnValue(accounts);
  await view.render(tree());
  expect(state).toMatchObject({ status: "ready", session: pod });
  expect((await pod.fetch(account.storageUrl)).ok).toBe(true);

  optionalAccounts.mockReturnValue({ ...accounts, active: null, status: "signed-out" });
  await view.render(tree());
  expect(state.status).toBe("signed-out");
  await expect(pod.fetch(account.storageUrl)).rejects.toThrow("Sign in to continue");
  expect(getDemoPod).not.toHaveBeenCalled();
  expect(resetDemoPod).not.toHaveBeenCalled();
});

it("keeps native account restoration loading without opening a fallback pod", async () => {
  optionalAccounts.mockReturnValue({ active: null, status: "loading" } as AccountsContextValue);
  let status: string | undefined;
  function Probe() {
    status = usePodSessionState().status;
    return null;
  }
  await mount(h(PodSessionProvider, { children: h(Probe) }));
  expect(status).toBe("loading");
  expect(getDemoPod).not.toHaveBeenCalled();
});
