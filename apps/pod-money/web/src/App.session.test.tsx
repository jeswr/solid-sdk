// AUTHORED-BY GPT-6.1 Sol
import type { Profile } from "@jeswr/app-session";
import { SessionProvider } from "@jeswr/app-session/react";
import { deferred, fakePodAuth, identity, POD_ROOT, WEB_ID } from "@jeswr/app-session/testing";
import { ThemeProvider } from "@jeswr/app-shell";
import type { AccountsViewProps } from "@jeswr/pod-money/ui";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "./App";
import { getPodAuth, legacyCredentials } from "./auth/pod-auth";

const seams = vi.hoisted(() => ({
  store: vi.fn(),
  discover: vi.fn<() => Promise<{ instance?: string; container?: string }[]>>(),
  view: vi.fn<(props: AccountsViewProps) => void>(),
}));
vi.mock("@jeswr/pod-money", () => ({
  MoneyStore: class {
    static primaryClass = "https://example/#Transaction";
    ledgerUrl: string;
    constructor(options: { podRoot: string; fetch: typeof fetch }) {
      seams.store(options);
      this.ledgerUrl = `${options.podRoot}finance/ledger.ttl`;
    }
    discover = seams.discover;
  },
}));
vi.mock("@jeswr/pod-money/ui", () => ({
  AccountsView: (props: AccountsViewProps) => {
    seams.view(props);
    return <h2>{props.title}</h2>;
  },
}));
// Observe the host spinner's label without Lit's node export skipping prop forwarding.
vi.mock("@jeswr/solid-elements/react", () => ({
  Loading: ({ label }: { label: string }) => <span role="status">{label}</span>,
}));

const profile: Profile = {
  webId: WEB_ID,
  name: "Alice",
  storages: [POD_ROOT],
  oidcIssuers: [identity.issuer],
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  seams.store.mockClear();
  seams.view.mockClear();
  seams.discover.mockReset().mockResolvedValue([]);
});
afterEach(() => {
  document.documentElement.removeAttribute("data-solid-extension");
  delete (window as unknown as { solid?: unknown }).solid;
  vi.unstubAllGlobals();
});

function mountSession(fake = fakePodAuth(), readProfile = async () => profile) {
  const view = render(
    <StrictMode>
      <SessionProvider
        auth={fake.auth}
        getPodAuth={getPodAuth}
        appName="Pod Money"
        dev={import.meta.env.DEV}
        legacyCredentials={legacyCredentials}
        readProfile={readProfile}
      >
        <ThemeProvider>
          <App />
        </ThemeProvider>
      </SessionProvider>
    </StrictMode>,
  );
  return { ...fake, ...view };
}

it("uses the shared Money sign-in card and retires only Money's obsolete storage", async () => {
  const deleteDatabase = vi.fn();
  vi.stubGlobal("indexedDB", { deleteDatabase });
  localStorage.setItem("pod-money:remembered-account", "old account");
  localStorage.setItem("pod-money:app-shell-theme", "dark");
  localStorage.setItem("pod-docs:remembered-account", "another app");
  sessionStorage.setItem("pod-money:autologin-attempted", WEB_ID);
  sessionStorage.setItem("pod-money:pss.autologin.flow", "obsolete flow");
  sessionStorage.setItem("pod-docs:pss.autologin.flow", "another flow");
  const { auth } = mountSession();
  expect(await screen.findByRole("group", { name: "Pod Money sign-in" })).toBeEnabled();
  expect(screen.getByText("to continue to Pod Money")).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Your accounts" })).toBeNull();
  expect(screen.queryByRole("status")).toBeNull();
  expect(seams.store).not.toHaveBeenCalled();
  expect(deleteDatabase).toHaveBeenCalledExactlyOnceWith("pod-money:sessions");
  expect(localStorage.getItem("pod-money:remembered-account")).toBeNull();
  expect(sessionStorage.getItem("pod-money:autologin-attempted")).toBeNull();
  expect(sessionStorage.getItem("pod-money:pss.autologin.flow")).toBeNull();
  expect(localStorage.getItem("pod-money:app-shell-theme")).toBe("dark");
  expect(localStorage.getItem("pod-docs:remembered-account")).toBe("another app");
  expect(sessionStorage.getItem("pod-docs:pss.autologin.flow")).toBe("another flow");
  expect(auth.restore).toHaveBeenCalledTimes(1);
});

