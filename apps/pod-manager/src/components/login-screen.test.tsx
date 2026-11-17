// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SignInCardProps } from "@jeswr/suite-ui/sign-in";
import { useSession, type Session } from "./session-provider";
import { LoginScreen, signInProviders } from "./login-screen";

let props: SignInCardProps;
vi.mock("./session-provider", () => ({ useSession: vi.fn() }));
vi.mock("@jeswr/suite-ui/sign-in", () => ({
  SignInCard: (value: SignInCardProps) => {
    props = value;
    return null;
  },
}));
vi.mock("./theme-toggle", () => ({ ThemeToggle: () => null }));
let root: Root;
let container: HTMLDivElement;
let session: Session;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  session = {
    sourceFetch: fetch,
    podFetch: fetch,
    status: "logged-out",
    ready: true,
    startupFailed: false,
    error: null,
    pending: null,
    recentAccounts: [{ webId: "https://alice.example/#me", name: "Alice" }],
    recentProviders: ["https://provider.example/"],
    retry: vi.fn(),
    loginWithAddress: vi.fn(async () => {}),
    loginWithIssuer: vi.fn(async () => {}),
    loginWithAccount: vi.fn(async () => {}),
    cancelLogin: vi.fn(),
    logout: vi.fn(async () => {}),
    setActiveStorage: vi.fn(),
  };
  vi.mocked(useSession).mockReturnValue(session);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it("supplies the shared card copy, accounts and all four host actions", async () => {
  await act(async () => root.render(<LoginScreen />));
  expect(props).toMatchObject({
    title: "Sign in",
    accountsTitle: "Choose an account",
    subtitle: "to continue to Pod Manager",
    recentAccounts: session.recentAccounts,
    recentProviders: session.recentProviders,
  });
  props.onWebId("https://alice.example/#me");
  props.onCustomProvider("https://provider.example/");
  props.onProvider({ id: "test", name: "Test", issuer: "https://provider.example/" });
  props.onAccount(session.recentAccounts[0]);
  props.onCancel!();
  expect(session.loginWithAddress).toHaveBeenCalledWith("https://alice.example/#me");
  expect(session.loginWithAddress).toHaveBeenCalledWith("https://provider.example/", "custom");
  expect(session.loginWithIssuer).toHaveBeenCalledWith("https://provider.example/");
  expect(session.loginWithAccount).toHaveBeenCalledWith("https://alice.example/#me");
  expect(session.cancelLogin).toHaveBeenCalledOnce();
  expect(container.querySelector('a[href="/privacy"]')).not.toBeNull();
  expect(container.querySelector('a[href="/terms"]')).not.toBeNull();
});
it("disables startup actions and exposes the startup retry", async () => {
  vi.mocked(useSession).mockReturnValue({
    ...session,
    ready: false,
    startupFailed: true,
    error: "We couldn't start sign-in. Try again.",
  });
  await act(async () => root.render(<LoginScreen />));
  expect(container.querySelector("fieldset")?.disabled).toBe(true);
  const button = [...container.querySelectorAll("button")].find(
    (element) => element.textContent === "Try again",
  )!;
  await act(async () => button.click());
  expect(session.retry).toHaveBeenCalledOnce();
});
it("orders configured providers after home, de-duplicates home and preserves known sign-up metadata", () => {
  vi.stubEnv("NEXT_PUBLIC_HOME_IDP", "https://solidcommunity.net/");
  vi.stubEnv("NEXT_PUBLIC_HOME_IDP_NAME", "My provider");
  vi.stubEnv(
    "NEXT_PUBLIC_KNOWN_PROVIDERS",
    "https://solidweb.org/,https://solidcommunity.net,https://custom.example/",
  );
  const providers = signInProviders();
  expect(providers.map((p) => p.issuer)).toEqual([
    "https://solidcommunity.net/",
    "https://solidweb.org/",
    "https://custom.example/",
  ]);
  expect(providers[0].name).toBe("My provider");
  expect(providers[0].signUpUrl).toContain("register");
});
it("ignores unsafe home configuration and uses the shared directory fallback", () => {
  vi.stubEnv("NEXT_PUBLIC_HOME_IDP", "javascript:secret");
  vi.stubEnv("NEXT_PUBLIC_KNOWN_PROVIDERS", "unsafe");
  expect(signInProviders().map((p) => p.id)).toEqual([
    "solidcommunity",
    "inrupt",
    "teamid",
  ]);
});
it("shows only the WebID's own providers, on the provider step, when it lists several", async () => {
  vi.stubEnv("NEXT_PUBLIC_HOME_IDP", "https://idp.solid-test.jeswr.org");
  vi.stubEnv("NEXT_PUBLIC_HOME_IDP_NAME", "Jeswr");
  vi.mocked(useSession).mockReturnValue({
    ...session,
    issuerChoice: {
      webId: "https://alice.example/profile/card#me",
      issuers: ["https://idp.solid-test.jeswr.org/", "https://unknown.example/"],
    },
  });
  await act(async () => root.render(<LoginScreen />));
  expect(props.defaultView).toBe("sign-in");
  expect(props.subtitle).toBe("Choose the provider for alice.example");
  expect(props.providers.map(({ name, issuer }) => ({ name, issuer }))).toEqual([
    { name: "Jeswr", issuer: "https://idp.solid-test.jeswr.org/" },
    { name: "unknown.example", issuer: "https://unknown.example/" },
  ]);
});
