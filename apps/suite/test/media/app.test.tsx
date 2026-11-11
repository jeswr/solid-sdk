// AUTHORED-BY Codex (GPT-6.1 Sol)
// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
} from "../../../../packages/suite-ui/node_modules/@testing-library/react";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(),
  session: {
    mode: "solid",
    webId: "https://pod.example/profile#me",
    storageUrl: "https://pod.example/",
    fetch: vi.fn(),
    subscribe: vi.fn(() => () => {}),
  },
}));
vi.mock("@jeswr/solid-media-log", async (original) => ({
  ...(await original<typeof import("@jeswr/solid-media-log")>()),
  createMediaRepository: async () => ({ load: mocks.load, save: mocks.save }),
}));
vi.mock("@jeswr/suite-ui", async (original) => ({
  ...(await original<typeof import("@jeswr/suite-ui")>()),
  Toaster: () => null,
}));
vi.mock("@/lib/session/pod-session", () => ({
  PodSessionProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/shell/sync/connection-state", () => ({ useConnectionState: () => "online" }));
vi.mock("@/shell/app-frame", () => ({
  AppSessionGuard: ({ children }: { children: ReactNode }) => children,
  AppFrame: ({ children }: { children: ReactNode }) => children,
  AppHeading: ({ children }: { children: ReactNode }) => <h1>{children}</h1>,
  PodSessionGate: ({ children }: { children: (session: typeof mocks.session) => ReactNode }) =>
    children(mocks.session),
}));

import { MediaApp } from "../../src/apps/media/components/media-app";

beforeEach(() => {
  mocks.session.fetch = vi.fn();
  mocks.load.mockReset().mockResolvedValue({ records: [], incomplete: false, skipped: [] });
});
afterEach(cleanup);
it("describes a first-load failure without claiming that any items are already available", async () => {
  mocks.load.mockRejectedValue(new Error("Offline"));
  render(<MediaApp />);
  expect(
    await screen.findByText("We couldn't load your media. Check your connection and try again."),
  ).toBeTruthy();
  expect(screen.queryByText(/Items already loaded remain available/)).toBeNull();
});
it("shows a quiet unreadable-items notice while keeping the readable library", async () => {
  mocks.load.mockResolvedValue({
    records: [
      {
        id: "https://pod.example/media/good",
        url: "https://pod.example/media/good",
        etag: '"1"',
        data: { title: "The Copper Shore", kind: "film", status: "want" },
      },
    ],
    incomplete: true,
    skipped: [{ url: "https://pod.example/media/bad", reason: "not-rdf" }],
  });
  render(<MediaApp />);
  expect(
    await screen.findByText("1 item couldn't be read. Other items are available."),
  ).toBeTruthy();
  expect(screen.getByRole("heading", { name: "The Copper Shore", level: 3 })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Your shelves", level: 2 })).toBeTruthy();
});
