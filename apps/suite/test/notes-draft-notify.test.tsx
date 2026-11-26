// AUTHORED-BY Claude Sonnet 5.5
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, renderHook } from "../../../packages/suite-ui/node_modules/@testing-library/react";
import { createNotesStore } from "../src/apps/notes/lib/model/store";
import { getPendingDrafts } from "../src/apps/notes/state/draft-registry";
import { useNoteDraft } from "../src/apps/notes/state/use-note-draft";
import { createDemoPod } from "../src/lib/demo-pod/pod";

const mocks = vi.hoisted(() => ({ notify: vi.fn(async () => {}) }));
vi.mock("@jeswr/suite-sdk/chips", () => ({ notifySavedHtml: mocks.notify }));
vi.mock("@/lib/session/pod-session", () => ({
  usePodSessionState: () => ({ status: "ready", session: { webId: "https://pod.example/me#me" } }),
}));

const podRoot = "https://pod.example/";
const chip = '<p><span data-type="person" data-id="https://evil.example/profile#me">@x</span></p>';

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  mocks.notify.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

async function setup() {
  const webId = `${podRoot}profile#notify-${Math.random()}`;
  const store = createNotesStore({ fetch: createDemoPod({ root: podRoot }).fetch, podRoot, webId });
  const note = await store.create({ title: "Note", body: "<p>Hello</p>" });
  const pending = getPendingDrafts(webId);
  const hook = renderHook(() => useNoteDraft(note, store, async () => {}, pending));
  return { hook };
}

it("still notifies for a chip the user typed", async () => {
  const { hook } = await setup();
  act(() => hook.result.current.change({ body: chip }));
  await act(async () => {
    await hook.result.current.flush();
  });
  expect(mocks.notify).toHaveBeenCalledOnce();
});

it("never re-sends mention notifications for chips that a restore brings back (F2)", async () => {
  const { hook } = await setup();
  act(() => hook.result.current.change({ body: chip, preserveCurrent: true }));
  await act(async () => {
    await hook.result.current.flush();
  });
  expect(mocks.notify).not.toHaveBeenCalled();
});
