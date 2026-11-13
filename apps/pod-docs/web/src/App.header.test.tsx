// AUTHORED-BY GPT-6.1 Sol
import type { Profile } from "@jeswr/app-session";
import { SessionProvider } from "@jeswr/app-session/react";
import { deferred, fakePodAuth, identity, POD_ROOT, WEB_ID } from "@jeswr/app-session/testing";
import { ThemeProvider } from "@jeswr/app-shell";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

vi.mock("./CollectionBrowser", () => ({ CollectionBrowser: () => <div data-testid="browser" /> }));
// Keep the gate's host-renderer contract observable without Lit's node export limitations.
vi.mock("@jeswr/solid-elements/react", () => ({
  Loading: ({ label }: { label: string }) => <span role="status">{label}</span>,
}));

const profile: Profile = {
  webId: WEB_ID,
  name: "Alice Example",
  storages: [POD_ROOT],
  oidcIssuers: [identity.issuer],
};
function renderApp(fake = fakePodAuth(), readProfile = async () => profile) {
  const view = render(
    <SessionProvider
      appName="Pod Docs"
      getPodAuth={() => Promise.resolve(fake.auth)}
      auth={fake.auth}
      readProfile={readProfile}
    >
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </SessionProvider>,
  );
  return { ...view, ...fake };
}

afterEach(() => {
  document.documentElement.removeAttribute("data-solid-extension");
  delete (window as unknown as { solid?: unknown }).solid;
});

describe("App session gate and account control", () => {
  it("renders the account menu when the extension is absent", async () => {
    const fake = fakePodAuth();
    fake.auth.restore.mockResolvedValue(identity);
    renderApp(fake);
    await screen.findByTestId("browser");
    expect(screen.getByRole("button", { name: "Account menu" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
  });

  it("keeps working sign-out when the extension owns the account menu", async () => {
    document.documentElement.setAttribute("data-solid-extension", "1");
    const fake = fakePodAuth();
    fake.auth.restore.mockResolvedValue(identity);
    renderApp(fake);
    await screen.findByTestId("browser");
    expect(screen.queryByRole("button", { name: "Account menu" })).toBeNull();
    expect(screen.getByRole("button", { name: /feedback/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(fake.auth.logout).toHaveBeenCalledTimes(1);
    await screen.findByRole("heading", { name: "Sign in" });
    expect(screen.queryByTestId("browser")).toBeNull();
  });

  it("uses the host loading renderer while restoring identity and reading its profile", async () => {
    const fake = fakePodAuth();
    const restore = deferred<typeof identity | null>();
    const readProfile = deferred<Profile>();
    fake.auth.restore.mockReturnValue(restore.promise);
    const view = renderApp(fake, () => readProfile.promise);
    expect(await screen.findByRole("status")).toHaveTextContent("Restoring your session…");
    expect(screen.queryByTestId("browser")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Sign in" })).toBeNull();
    expect(
      view.container.querySelector(
        "main.login-screen[aria-busy=true] > section.login-card > h1 + p.login-sub",
      ),
    ).toContainElement(screen.getByRole("status"));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Pod Docs");
    await act(async () => restore.resolve(identity));
    expect(screen.getByRole("status")).toHaveTextContent("Loading your account…");
    await act(async () => readProfile.resolve(profile));
    expect(await screen.findByTestId("browser")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows the configured login when restore finds no session", async () => {
    renderApp();
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByTestId("browser")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
