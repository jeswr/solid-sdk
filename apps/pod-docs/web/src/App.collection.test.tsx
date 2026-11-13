// AUTHORED-BY Codex GPT-6
import type { SignedInSession } from "@jeswr/app-session/react";
import type { DocumentBrowserProps } from "@jeswr/pod-docs/ui";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "./App";

const fixtures = vi.hoisted(() => ({
  session: {
    webId: "https://alice.example/#me",
    podRoot: "https://storage.example/pod/",
    podRootIsFallback: false,
  },
  browser: undefined as DocumentBrowserProps | undefined,
  loopback: false,
  fetch: (async () => new Response()) as typeof fetch,
}));
vi.mock("@jeswr/app-session/react", async (original) => ({
  ...(await original<typeof import("@jeswr/app-session/react")>()),
  // These tests supply a signed-in fixture; the gate is exercised in App.header.test.tsx.
  SessionGate: ({ children }: { children: (signedIn: SignedInSession) => ReactNode }) =>
    children({ webId: fixtures.session.webId, session: fixtures.session }),
  useSession: () => ({
    webId: fixtures.session.webId,
    session: fixtures.session,
    fetch: fixtures.fetch,
    ready: true,
  }),
}));
vi.mock("@jeswr/app-session", () => ({ allowInsecureLoopback: () => fixtures.loopback }));
vi.mock("@jeswr/app-shell", () => ({
  AccountControl: () => null,
  FeedbackButton: () => null,
  ThemeToggle: () => null,
}));
vi.mock("@jeswr/pod-docs/ui", () => ({
  DocumentBrowser: (props: DocumentBrowserProps) => {
    fixtures.browser = props;
    return <div data-testid="collection">{props.container ?? "unselected"}</div>;
  },
}));

beforeEach(() => {
  localStorage.clear();
  fixtures.loopback = false;
  fixtures.session = {
    webId: "https://alice.example/#me",
    podRoot: "https://storage.example/pod/",
    podRootIsFallback: false,
  };
});

it.each([
  false,
  true,
])("threads pod-auth's development loopback opt-in (%s) into the document browser", (loopback) => {
  fixtures.loopback = loopback;
  render(<App />);
  expect(fixtures.browser?.allowInsecureLoopback).toBe(loopback);
});

it("passes pod-auth's fetch to the document browser explicitly", () => {
  render(<App />);
  expect(fixtures.browser?.fetch).toBe(fixtures.fetch);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it("restores the assigned opaque collection on host remount and isolates WebIDs and roots", () => {
  const alice = { ...fixtures.session };
  let view = render(<App />);
  expect(screen.getByTestId("collection")).toHaveTextContent("unselected");
  const assigned = `${alice.podRoot}server-assigned`;
  act(() => fixtures.browser?.onContainerChange?.({ ...alice, container: assigned }));
  expect(screen.getByTestId("collection")).toHaveTextContent(assigned);
  view.unmount();
  view = render(<App />);
  expect(fixtures.browser?.container).toBe(assigned);
  fixtures.session = { ...alice, webId: "https://bob.example/#me" };
  view.rerender(<App />);
  expect(fixtures.browser?.container).toBeUndefined();
  fixtures.session = { ...alice, podRoot: "https://other.example/" };
  view.rerender(<App />);
  expect(fixtures.browser?.container).toBeUndefined();
  fixtures.session = alice;
  view.rerender(<App />);
  expect(fixtures.browser?.container).toBe(assigned);
});

it("saves late collection assignments under the identity captured by the originating store", () => {
  const alice = { ...fixtures.session };
  const view = render(<App />);
  const late = fixtures.browser?.onContainerChange;
  fixtures.session = { ...alice, webId: "https://bob.example/#me" };
  view.rerender(<App />);
  act(() => late?.({ ...alice, container: `${alice.podRoot}late-id` }));
  expect(fixtures.browser?.container).toBeUndefined();
  fixtures.session = alice;
  view.rerender(<App />);
  expect(fixtures.browser?.container).toBe(`${alice.podRoot}late-id`);
});

it("refuses to create a replacement collection when browser storage cannot be read", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  render(<App />);
  expect(screen.getByRole("alert")).toHaveTextContent("Unable to restore or save");
  expect(screen.queryByTestId("collection")).toBeNull();
});

it("surfaces persistence failure before another collection can be created", () => {
  render(<App />);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("quota");
  });
  act(() =>
    expect(() =>
      fixtures.browser?.onContainerChange?.({
        ...fixtures.session,
        container: `${fixtures.session.podRoot}assigned`,
      }),
    ).toThrow("Unable to save"),
  );
  expect(screen.queryByTestId("collection")).toBeNull();
  expect(screen.getByRole("alert")).toBeInTheDocument();
});

it.each([
  "https://foreign.example/collection",
  "https://storage.example/pod-other/collection",
  "not a URL",
])("rejects invalid saved collection %s", (container) => {
  localStorage.setItem(
    `pod-docs:collection:${JSON.stringify([fixtures.session.webId, fixtures.session.podRoot])}`,
    container,
  );
  render(<App />);
  expect(screen.queryByTestId("collection")).toBeNull();
  expect(screen.getByRole("alert")).toBeInTheDocument();
});
