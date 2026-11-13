// AUTHORED-BY GPT-6.1 Sol
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionGate } from "../src/SessionGate.js";
import type { SessionContextValue } from "../src/SessionProvider.js";

const state = vi.hoisted(() => ({
  webId: null as string | null,
  session: null as SessionContextValue["session"],
  restoringSession: false,
  ready: false,
  error: null as string | null,
}));
vi.mock("../src/SessionProvider.js", () => ({ useSession: () => state }));
afterEach(cleanup);

describe("SessionGate", () => {
  // Each identity/profile/startup combination pins the copied apps' presentation contract.
  it.each([
    [false, false, false, false, false, "account"],
    [false, false, false, false, true, "login"],
    [false, false, false, true, false, "login"],
    [false, false, false, true, true, "login"],
    [false, false, true, false, false, "restore"],
    [false, false, true, false, true, "restore"],
    [false, false, true, true, false, "restore"],
    [false, false, true, true, true, "restore"],
    [false, true, false, false, false, "account"],
    [false, true, false, false, true, "login"],
    [false, true, false, true, false, "login"],
    [false, true, false, true, true, "login"],
    [false, true, true, false, false, "restore"],
    [false, true, true, false, true, "restore"],
    [false, true, true, true, false, "restore"],
    [false, true, true, true, true, "restore"],
    [true, false, false, false, false, "account"],
    [true, false, false, false, true, "account"],
    [true, false, false, true, false, "account"],
    [true, false, false, true, true, "account"],
    [true, false, true, false, false, "restore"],
    [true, false, true, false, true, "restore"],
    [true, false, true, true, false, "restore"],
    [true, false, true, true, true, "restore"],
    [true, true, false, false, false, "content"],
    [true, true, false, false, true, "content"],
    [true, true, false, true, false, "content"],
    [true, true, false, true, true, "content"],
    [true, true, true, false, false, "content"],
    [true, true, true, false, true, "content"],
    [true, true, true, true, false, "content"],
    [true, true, true, true, true, "content"],
  ] as const)("webId=%s profile=%s restoring=%s ready=%s error=%s → %s", (hasWebId, hasSession, restoringSession, ready, hasError, expected) => {
    state.webId = hasWebId ? "https://alice.example/#me" : null;
    state.session = hasSession
      ? {
          webId: "https://alice.example/#me",
          podRoot: "https://alice.example/",
          podRootIsFallback: false,
        }
      : null;
    Object.assign(state, { restoringSession, ready, error: hasError ? "Startup failed" : null });
    const Login = vi.fn(() => <div>Configured login</div>);
    const Content = vi.fn(() => <div>Private content</div>);
    const { container } = render(
      <SessionGate appName="Example" login={<Login />}>
        <Content />
      </SessionGate>,
    );
    expect(Login).toHaveBeenCalledTimes(expected === "login" ? 1 : 0);
    expect(Content).toHaveBeenCalledTimes(expected === "content" ? 1 : 0);
    if (expected === "account" || expected === "restore") {
      expect(screen.getByRole("status")).toHaveTextContent(
        expected === "restore" ? "Restoring your session…" : "Loading your account…",
      );
      expect(
        container.querySelector(
          "main.login-screen[aria-busy=true] > section.login-card > h1 + p.login-sub",
        ),
      ).toContainElement(screen.getByRole("status"));
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Example");
    } else {
      expect(screen.queryByRole("status")).toBeNull();
      expect(container.querySelector("[aria-busy]")).toBeNull();
    }
  });

  it.each([
    false,
    true,
  ])("passes the loading label to the host renderer (restoring=%s)", (restoringSession) => {
    Object.assign(state, {
      webId: null,
      session: null,
      ready: false,
      error: null,
      restoringSession,
    });
    const renderLoading = vi.fn((label: string) => <em>{label}</em>);
    const view = render(
      <SessionGate appName="Example" login="Sign in" renderLoading={renderLoading}>
        Private content
      </SessionGate>,
    );
    const label = restoringSession ? "Restoring your session…" : "Loading your account…";
    expect(renderLoading).toHaveBeenCalledWith(label);
    expect(view.container.querySelector("p.login-sub > em")).toHaveTextContent(label);
    renderLoading.mockClear();
    state.ready = true;
    state.restoringSession = false;
    view.rerender(
      <SessionGate appName="Example" login="Sign in" renderLoading={renderLoading}>
        Private content
      </SessionGate>,
    );
    expect(screen.getByText("Sign in")).toBeInTheDocument();
    expect(renderLoading).not.toHaveBeenCalled();
  });

  it("hands render-function children the non-null identity, and never calls them while signed out", () => {
    const session = {
      webId: "https://alice.example/#me",
      podRoot: "https://alice.example/",
      podRootIsFallback: false,
    };
    const content = vi.fn(({ webId }: { webId: string }) => <p>Signed in as {webId}</p>);
    Object.assign(state, {
      webId: null,
      session: null,
      ready: true,
      error: null,
      restoringSession: false,
    });
    const view = render(
      <SessionGate appName="Example" login="Sign in">
        {content}
      </SessionGate>,
    );
    expect(content).not.toHaveBeenCalled();
    Object.assign(state, { webId: session.webId, session });
    view.rerender(
      <SessionGate appName="Example" login="Sign in">
        {content}
      </SessionGate>,
    );
    expect(content).toHaveBeenCalledWith({ webId: session.webId, session });
    expect(screen.getByText(`Signed in as ${session.webId}`)).toBeInTheDocument();
  });
});
