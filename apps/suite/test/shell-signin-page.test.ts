// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { beforeEach, expect, it, vi } from "vitest";
import { h, mount } from "./drive-ui-dom";

const fixture = vi.hoisted(() => ({
  status: "loading",
  active: null as { name: string } | null,
  params: new URLSearchParams(),
  router: { replace: vi.fn(), prefetch: vi.fn() },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => fixture.router,
  useSearchParams: () => fixture.params,
}));
vi.mock("../src/shell/session/accounts-provider", () => ({
  useAccounts: () => ({ ...fixture, accounts: [], backendKinds: [] }),
}));
vi.mock("../src/lib/session/extension-session", () => ({
  useSolidExtension: () => ({ present: false }),
}));
vi.mock("../src/shell/environment", () => ({
  useSuiteEnvironment: () => ({ NEXT_PUBLIC_SUITE_KNOWN_PROVIDERS: [] }),
}));
vi.mock("../src/shell/app-frame-loaders", () => ({ preloadAppFrame: async () => {} }));
vi.mock("../src/shell/registration/use-registration", () => ({
  useRegistration: () => ({ available: false }),
  SIGNUP_UNAVAILABLE_PARAM: "signup",
  SIGNUP_UNAVAILABLE_NOTE: "Registration unavailable",
}));
vi.mock("../src/shell/public/demo-button", () => ({ DemoButton: () => null }));
vi.mock("../src/shell/public/pod-explainer", () => ({ PodExplainer: () => null }));

import SignInPage from "../src/shell/public/sign-in-page";

beforeEach(() => {
  fixture.status = "loading";
  fixture.active = null;
  fixture.params = new URLSearchParams();
  fixture.router.replace.mockClear();
});

it("navigates when a session restores after the popup's submit handler was lost", async () => {
  const view = await mount(h(SignInPage));
  expect(fixture.router.replace).not.toHaveBeenCalled();
  fixture.status = "ready";
  fixture.active = { name: "Alice" };
  await view.render(h(SignInPage));
  expect(fixture.router.replace).toHaveBeenCalledWith("/home");
  fixture.active = { name: "Alice" };
  await view.render(h(SignInPage));
  expect(fixture.router.replace).toHaveBeenCalledOnce();
});

it.each([
  "/search?q=notes",
  "//foreign.example",
  "https://foreign.example",
])("validates the restored session's next destination %s", async (next) => {
  fixture.status = "ready";
  fixture.active = { name: "Alice" };
  fixture.params.set("next", next);
  await mount(h(SignInPage));
  expect(fixture.router.replace).toHaveBeenCalledWith(next === "/search?q=notes" ? next : "/home");
});

it("keeps add-account sign-in open and never redirects an expired session", async () => {
  fixture.status = "ready";
  fixture.active = { name: "Alice" };
  fixture.params.set("add", "1");
  const view = await mount(h(SignInPage));
  expect(fixture.router.replace).not.toHaveBeenCalled();
  fixture.params.delete("add");
  fixture.status = "expired";
  await view.render(h(SignInPage));
  expect(fixture.router.replace).not.toHaveBeenCalled();
});
