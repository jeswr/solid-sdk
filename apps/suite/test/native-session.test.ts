// AUTHORED-BY Codex GPT-6
import { expect, it, vi } from "vitest";
import { PodSessionProvider, usePodSessionState } from "../src/lib/session/native-session";
import { h, mount } from "./drive-ui-dom";

vi.mock("@/lib/session/pod-session", async () => import("../src/lib/session/native-session"));
vi.mock("../src/lib/session/pod-session", async () => import("../src/lib/session/native-session"));
vi.mock("@/lib/refs", async () => import("../src/lib/refs"));
vi.mock("@/components/interim-shell/suite-frame", () => ({ SuiteFrame: () => null }));
vi.mock("@jeswr/suite-ui", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  Toaster: () => null,
}));
vi.mock("../src/lib/demo-pod/browser", () => {
  throw new Error("The native target must not load the demo pod");
});

import { CalendarProvider } from "../src/apps/calendar/state/calendar-context";
import { ContactsProvider } from "../src/apps/contacts/state/contacts-context";
import { DriveApp } from "../src/apps/drive/components/drive-app";

it.each([
  [DriveApp, "Drive"],
  [CalendarProvider, "Calendar"],
  [ContactsProvider, "Contacts"],
] as const)("keeps the native %s signed out without opening data", async (Component, name) => {
  const mounted = await mount(h(Component, { children: h("span", null, "Pod content") }));
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