it("keeps the host spinner and loading labels until both identity and profile are available", async () => {
  const fake = fakePodAuth();
  const restore = deferred<typeof identity | null>();
  const readProfile = deferred<Profile>();
  fake.auth.restore.mockReturnValue(restore.promise);
  const view = mountSession(fake, () => readProfile.promise);
  expect(await screen.findByRole("status")).toHaveTextContent("Restoring your session…");
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Pod Money");
  expect(
    view.container.querySelector(
      "main.login-screen[aria-busy=true] > section.login-card > h1 + p.login-sub",
    ),
  ).toContainElement(screen.getByRole("status"));
  expect(screen.queryByRole("group", { name: "Pod Money sign-in" })).toBeNull();
  expect(seams.store).not.toHaveBeenCalled();
  await act(async () => restore.resolve(identity));
  expect(screen.getByRole("status")).toHaveTextContent("Loading your account…");
  expect(screen.queryByRole("heading", { name: "Your accounts" })).toBeNull();
  expect(screen.queryByRole("group", { name: "Pod Money sign-in" })).toBeNull();
  expect(seams.store).not.toHaveBeenCalled();
  await act(async () => readProfile.resolve(profile));
  expect(await screen.findByRole("heading", { name: "Your accounts" })).toBeInTheDocument();
  expect(screen.queryByRole("status")).toBeNull();
});

it.each([
  false,
  true,
])("threads the bounded fetch and signs out with extension present=%s", async (extensionPresent) => {
  if (extensionPresent) document.documentElement.setAttribute("data-solid-extension", "1");
  const ambient = globalThis.fetch;
  const fake = fakePodAuth();
  fake.auth.restore.mockResolvedValue(identity);
  const ledger = `${POD_ROOT}registered/ledger.ttl`;
  seams.discover.mockResolvedValue([{ instance: ledger }]);
  const { auth } = mountSession(fake);
  await screen.findByRole("heading", { name: "Your accounts" });
  expect(seams.store).toHaveBeenCalledWith({ podRoot: POD_ROOT, fetch: auth.fetch });
  expect(seams.view).toHaveBeenLastCalledWith({
    ledgerUrl: ledger,
    title: "Your accounts",
    fetch: auth.fetch,
  });
  expect(screen.queryByText(/No finance registration/)).not.toBeInTheDocument();
  if (extensionPresent) {
    expect(screen.queryByRole("button", { name: "Account menu" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  } else {
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
    fireEvent(
      screen.getByRole("button", { name: "Account menu" }),
      new MouseEvent("pointerdown", { bubbles: true }),
    );
    expect(await screen.findByText(WEB_ID)).toBeInTheDocument();
    expect(screen.getByRole("menu")).toHaveTextContent("Alice");
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
  }
  await screen.findByRole("group", { name: "Pod Money sign-in" });
  expect(screen.queryByRole("heading", { name: "Your accounts" })).toBeNull();
  expect(auth.logout).toHaveBeenCalledTimes(1);
  expect(globalThis.fetch).toBe(ambient);
});

it("keeps Money's conventional ledger fallback when Type Index discovery fails", async () => {
  const fake = fakePodAuth();
  fake.auth.restore.mockResolvedValue(identity);
  seams.discover.mockRejectedValue(new Error("index unavailable"));
  mountSession(fake);
  await screen.findByRole("heading", { name: "Your accounts" });
  expect(screen.getByRole("note")).toHaveTextContent("No finance registration");
  expect(seams.view).toHaveBeenLastCalledWith({
    ledgerUrl: `${POD_ROOT}finance/ledger.ttl`,
    title: "Your accounts",
    fetch: fake.auth.fetch,
  });
});

it("discards a previous account's ledger discovery after the shared session changes", async () => {
  const fake = fakePodAuth();
  fake.auth.restore.mockResolvedValue(identity);
  const oldDiscovery = deferred<{ instance: string }[]>();
  seams.discover.mockReturnValue(oldDiscovery.promise);
  const { emit } = mountSession(fake);
  await waitFor(() => expect(seams.store).toHaveBeenCalled());
  await act(async () => emit("logout", null));
  await screen.findByRole("group", { name: "Pod Money sign-in" });
  await act(async () => oldDiscovery.resolve([{ instance: `${POD_ROOT}old-ledger.ttl` }]));
  expect(seams.view).not.toHaveBeenCalled();
});
