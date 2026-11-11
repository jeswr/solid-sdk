// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "../../../packages/suite-ui/node_modules/@testing-library/react";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { ExportSettings } from "../src/shell/settings/export";

const session = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock("../src/shell/session/accounts-provider", () => ({ useAccounts: () => session.current }));
vi.mock("../src/shell/settings/export-apps", () => ({
  exportApps: async () => [],
  exportRootFolders: async () => [
    { url: "https://pod.example/alice/docs/", label: "docs/" },
    { url: "https://pod.example/alice/photos/", label: "photos/" },
  ],
}));
const root = "https://pod.example/alice/";
let revoke = vi.fn<(url: string) => void>();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const pod = createDemoPod({
    root,
    seed: [
      { path: "docs/hello.txt", body: "hello", contentType: "text/plain" },
      {
        path: "photos/pixel.bin",
        body: new Uint8Array([0, 1]),
        contentType: "application/octet-stream",
      },
    ],
  });
  session.current = {
    active: { id: "alice", storageUrl: root, webId: `${root}profile/card#me` },
    status: "ready",
    fetch: pod.fetch,
    isActiveAccount: () => true,
  };
  revoke = vi.fn<(url: string) => void>();
  URL.createObjectURL = vi.fn(() => "blob:export");
  URL.revokeObjectURL = revoke;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("estimates, selects a folder, exports, shows skipped reasons and clears the download on sign-out", async () => {
  const view = render(<ExportSettings />);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Start export" })).not.toHaveProperty(
      "disabled",
      true,
    ),
  );
  fireEvent.click(screen.getByRole("radio", { name: "Choose folders or apps" }));
  await waitFor(() => expect(screen.getByRole("checkbox", { name: "docs/" })).toBeDefined());
  fireEvent.click(screen.getByRole("checkbox", { name: "docs/" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Start export" })).not.toHaveProperty(
      "disabled",
      true,
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Start export" }));
  await waitFor(() => expect(screen.getByRole("link", { name: "Download ZIP" })).toBeDefined());
  expect(screen.getByRole("link", { name: "Download ZIP" }).getAttribute("download")).toMatch(
    /^pod-export-.*\.zip$/,
  );
  expect(screen.getByText(/items skipped or incomplete/)).toBeDefined();
  expect(screen.queryByText(/Skipped or incomplete items/)).toBeNull();
  session.current = { ...session.current, active: null, status: "signed-out" };
  view.rerender(<ExportSettings />);
  expect(screen.queryByRole("link", { name: "Download ZIP" })).toBeNull();
  expect(screen.getByText("Sign in to export your pod.")).toBeDefined();
  expect(revoke).toHaveBeenCalledWith("blob:export");
});
it("allows cancelling a stalled estimate and retrying", async () => {
  session.current.fetch = () => new Promise<Response>(() => {});
  render(<ExportSettings />);
  fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.getByText("Export cancelled.")).toBeDefined());
  fireEvent.click(screen.getByRole("button", { name: "Refresh estimate" }));
  await waitFor(() => expect(screen.getByText("Estimating your export…")).toBeDefined());
});
it("shows estimate failures and resets private UI immediately on an account switch", async () => {
  session.current.active = { id: "alice", storageUrl: "invalid", webId: "invalid" };
  const view = render(<ExportSettings />);
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("Could not estimate"),
  );
  session.current = {
    ...session.current,
    active: { id: "bob", storageUrl: root, webId: `${root}profile/card#bob` },
    fetch: () => new Promise<Response>(() => {}),
  };
  view.rerender(<ExportSettings />);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByText("Estimating your export…")).toBeDefined();
});

it("keeps the same-account job through status flickers and warns before leaving during export or with a ready download", async () => {
  const original = session.current.fetch as typeof globalThis.fetch;
  let release!: () => void;
  let started!: () => void;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const cancelled = vi.fn();
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    if (String(input).endsWith("docs/hello.txt") && init?.method !== "HEAD") {
      started();
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("hello"));
            release = () => controller.close();
          },
          cancel: cancelled,
        }),
      );
    }
    return original(input, init);
  });
  session.current.fetch = fetch;
  const view = render(<ExportSettings />);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Start export" })).not.toHaveProperty(
      "disabled",
      true,
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Start export" }));
  await entered;
  const warn = () => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  };
  warn();
  session.current = {
    ...session.current,
    active: { ...(session.current.active as object) },
    status: "loading",
    isActiveAccount: () => false,
  };
  view.rerender(<ExportSettings />);
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDefined();
  release();
  await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" })).toBeDefined());
  session.current = {
    ...session.current,
    active: { ...(session.current.active as object) },
    status: "ready",
    isActiveAccount: () => true,
  };
  view.rerender(<ExportSettings />);
  await screen.findByRole("link", { name: "Download ZIP" });
  expect(cancelled).not.toHaveBeenCalled();
  expect(revoke).not.toHaveBeenCalled();
  warn();
  session.current = { ...session.current, status: "loading" };
  view.rerender(<ExportSettings />);
  expect(screen.getByRole("link", { name: "Download ZIP" })).toBeDefined();
  expect(revoke).not.toHaveBeenCalled();
  warn();
  view.unmount();
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
});
