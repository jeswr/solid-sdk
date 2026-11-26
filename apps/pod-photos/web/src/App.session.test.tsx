// AUTHORED-BY GPT-6.1 Sol
import type { Profile } from "@jeswr/app-session";
import { SessionProvider } from "@jeswr/app-session/react";
import { deferred, fakePodAuth, identity, POD_ROOT, WEB_ID } from "@jeswr/app-session/testing";
import { ThemeProvider } from "@jeswr/app-shell";
import type { PhotoGalleryProps } from "@jeswr/pod-photos/ui";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "./App";
import { getPodAuth, legacyCredentials } from "./auth/pod-auth";
import type { PhotosRoot } from "./photos-root";

const seams = vi.hoisted(() => ({ gallery: vi.fn(), discover: vi.fn() }));
vi.mock("@jeswr/pod-photos/ui", () => ({
  PhotoGallery: (props: PhotoGalleryProps) => {
    seams.gallery(props);
    return <div data-testid="photo-gallery">{props.rootUrl}</div>;
  },
}));
vi.mock("./photos-root", () => ({ resolvePhotosRoot: seams.discover }));
vi.mock("@jeswr/solid-elements/react", () => ({
  Loading: ({ label }: { label: string }) => <span role="status">{label}</span>,
}));

function mount(
  fake = fakePodAuth(),
  storages = [POD_ROOT],
  readProfile = async (webId: string): Promise<Profile> => ({
    webId,
    name: "Alice Photos",
    storages,
    oidcIssuers: [],
  }),
) {
  const view = render(
    <StrictMode>
      <ThemeProvider storageKey="pod-photos:app-shell-theme">
        <SessionProvider
          getPodAuth={getPodAuth}
          auth={fake.auth}
          appName="Pod Photos"
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

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  seams.gallery.mockReset();
  seams.discover
    .mockReset()
    .mockResolvedValue({ rootUrl: `${POD_ROOT}photos/`, isFallback: false });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("uses the shared Photos sign-in screen and cleans only Photos' obsolete storage", async () => {
  vi.stubEnv("VITE_HOME_IDP", "https://photos-provider.example/");
  vi.stubEnv("VITE_HOME_IDP_NAME", "Photos provider");
  localStorage.setItem("pod-photos:remembered-account", "obsolete pointer");
  localStorage.setItem("pod-photos:app-shell-theme", "dark");
  localStorage.setItem("another-app:remembered-account", "keep");
  sessionStorage.setItem("pod-photos:pss.autologin.flow", "obsolete flow");
  sessionStorage.setItem("pod-photos:autologin-attempted", WEB_ID);
  sessionStorage.setItem("another-app:pss.autologin.flow", "keep");
  const deleteDatabase = vi.fn();
  vi.stubGlobal("indexedDB", { deleteDatabase });

  const { auth } = mount();
  expect(await screen.findByRole("heading", { name: "Sign in" })).toBeVisible();
  expect(screen.queryByTestId("photo-gallery")).toBeNull();
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.getByText("to continue to Pod Photos")).toBeVisible();
  expect(screen.getByRole("button", { name: "Photos provider" })).toBeVisible();
  expect(auth.login).not.toHaveBeenCalled();
  expect(auth.restore).toHaveBeenCalledTimes(1);
  expect(deleteDatabase.mock.calls).toEqual([["pod-photos:sessions"]]);
  expect(localStorage.getItem("pod-photos:remembered-account")).toBeNull();
  expect(sessionStorage.getItem("pod-photos:pss.autologin.flow")).toBeNull();
  expect(sessionStorage.getItem("pod-photos:autologin-attempted")).toBeNull();
  expect(localStorage.getItem("pod-photos:app-shell-theme")).toBe("dark");
  expect(localStorage.getItem("another-app:remembered-account")).toBe("keep");
  expect(sessionStorage.getItem("another-app:pss.autologin.flow")).toBe("keep");
});

it("uses the Photos spinner while restoring identity and loading the profile", async () => {
  const fake = fakePodAuth();
  const restore = deferred<typeof identity | null>();
  const profile = deferred<Profile>();
  fake.auth.restore.mockReturnValue(restore.promise);
  const view = mount(fake, [POD_ROOT], () => profile.promise);

  expect(await screen.findByRole("status")).toHaveTextContent("Restoring your session…");
  expect(screen.queryByRole("heading", { name: "Sign in" })).toBeNull();
  expect(screen.queryByTestId("photo-gallery")).toBeNull();
  expect(seams.discover).not.toHaveBeenCalled();
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Pod Photos");
  expect(
    view.container.querySelector(
      "main.login-screen[aria-busy=true] > section.login-card > h1 + p.login-sub",
    ),
  ).toContainElement(screen.getByRole("status"));

  await act(async () => restore.resolve(identity));
  expect(screen.getByRole("status")).toHaveTextContent("Loading your account…");
  expect(screen.queryByRole("heading", { name: "Sign in" })).toBeNull();
  expect(screen.queryByTestId("photo-gallery")).toBeNull();
  expect(seams.discover).not.toHaveBeenCalled();

  await act(async () =>
    profile.resolve({ webId: WEB_ID, name: "Alice Photos", storages: [POD_ROOT], oidcIssuers: [] }),
  );
  expect(await screen.findByTestId("photo-gallery")).toBeInTheDocument();
  expect(screen.queryByRole("status")).toBeNull();
});

it("passes the shared session fetch through discovery and gallery while preserving global fetch", async () => {
  const pristineFetch = globalThis.fetch;
  const fake = fakePodAuth();
  fake.auth.restore.mockResolvedValue(identity);
  mount(fake);
  expect(await screen.findByTestId("photo-gallery")).toHaveTextContent(`${POD_ROOT}photos/`);
  expect(seams.discover).toHaveBeenCalledWith({
    webId: WEB_ID,
    podRoot: POD_ROOT,
    fetchImpl: fake.auth.fetch,
  });
  expect(seams.gallery).toHaveBeenLastCalledWith(
    expect.objectContaining({ fetch: fake.auth.fetch }),
  );
  expect(globalThis.fetch).toBe(pristineFetch);

  await act(async () => fake.emit("logout", null));
  expect(await screen.findByRole("heading", { name: "Sign in" })).toBeVisible();
  expect(screen.queryByTestId("photo-gallery")).toBeNull();
});

it("signs in through the configured shared provider before browsing Photos", async () => {
  vi.stubEnv("VITE_HOME_IDP", "https://photos-provider.example/");
  vi.stubEnv("VITE_HOME_IDP_NAME", "Photos provider");
  const { auth } = mount();
  fireEvent.click(await screen.findByRole("button", { name: "Photos provider" }));
  await screen.findByTestId("photo-gallery");
  expect(auth.login).toHaveBeenCalledWith(
    { issuer: "https://photos-provider.example/" },
    { signal: expect.any(AbortSignal) },
  );
});

it("keeps Photos' storage and Type Index fallback notices", async () => {
  const fake = fakePodAuth();
  fake.auth.restore.mockResolvedValue(identity);
  const rootUrl = "https://alice.example/photos/";
  seams.discover.mockResolvedValue({ rootUrl, isFallback: true });
  mount(fake, []);
  await screen.findByTestId("photo-gallery");
  const notes = screen.getAllByRole("note");
  expect(notes[0]).toHaveTextContent(
    "Photos can only show public photos at https://alice.example/",
  );
  expect(notes[1]).toHaveTextContent(rootUrl);
  expect(seams.discover).toHaveBeenCalledWith(
    expect.objectContaining({ podRoot: "https://alice.example/" }),
  );
});

it("discards pending Photos discovery when the shared session logs out", async () => {
  const pending = deferred<PhotosRoot>();
  seams.discover.mockReturnValue(pending.promise);
  const fake = fakePodAuth();
  fake.auth.restore.mockResolvedValue(identity);
  const { emit } = mount(fake);
  await screen.findByText("Finding your photos…");
  await act(async () => emit("logout", null));
  await screen.findByRole("heading", { name: "Sign in" });
  await act(async () => pending.resolve({ rootUrl: `${POD_ROOT}private/`, isFallback: false }));
  expect(screen.queryByTestId("photo-gallery")).toBeNull();
  expect(seams.gallery).not.toHaveBeenCalled();
});

it("still opens the gallery fallback if Photos discovery rejects", async () => {
  seams.discover.mockRejectedValue(new Error("discovery failed"));
  const fake = fakePodAuth();
  fake.auth.restore.mockResolvedValue(identity);
  mount(fake);
  await waitFor(() =>
    expect(screen.getByTestId("photo-gallery")).toHaveTextContent(`${POD_ROOT}photos/`),
  );
  expect(screen.getByRole("note")).toHaveTextContent(
    "No schema:Photograph container is registered",
  );
});
