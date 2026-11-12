// AUTHORED-BY Codex (GPT-6.1 Sol)
// @vitest-environment jsdom
import { Blob as NodeBlob } from "node:buffer";

import { WatchAction } from "@jeswr/pod-connectors/core/vocab";
import { mediaRepository } from "@jeswr/solid-media-log";
import { StorageError, toStorageError } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { DataFactory, Store } from "n3";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "../../../../packages/suite-ui/node_modules/@testing-library/react";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
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
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
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
  mocks.save.mockReset();
  mocks.toastError.mockReset();
  mocks.toastSuccess.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
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
    incomplete: false,
    skipped: [{ url: "https://pod.example/media/bad", reason: "not-rdf" }],
  });
  render(<MediaApp />);
  expect(
    await screen.findByText("1 item couldn't be read. Other items are available."),
  ).toBeTruthy();
  expect(screen.getByRole("heading", { name: "The Copper Shore", level: 3 })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Your shelves", level: 2 })).toBeTruthy();
  expect(screen.queryByText(/This is a partial library/)).toBeNull();
});
async function importCsv() {
  fireEvent.click(screen.getByRole("button", { name: /Import CSV/ }));
  const file = new File([], "diary.csv", { type: "text/csv" });
  Object.defineProperty(file, "arrayBuffer", {
    value: async () => new TextEncoder().encode("Name,Year\nA New Film,2025").buffer,
  });
  fireEvent.change(screen.getByLabelText("CSV file (up to 4 MiB, 5,000 rows)"), {
    target: { files: [file] },
  });
  await screen.findByText(/1 ready to import/);
  fireEvent.click(screen.getByRole("button", { name: "Import 1 item" }));
}
it("explains why nothing was imported when the duplicate scan leaves a source unscanned", async () => {
  mocks.load.mockImplementation(async (options) => ({
    records: [],
    incomplete: !!options?.complete,
    skipped: options?.complete ? [{ url: "https://pod.example/source/", reason: "network" }] : [],
  }));
  render(<MediaApp />);
  await screen.findByRole("heading", { name: "Your shelves" });
  await importCsv();
  await waitFor(() =>
    expect(mocks.toastError).toHaveBeenCalledWith(
      "Couldn't check your whole library for duplicates, so nothing was imported. Refresh and try again.",
    ),
  );
  expect(mocks.save).not.toHaveBeenCalled();
  expect(mocks.toastSuccess).not.toHaveBeenCalled();
});
it("refuses an import with the explanatory toast when an entry returns 429 during duplicate checking", async () => {
  vi.stubGlobal("Blob", NodeBlob);
  const storage = createMemoryStorage({ root: mocks.session.storageUrl, protocol: "solid" });
  const repo = mediaRepository(storage, {
    find: async () => [],
    findAll: async () => new Map(),
    register: async () => undefined,
    unregister: async () => {},
    listClasses: async () => [],
  });
  const existing = await repo.save({
    title: "A New Film",
    kind: "film",
    status: "want",
    year: 2025,
  });
  const read = storage.readRdf.bind(storage);
  let checking = false;
  vi.spyOn(storage, "readRdf").mockImplementation((url, options) =>
    checking && url === existing.url
      ? Promise.reject(toStorageError("GET", url, new Response(null, { status: 429 })))
      : read(url, options),
  );
  mocks.load.mockImplementation((options) => {
    checking = !!options?.complete;
    return repo.load(options);
  });
  mocks.save.mockImplementation(repo.save);
  render(<MediaApp />);
  await screen.findByRole("heading", { name: "A New Film", level: 3 });
  await importCsv();
  await waitFor(() =>
    expect(mocks.toastError).toHaveBeenCalledWith(
      "Couldn't check your whole library for duplicates, so nothing was imported. Refresh and try again.",
    ),
  );
  expect(mocks.save).not.toHaveBeenCalled();
  expect(mocks.toastSuccess).not.toHaveBeenCalled();
  expect((await read(existing.url as string)).etag).toBe(existing.etag);
});
it("loads a connector WatchAction, non-RDF file and 403 item as a complete scan, reports two rejections and imports", async () => {
  vi.stubGlobal("Blob", NodeBlob);
  const storage = createMemoryStorage({ root: mocks.session.storageUrl, protocol: "solid" });
  const repo = mediaRepository(storage, {
    find: async () => [],
    findAll: async () => new Map(),
    register: async () => undefined,
    unregister: async () => {},
    listClasses: async () => [],
  });
  const forbidden = await repo.save({ title: "Private", kind: "film", status: "want" });
  await storage.create(`${storage.root}media/`, "notes", { contentType: "text/plain" });
  const dataset = new Store();
  const watch = new WatchAction(`${storage.root}takeout#watch`, dataset, DataFactory).mark();
  watch.name = "A fictional stream";
  const connector = await storage.create(`${storage.root}media/`, null, {
    contentType: "text/turtle",
  });
  await storage.writeRdf(connector.url, dataset, {
    contentType: "text/turtle",
    ifMatch: connector.etag as string,
  });
  const read = storage.readRdf.bind(storage);
  vi.spyOn(storage, "readRdf").mockImplementation((url, options) =>
    url === forbidden.url
      ? Promise.reject(new StorageError("forbidden", { url, method: "GET", status: 403 }))
      : read(url, options),
  );
  mocks.load.mockImplementation(repo.load);
  mocks.save.mockImplementation(repo.save);
  render(<MediaApp />);
  expect(
    await screen.findByText("2 items couldn't be read. Other items are available."),
  ).toBeTruthy();
  expect(screen.queryByText(/This is a partial library/)).toBeNull();
  await importCsv();
  await waitFor(() =>
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Imported 1 · skipped 0 · failed 0"),
  );
  expect(mocks.save).toHaveBeenCalledOnce();
  expect(mocks.toastError).not.toHaveBeenCalled();
  expect(screen.queryByText(/This is a partial library/)).toBeNull();
});
it("leaves the first-load skeleton and shows the existing error copy when initialisation times out", async () => {
  const storage = createMemoryStorage({ root: mocks.session.storageUrl, protocol: "solid" });
  let started!: () => void;
  const waiting = new Promise<void>((resolve) => {
    started = resolve;
  });
  vi.spyOn(storage, "head").mockImplementation(() => {
    started();
    return new Promise(() => {});
  });
  const repo = mediaRepository(storage, {
    find: async () => [],
    findAll: async () => new Map(),
    register: async () => undefined,
    unregister: async () => {},
    listClasses: async () => [],
  });
  mocks.load.mockImplementation(repo.load);
  const controller = new AbortController();
  const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
  try {
    render(<MediaApp />);
    await waiting;
    controller.abort(new DOMException("Timed out", "TimeoutError"));
    expect(
      await screen.findByText("We couldn't load your media. Check your connection and try again."),
    ).toBeTruthy();
    expect(screen.queryByText(/Items already loaded remain available/)).toBeNull();
  } finally {
    timeout.mockRestore();
  }
});
