// AUTHORED-BY GPT-6.1 Sol
import type { Profile } from "@jeswr/app-session";
import { SessionProvider } from "@jeswr/app-session/react";
import { deferred, fakePodAuth, identity, POD_ROOT, WEB_ID } from "@jeswr/app-session/testing";
import { ThemeProvider } from "@jeswr/app-shell";
import type { MusicLibraryProps } from "@jeswr/pod-music/ui";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "./App";
import { APP_NAME, legacyCredentials } from "./auth/pod-auth";

const music = vi.hoisted(() => ({
  stores: vi.fn(),
  findTrackContainers: vi.fn<() => Promise<string[]>>(),
  library: undefined as MusicLibraryProps | undefined,
}));
vi.mock("@jeswr/pod-music", () => ({
  MusicStore: class {
    constructor(options: { base: string; fetch?: typeof fetch }) {
      music.stores(options);
    }
    findTrackContainers = music.findTrackContainers;
  },
}));
vi.mock("@jeswr/pod-music/ui", () => ({
  MusicLibrary: (props: MusicLibraryProps) => {
    music.library = props;
    return <p>Your private tracks</p>;
  },
}));
// Observe the host spinner's labels without Lit's node-export prop-forwarding limitation.
vi.mock("@jeswr/solid-elements/react", () => ({
  Loading: ({ label }: { label: string }) => <span role="status">{label}</span>,
}));

const profile: Profile = {
  webId: WEB_ID,
  name: "Music listener",
  storages: [POD_ROOT],
  oidcIssuers: ["https://provider.example/"],
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  music.stores.mockClear();
  music.findTrackContainers.mockReset().mockResolvedValue([`${POD_ROOT}collection/tracks/`]);
  music.library = undefined;
  vi.stubEnv("VITE_HOME_IDP", "https://provider.example/");
  vi.stubEnv("VITE_HOME_IDP_NAME", "Music provider");
});
afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-solid-extension");
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function mount(restored = false, { fake = fakePodAuth(), readProfile = async () => profile } = {}) {
  if (restored) fake.auth.restore.mockResolvedValue(identity);
  const view = render(
    <StrictMode>
      <ThemeProvider>
        <SessionProvider
          getPodAuth={async () => fake.auth}
          auth={fake.auth}
          appName={APP_NAME}
          legacyCredentials={legacyCredentials}
          readProfile={readProfile}
        >
          <App />
        </SessionProvider>
      </ThemeProvider>
    </StrictMode>,
  );
  return { ...view, ...fake };
}

it("keeps the host spinner through restore, profile loading and music discovery", async () => {
  const fake = fakePodAuth();
  const restore = deferred<typeof identity | null>();
  const readProfile = deferred<Profile>();
  const discovery = deferred<string[]>();
  fake.auth.restore.mockReturnValue(restore.promise);
  music.findTrackContainers.mockReturnValue(discovery.promise);
  const view = mount(false, { fake, readProfile: () => readProfile.promise });

  expect(await screen.findByRole("status")).toHaveTextContent("Restoring your session…");
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Pod Music");
  expect(
    view.container.querySelector(
      "main.login-screen[aria-busy=true] > section.login-card > h1 + p.login-sub",
    ),
  ).toContainElement(screen.getByRole("status"));
  expect(screen.queryByRole("heading", { name: "Sign in" })).toBeNull();
  expect(screen.queryByText("Your private tracks")).toBeNull();

  await act(async () => restore.resolve(identity));
  expect(screen.getByRole("status")).toHaveTextContent("Loading your account…");
  expect(screen.queryByRole("button", { name: "Account menu" })).toBeNull();
  expect(music.stores).not.toHaveBeenCalled();

  await act(async () => readProfile.resolve(profile));
  expect(screen.getByRole("status")).toHaveTextContent("Finding your music library…");
  expect(screen.getByRole("button", { name: "Account menu" })).toBeInTheDocument();
  expect(screen.queryByText("Your private tracks")).toBeNull();

  await act(async () => discovery.resolve([`${POD_ROOT}collection/tracks/`]));
  expect(await screen.findByText("Your private tracks")).toBeInTheDocument();
  expect(screen.queryByRole("status")).toBeNull();
});

