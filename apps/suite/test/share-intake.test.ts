// AUTHORED-BY Codex GPT-6
import { createShareInbox, type ShareBatch, type ShareIntakePlugin } from "@jeswr/suite-native";
import { afterEach, expect, it, vi } from "vitest";
import { createShareIntake } from "../src/shell/share/intake";

const nativePlugin = vi.hoisted(() => ({ getPending: vi.fn(async () => ({ batches: [] })) }));
vi.mock("@jeswr/suite-native/capacitor", () => ({ shareIntakePlugin: nativePlugin }));
afterEach(() => {
  vi.stubGlobal("Capacitor", undefined);
  vi.stubGlobal("suiteShareIntakeFixture", undefined);
  vi.unstubAllEnvs();
  nativePlugin.getPending.mockClear();
});
const batch: ShareBatch = {
  id: "pending-1",
  receivedAt: "2026-11-10T12:00:00.000Z",
  items: [{ kind: "text", text: "Hello" }],
};
function plugin(): ShareIntakePlugin {
  return {
    getPending: vi.fn(async () => ({ batches: [batch] })),
    acknowledge: vi.fn(async () => {}),
    readChunk: vi.fn(),
    addListener: vi.fn(),
  };
}

it("does not resurrect an acknowledged batch from a stale concurrent pending read", async () => {
  const bridge = plugin();
  const intake = createShareIntake(async () => createShareInbox(bridge));
  await intake.refresh();
  let deliver!: (value: { batches: ShareBatch[] }) => void;
  const delayed = new Promise<{ batches: ShareBatch[] }>((resolve) => {
    deliver = resolve;
  });
  vi.mocked(bridge.getPending).mockImplementationOnce(() => delayed);
  const refresh = intake.refresh();
  await intake.discard(batch);
  deliver({ batches: [batch] });
  await refresh;
  expect(intake.getSnapshot().batches).toEqual([]);
  expect(bridge.acknowledge).toHaveBeenCalledTimes(1);
});

it("can retry a bridge import failure without losing the pending batch", async () => {
  const load = vi.fn(async () => createShareInbox(plugin()));
  load.mockRejectedValueOnce(new Error("unavailable"));
  const intake = createShareIntake(load);
  await intake.refresh();
  expect(intake.getSnapshot().error).toBe(true);
  await intake.refresh();
  expect(intake.getSnapshot().error).toBe(false);
  expect(intake.getSnapshot().batches).toEqual([batch]);
});

it.each([
  "0",
  "1",
])("accepts a fixture bridge only in an explicitly enabled fixture build (%s)", async (flag) => {
  vi.resetModules();
  vi.stubGlobal("Capacitor", { isNativePlatform: () => true, getPlatform: () => "ios" });
  const fixture = plugin();
  vi.stubGlobal("suiteShareIntakeFixture", fixture);
  vi.stubEnv("NEXT_PUBLIC_DEV_FIXTURES", flag);
  const { nativeShareIntake } = await import("../src/shell/share/intake");
  await nativeShareIntake.refresh();
  if (flag === "1") {
    expect(fixture.getPending).toHaveBeenCalledTimes(1);
    expect(nativePlugin.getPending).not.toHaveBeenCalled();
  } else {
    expect(fixture.getPending).not.toHaveBeenCalled();
    expect(nativePlugin.getPending).toHaveBeenCalledTimes(1);
  }
});
