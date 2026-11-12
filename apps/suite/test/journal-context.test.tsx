// AUTHORED-BY Codex (GPT-6.1 Sol)
// @vitest-environment jsdom
import { JournalPrivacyError, type JournalStore } from "@jeswr/solid-journal";
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
    makePrivate: vi.fn(async () => {}),
    list: vi.fn(async () => []),
    read: vi.fn(),
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
        fallback={(error, retry, makePrivate) => (
          <button type="button" onClick={makePrivate ?? retry}>
            {error ? (makePrivate ? "Make my journal private" : "Retry opening") : "Opening"}
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

it("offers explicit privacy repair without seeding or reading shared content", async () => {
  vi.mocked(store.initialize).mockRejectedValueOnce(
    new JournalPrivacyError("shared", undefined, true),
  );
  await render();
  expect(host.textContent).toBe("Make my journal private");
  expect(store.makePrivate).not.toHaveBeenCalled();
  expect(ensureSample).not.toHaveBeenCalled();
  expect(store.list).not.toHaveBeenCalled();
  await act(async () => host.querySelector("button")?.click());
  expect(store.makePrivate).toHaveBeenCalledOnce();
  expect(host.textContent).toBe("0 entries");
});

it("retains the repair action when making private fails", async () => {
  vi.mocked(store.initialize).mockRejectedValueOnce(
    new JournalPrivacyError("shared", undefined, true),
  );
  vi.mocked(store.makePrivate).mockRejectedValueOnce(new Error("offline"));
  await render();
  await act(async () => host.querySelector("button")?.click());
  expect(host.textContent).toBe("Make my journal private");
  expect(ensureSample).not.toHaveBeenCalled();
});

it("passes the actionable privacy explanation to the boot screen", async () => {
  const message =
    "The journal folder and its entries have different permissions. Review both in Drive.";
  vi.mocked(store.initialize).mockRejectedValueOnce(new JournalPrivacyError(message));
  await act(async () =>
    root.render(
      <JournalProvider
        session={session}
        fallback={(error, _retry, _repair, explanation) => <p>{error ? explanation : "Opening"}</p>}
      >
        <Probe />
      </JournalProvider>,
    ),
  );
  expect(host.textContent).toBe(message);
  expect(store.makePrivate).not.toHaveBeenCalled();
  expect(store.list).not.toHaveBeenCalled();
});
