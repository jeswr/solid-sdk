// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { FOAF } from "@jeswr/pod-access/requests-solid";
import type { LoginController } from "@jeswr/solid-elements";
import { LiteralFrom, OptionalAs, TermWrapper } from "@rdfjs/wrapper";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DataFactory, Store } from "n3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { publicFetchFor, SessionProvider } from "../../src/auth/SessionContext.js";
import { toTurtle } from "../../src/lib/rdf.js";
import { App } from "../../src/ui/App.jsx";
import { AgentLabel } from "../../src/ui/bits.jsx";
import { BOB, OWNER } from "../fixtures.js";

vi.mock("@jeswr/app-shell", () => ({
  AccountMenu: ({ onSignOut }: { onSignOut: () => void }) => (
    <button type="button" onClick={onSignOut}>
      Sign out
    </button>
  ),
  ThemeToggle: () => null,
  FeedbackButton: () => null,
}));
vi.mock("@jeswr/solid-elements/react", () => ({
  LoginPanel: ({ onSessionChange }: { onSessionChange: (event: unknown) => void }) => (
    <button
      type="button"
      onClick={() => onSessionChange({ detail: { loggedIn: true, webId: OWNER } })}
    >
      Sign in
    </button>
  ),
}));
vi.mock("../../src/ui/useAccessData.js", () => ({
  useAccessData: () => ({
    storages: [],
    nodes: [],
    registrations: [],
    storageRoot: null,
    walking: false,
  }),
}));
vi.mock("../../src/ui/DashboardView.jsx", async () => {
  const { AgentLabel } = await import("../../src/ui/bits.jsx");
  return { DashboardView: () => <AgentLabel agent={BOB} /> };
});

async function profile(name: string) {
  const dataset = new Store();
  OptionalAs.object(
    new TermWrapper(BOB, dataset, DataFactory),
    FOAF.name,
    name,
    LiteralFrom.string,
  );
  return new Response(await toTurtle(dataset), { headers: { "content-type": "text/turtle" } });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("display identity and public session transport", () => {
  it("shows the profile's host alongside a self-chosen name even without showHost", async () => {
    const publicFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(await profile("Trusted clinic"));
    render(
      <SessionProvider session={{ webId: OWNER, fetch: vi.fn(), publicFetch }}>
        <AgentLabel agent={BOB} />
      </SessionProvider>,
    );
    const name = await screen.findByText("Trusted clinic");
    expect(name.parentElement).toHaveTextContent(`Trusted clinic (${new URL(BOB).host})`);
  });

  it.each([
    "unmount",
    "timeout",
  ])("aborts a display fetch on %s and retries on remount", async (reason) => {
    vi.useFakeTimers();
    const publicFetch = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValueOnce(await profile("Recovered"));
    const session = { webId: OWNER, fetch: vi.fn(), publicFetch };
    const view = (mounted: boolean) => (
      <SessionProvider session={session}>
        {mounted ? <AgentLabel agent={BOB} /> : null}
      </SessionProvider>
    );
    const rendered = render(view(true));
    const signal = publicFetch.mock.calls[0]?.[1]?.signal;
    expect(signal?.aborted).toBe(false);
    if (reason === "timeout") {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
    }
    rendered.rerender(view(false));
    expect(signal?.aborted).toBe(true);
    rendered.rerender(view(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("Recovered")).toBeVisible();
    expect(publicFetch).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses the controller's pristine public fetch and clears cached names on logout", async () => {
    const patchedGlobal = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("patched with credentials"));
    const publicFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(await profile("Before logout"))
      .mockResolvedValueOnce(await profile("After logout"));
    const authenticatedFetch = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("private transport"));
    const controller = {
      publicFetch,
      authenticatedFetch,
      logout: vi.fn(async () => {}),
    } as unknown as LoginController;
    render(<App controller={controller} />);
    fireEvent.click(screen.getByText("Sign in"));
    await screen.findByText("Before logout");
    fireEvent.click(screen.getByText("Sign out"));
    await screen.findByText("Sign in");
    fireEvent.click(screen.getByText("Sign in"));
    await screen.findByText("After logout");
    expect(screen.queryByText("Before logout")).not.toBeInTheDocument();
    expect(publicFetch).toHaveBeenCalledTimes(2);
    expect(publicFetch.mock.calls[0]?.[1]).toMatchObject({
      credentials: "omit",
      redirect: "error",
    });
    expect(authenticatedFetch).not.toHaveBeenCalled();
    expect(patchedGlobal).not.toHaveBeenCalled();
  });

  it("never renders a previous account's delayed profile after switching WebID with the same fetch", async () => {
    let finishFirst: (response: Response) => void = () => {};
    const publicFetch = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(await profile("Account B name"));
    const session = { webId: OWNER, fetch: publicFetch, publicFetch };
    const view = (webId: string) => (
      <SessionProvider session={{ ...session, webId }}>
        <AgentLabel agent={BOB} />
      </SessionProvider>
    );
    const rendered = render(view(OWNER));
    await waitFor(() => expect(publicFetch).toHaveBeenCalledTimes(1));
    rendered.rerender(view("https://other.example/#me"));
    await screen.findByText("Account B name");
    finishFirst(await profile("Account A private name"));
    await waitFor(() => expect(screen.getByText("Account B name")).toBeVisible());
    expect(screen.queryByText("Account A private name")).not.toBeInTheDocument();
  });

  it("retries a failed display lookup when the label is loaded again", async () => {
    const publicFetch = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(await profile("Recovered name"));
    const session = { webId: OWNER, fetch: publicFetch, publicFetch };
    const view = (key: string) => (
      <SessionProvider session={session}>
        <AgentLabel key={key} agent={BOB} />
      </SessionProvider>
    );
    const rendered = render(view("first"));
    await waitFor(() => expect(publicFetch).toHaveBeenCalledTimes(1));
    rendered.rerender(view("second"));
    await screen.findByText("Recovered name");
    expect(publicFetch).toHaveBeenCalledTimes(2);
    expect(publicFetchFor(session)).toBe(publicFetchFor(session));
  });
});