it("restores through the shared provider and passes its fetch to discovery and the library", async () => {
  const ambient = globalThis.fetch;
  const { auth } = mount(true);
  await screen.findByText("Your private tracks");
  expect(auth.restore).toHaveBeenCalledTimes(1);
  expect(music.stores).toHaveBeenCalledWith({ base: `${POD_ROOT}music/`, fetch: auth.fetch });
  expect(music.findTrackContainers).toHaveBeenCalledWith(WEB_ID);
  expect(music.library).toMatchObject({ base: `${POD_ROOT}collection/`, fetch: auth.fetch });
  expect(globalThis.fetch).toBe(ambient);
});

it("uses the configured shared sign-in card and retains Music's discovery fallback note", async () => {
  music.findTrackContainers.mockResolvedValue([]);
  const { auth } = mount();
  expect(await screen.findByText("to continue to Pod Music")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.queryByText("Your private tracks")).toBeNull();
  fireEvent.click(await screen.findByRole("button", { name: /Music provider/ }));
  await screen.findByText("Your private tracks");
  expect(auth.login).toHaveBeenCalledWith(
    { issuer: "https://provider.example/" },
    { signal: expect.any(AbortSignal) },
  );
  expect(music.library).toMatchObject({ base: `${POD_ROOT}music/`, fetch: auth.fetch });
  expect(screen.getByRole("note")).toHaveTextContent("No mo:Track registration was found");
});

it.each([
  false,
  true,
])("signs out and returns to the login screen (extension present: %s)", async (extensionPresent) => {
  if (extensionPresent) document.documentElement.setAttribute("data-solid-extension", "1");
  const { auth } = mount(true);
  await screen.findByText("Your private tracks");
  if (extensionPresent) {
    expect(screen.queryByRole("button", { name: "Account menu" })).toBeNull();
    const signOut = screen.getByRole("button", { name: "Sign out" });
    expect(signOut).toHaveAttribute("data-app-shell-control");
    fireEvent.click(signOut);
  } else {
    const account = screen.getByRole("button", { name: "Account menu" });
    expect(account).toHaveTextContent(profile.name);
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
    fireEvent.keyDown(account, { key: "ArrowDown" });
    expect(await screen.findByText(WEB_ID)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
  }
  expect(auth.logout).toHaveBeenCalledTimes(1);
  expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  expect(screen.queryByText("Your private tracks")).toBeNull();
  expect(screen.queryByRole("button", { name: "Account menu" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Feedback" })).toBeNull();
});

it("cleans exactly Music's obsolete stores while preserving theme and other apps' state", async () => {
  const deleteDatabase = vi.fn();
  vi.stubGlobal("indexedDB", { deleteDatabase });
  for (const key of ["pod-music:remembered-account", "pod-music:app-shell-theme", "other:account"])
    localStorage.setItem(key, "keep-or-remove");
  for (const key of ["pod-music:pss.autologin.flow", "pod-music:autologin-attempted", "other:flow"])
    sessionStorage.setItem(key, "keep-or-remove");
  mount();
  await waitFor(() => expect(screen.getByRole("button", { name: /Music provider/ })).toBeEnabled());
  expect(localStorage.getItem("pod-music:remembered-account")).toBeNull();
  expect(localStorage.getItem("pod-music:app-shell-theme")).toBe("keep-or-remove");
  expect(localStorage.getItem("other:account")).toBe("keep-or-remove");
  expect(sessionStorage.getItem("pod-music:pss.autologin.flow")).toBeNull();
  expect(sessionStorage.getItem("pod-music:autologin-attempted")).toBeNull();
  expect(sessionStorage.getItem("other:flow")).toBe("keep-or-remove");
  expect(deleteDatabase.mock.calls).toEqual([["pod-music:sessions"]]);
});
