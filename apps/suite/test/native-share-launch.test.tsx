// AUTHORED-BY Codex GPT-6
import { createShareInbox, type ShareBatch, type ShareIntakePlugin } from "@jeswr/suite-native";
import { afterEach, expect, it, vi } from "vitest";
import { NativeShareLaunch } from "../src/components/native-share-launch";
import { createShareIntake } from "../src/shell/share/intake";
import { act, h, mount } from "./drive-ui-dom";

const route = vi.hoisted(() => ({ push: vi.fn(), pathname: "/drive/my" }));
vi.mock("next/navigation", () => ({ useRouter: () => route, usePathname: () => route.pathname }));
afterEach(() => {
  route.push.mockClear();
  route.pathname = "/drive/my";
  vi.stubGlobal("Capacitor", undefined);
});
const native = () =>
  vi.stubGlobal("Capacitor", { isNativePlatform: () => true, getPlatform: () => "android" });
function batch(id: string, receivedAt = "2026-11-10T12:00:00Z"): ShareBatch {
  return { id, receivedAt, items: [{ kind: "text", text: "Shared text" }] };
}
function fixture(batches: ShareBatch[] = []) {
  let notify: (raw: unknown) => void = () => {};
  const remove = vi.fn(async () => {});
  const plugin: ShareIntakePlugin = {
    getPending: vi.fn(async () => ({ batches })),
    readChunk: vi.fn(),
    acknowledge: vi.fn(async () => {}),
    addListener: vi.fn(async (_event, callback) => {
      notify = callback;
      return { remove };
    }),
  };
  const intake = createShareIntake(async () => createShareInbox(plugin));
  return { intake, plugin, remove, emit: (next: ShareBatch) => notify(next) };
}

it("is inert on web, even when pending batches were previously claimed", async () => {
  vi.stubGlobal("Capacitor", undefined);
  const test = fixture([batch("one")]);
  await test.intake.refresh();
  vi.mocked(test.plugin.getPending).mockClear();
  await mount(h(NativeShareLaunch, { intake: test.intake }));
  expect(test.plugin.getPending).not.toHaveBeenCalled();
  expect(test.plugin.addListener).not.toHaveBeenCalled();
  expect(route.push).not.toHaveBeenCalled();
});

it("checks native startup but does not route without pending batches", async () => {
  native();
  const test = fixture();
  await mount(h(NativeShareLaunch, { intake: test.intake }));
  expect(test.plugin.getPending).toHaveBeenCalledTimes(1);
  expect(route.push).not.toHaveBeenCalled();
});

it("routes pending batches oldest first, deduplicates events, and retains them across reads", async () => {
  native();
  const older = batch("older", "2026-11-09T12:00:00Z");
  const newer = batch("newer");
  const test = fixture([newer, older]);
  await mount(h(NativeShareLaunch, { intake: test.intake }));
  expect(route.push).toHaveBeenCalledWith("/share");
  expect(test.intake.getSnapshot().batches.map((batch) => batch.id)).toEqual(["older", "newer"]);
  await act(async () => {
    test.emit(older);
    await test.intake.refresh();
  });
  expect(test.intake.getSnapshot().batches).toHaveLength(2);
  await act(() => test.intake.discard(older));
  expect(test.intake.getSnapshot().batches[0]?.id).toBe("newer");
});

it("checks every resume and visibility return, and reacts to shareReceived", async () => {
  native();
  const test = fixture();
  const view = await mount(h(NativeShareLaunch, { intake: test.intake }));
  vi.mocked(test.plugin.getPending).mockResolvedValue({ batches: [batch("resumed")] });
  await act(() => {
    document.dispatchEvent(new Event("resume"));
  });
  expect(route.push).toHaveBeenCalledWith("/share");
  route.push.mockClear();
  route.pathname = "/share";
  await view.render(h(NativeShareLaunch, { intake: test.intake }));
  await act(() => {
    test.emit(batch("live"));
  });
  expect(test.intake.getSnapshot().batches.map((batch) => batch.id)).toEqual(["resumed", "live"]);
  expect(route.push).not.toHaveBeenCalled();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  await act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(test.plugin.getPending).toHaveBeenCalledTimes(3);
  await view.unmount();
  expect(test.remove).toHaveBeenCalledTimes(1);
  await act(() => document.dispatchEvent(new Event("resume")));
  expect(test.plugin.getPending).toHaveBeenCalledTimes(3);
});

it("does not interrupt sign-in while shares remain pending", async () => {
  native();
  route.pathname = "/signin";
  const test = fixture([batch("one")]);
  await mount(h(NativeShareLaunch, { intake: test.intake }));
  expect(route.push).not.toHaveBeenCalled();
  expect(test.plugin.acknowledge).not.toHaveBeenCalled();
});

it("keeps a bridge error recoverable on the next resume", async () => {
  native();
  const test = fixture([batch("one")]);
  vi.mocked(test.plugin.getPending).mockRejectedValueOnce(new Error("unavailable"));
  await mount(h(NativeShareLaunch, { intake: test.intake }));
  expect(test.intake.getSnapshot().error).toBe(true);
  expect(route.push).not.toHaveBeenCalled();
  await act(() => document.dispatchEvent(new Event("resume")));
  expect(route.push).toHaveBeenCalledWith("/share");
});
