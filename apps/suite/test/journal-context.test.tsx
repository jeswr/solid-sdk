// AUTHORED-BY Codex (GPT-6.1 Sol)
// @vitest-environment jsdom
import type { JournalStore } from "@jeswr/solid-journal";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ensureSample } from "../src/apps/journal/demo/sample";
import { openJournalData } from "../src/apps/journal/lib/data/store";
import { JournalProvider, useJournal } from "../src/apps/journal/state/journal-context";
import type { PodSession } from "../src/lib/session/pod-session";

vi.mock("../src/apps/journal/demo/sample", () => ({ ensureSample: vi.fn(async () => {}) }));
vi.mock("../src/apps/journal/lib/data/store", () => ({ openJournalData: vi.fn() }));
vi.mock("@jeswr/suite-ui", () => ({ toast: { error: vi.fn() } }));
const session = {
  mode: "demo",
  webId: "https://pod.example/profile#me",
  storageUrl: "https://pod.example/",
  fetch: vi.fn(),
  subscribe: vi.fn(() => vi.fn()),
} as unknown as PodSession;
let root: Root;
let host: HTMLDivElement;
let store: JournalStore;
function Probe() {
  const value = useJournal();
  return <p>{value.loading ? "Loading" : `${value.entries.length} entries`}</p>;
}
beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  store = {
    container: "https://pod.example/journal/",
    initialize: vi.fn(async () => {}),
    list: vi.fn(async () => []),
    save: vi.fn(),
    remove: vi.fn(),
    attach: vi.fn(),
    photo: vi.fn(),
  };
  vi.mocked(openJournalData).mockResolvedValue(store);
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
async function render() {
  await act(async () =>
    root.render(
      <JournalProvider
        session={session}
        fallback={(error, retry) => (
          <button type="button" onClick={retry}>
            {error ? "Retry opening" : "Opening"}
          </button>
        )}
      >
        <Probe />
      </JournalProvider>,
    ),
  );
}
it("initialises, seeds and loads, subscribes only to journal changes, and cleans up", async () => {
  await render();
  expect(host.textContent).toBe("0 entries");
  expect(ensureSample).toHaveBeenCalledWith(session, store);
  const notify = vi.mocked(session.subscribe).mock.calls[0]?.[0];
  await act(async () => notify?.("https://pod.example/other/file"));
  expect(store.list).toHaveBeenCalledOnce();
  await act(async () => notify?.("https://pod.example/journal/change.ttl"));
  expect(store.list).toHaveBeenCalledTimes(2);
  await act(async () => root.unmount());
  expect(vi.mocked(session.subscribe).mock.results[0]?.value).toHaveBeenCalledOnce();
  root = createRoot(host);
});
it("shows a recoverable setup error and retries", async () => {
  vi.mocked(openJournalData).mockRejectedValueOnce(new Error("offline"));
  await render();
  expect(host.textContent).toBe("Retry opening");
  await act(async () => host.querySelector("button")?.click());
  expect(host.textContent).toBe("0 entries");
});
it("doesn't install subscriptions after unmounting during setup", async () => {
  let resolve!: (store: JournalStore) => void;
  vi.mocked(openJournalData).mockReturnValueOnce(
    new Promise((yes) => {
      resolve = yes;
    }),
  );
  await render();
  expect(host.textContent).toBe("Opening");
  await act(async () => root.unmount());
  await act(async () => resolve(store));
  expect(session.subscribe).not.toHaveBeenCalled();
  root = createRoot(host);
});
it("requires a context", () => {
  expect(() => renderToString(<Probe />)).toThrow("Journal provider");
});
