// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Exercise the real shared session gate and account control with a local auth fixture.
import type { Profile } from "@jeswr/app-session";
import { SessionProvider } from "@jeswr/app-session/react";
import { deferred, fakePodAuth, identity, POD_ROOT, WEB_ID } from "@jeswr/app-session/testing";
import { ThemeProvider } from "@jeswr/app-shell";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Stub the mailbox discovery + RDF fetch so the header test doesn't drive a live
// profile fetch; resolve to the conventional inbox so <Inbox> mounts.
vi.mock("@jeswr/fetch-rdf", () => ({
  fetchRdf: () => Promise.resolve({ dataset: [] }),
}));
vi.mock("./mailbox-discovery", () => ({
  conventionalMailbox: (podRoot: string) => ({
    mailboxUrl: `${podRoot}mail/folders/inbox.ttl`,
    isFallback: true,
  }),
  discoverMailbox: (_webId: string, podRoot: string) =>
    Promise.resolve({ mailboxUrl: `${podRoot}mail/folders/inbox.ttl`, isFallback: false }),
}));

// Stub the pod-mail Inbox so the header test doesn't drive a live pod fetch.
vi.mock("@jeswr/pod-mail/ui", () => ({
  Inbox: () => <div data-testid="inbox" />,
}));
// Observe the host's loading renderer without Lit's node export limitations.
vi.mock("@jeswr/solid-elements/react", () => ({
  Loading: ({ label }: { label: string }) => <span role="status">{label}</span>,
}));

import { App } from "./App";

const profile: Profile = {
  webId: WEB_ID,
  name: "Alice Mail",
  storages: [POD_ROOT],
  oidcIssuers: [identity.issuer],
};

function renderApp(fake = fakePodAuth(), readProfile = async () => profile) {
  return render(
    <SessionProvider
      appName="Pod Mail"
      getPodAuth={() => Promise.resolve(fake.auth)}
      auth={fake.auth}
      readProfile={readProfile}
    >
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </SessionProvider>,
  );
}

afterEach(() => {
  document.documentElement.removeAttribute("data-solid-extension");
  delete (window as unknown as { solid?: unknown }).solid;
});

describe("App session gate and account control", () => {
  it("renders the full account menu and signs out when the extension is absent", async () => {
    const fake = fakePodAuth();
    fake.auth.restore.mockResolvedValue(identity);
    renderApp(fake);
    await screen.findByTestId("inbox");
    const account = screen.getByRole("button", { name: "Account menu" });
    expect(account).toHaveTextContent("Alice Mail");
    expect(screen.queryByRole("button", { name: /^sign out$/i })).not.toBeInTheDocument();
    fireEvent(account, new MouseEvent("pointerdown", { bubbles: true }));
    const menu = await screen.findByRole("menu");
    expect(menu).toHaveTextContent(WEB_ID);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Sign out" }));
    expect(fake.auth.logout).toHaveBeenCalledTimes(1);
    await screen.findByRole("heading", { name: "Sign in" });
    expect(screen.queryByTestId("inbox")).not.toBeInTheDocument();
  });

  it("keeps working sign-out when the extension owns the account menu", async () => {
    document.documentElement.setAttribute("data-solid-extension", "1");
    const fake = fakePodAuth();
    fake.auth.restore.mockResolvedValue(identity);
    renderApp(fake);
    await screen.findByTestId("inbox");
    expect(screen.queryByRole("button", { name: "Account menu" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /feedback/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(fake.auth.logout).toHaveBeenCalledTimes(1);
    await screen.findByRole("heading", { name: "Sign in" });
    expect(screen.queryByTestId("inbox")).not.toBeInTheDocument();
  });

  it("keeps the host spinner and loading labels through restore and profile loading", async () => {
    const fake = fakePodAuth();
    const restore = deferred<typeof identity | null>();
    const readProfile = deferred<Profile>();
    fake.auth.restore.mockReturnValue(restore.promise);
    const view = renderApp(fake, () => readProfile.promise);
    expect(await screen.findByRole("status")).toHaveTextContent("Restoring your session…");
    expect(screen.queryByTestId("inbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Sign in" })).not.toBeInTheDocument();
    expect(
      view.container.querySelector(
        "main.login-screen[aria-busy=true] > section.login-card > h1 + p.login-sub",
      ),
    ).toContainElement(screen.getByRole("status"));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Pod Mail");
    await act(async () => restore.resolve(identity));
    expect(screen.getByRole("status")).toHaveTextContent("Loading your account…");
    expect(screen.queryByTestId("inbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Sign in" })).not.toBeInTheDocument();
    await act(async () => readProfile.resolve(profile));
    expect(await screen.findByTestId("inbox")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows Mail's login screen when restore finds no session", async () => {
    renderApp();
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Pod Mail sign-in" })).toBeEnabled();
    expect(screen.getByText("to continue to Pod Mail")).toBeVisible();
    expect(screen.queryByTestId("inbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
