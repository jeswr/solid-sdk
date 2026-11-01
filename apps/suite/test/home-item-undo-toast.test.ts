// AUTHORED-BY Claude Opus 5.5
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { toast } = vi.hoisted(() => {
  const toast = Object.assign(vi.fn(), {
    success: vi.fn((_message: unknown, _options?: unknown) => "toast-1" as string | number),
    error: vi.fn(),
    dismiss: vi.fn(),
  });
  return { toast };
});
vi.mock("@jeswr/suite-ui", async (original) => ({
  ...(await original<typeof import("@jeswr/suite-ui")>()),
  toast,
}));

import { readItem } from "../src/apps/home/components/item/data";
import {
  CLAIM_STALE_MS,
  createDeleteController,
  HOLD_GRACE_MS,
  UNDO_MS,
} from "../src/apps/home/components/item/delete-controller";
import {
  deletionStore,
  offerResumedUndo,
  offerUndo,
} from "../src/apps/home/components/item/use-item-actions";
import { createDemoPod } from "../src/lib/demo-pod/pod";

const root = "https://pod.example/alice/";
const url = `${root}bookmarks/item.ttl`;
const body =
  '<#it> a <http://www.w3.org/2002/01/bookmark#Bookmark>; <http://purl.org/dc/terms/title> "My bookmark".';
async function setup() {
  const pod = createDemoPod({
    root,
    seed: [{ path: "bookmarks/item.ttl", body, contentType: "text/turtle" }],
  });
  const session = {
    mode: "demo",
    storageUrl: root,
    webId: `${root}profile/card#me`,
    displayName: "Alice",
    fetch: pod.fetch,
    subscribe: pod.subscribe,
    reset: async () => {},
  } as const;
  const controller = createDeleteController(session, async () => {});
  const item = (await readItem(session, url)).item;
  return { pod, session, controller, item };
}
/** The toast options this code passes (a subset of Sonner's). */
interface ExternalToast {
  duration?: number;
  action?: unknown;
  onAutoClose?: (toast: unknown) => void;
  onDismiss?: (toast: unknown) => void;
}
/** The options of the most recent Undo toast. */
const lastToast = () => toast.success.mock.calls.at(-1)?.[1] as ExternalToast;
const clickUndo = () =>
  (lastToast().action as { onClick: (event: unknown) => void }).onClick({
    defaultPrevented: false,
  });

let saved: Map<string, string>;
beforeEach(() => {
  vi.useFakeTimers();
  saved = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
    removeItem: (key: string) => saved.delete(key),
  });
  for (const mock of [toast.success, toast.error, toast.dismiss]) mock.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("deletes only when the toast closes, so Undo works for as long as the toast is paused", async () => {
  const { controller, item, pod } = await setup();
  await controller.remove(item, vi.fn());
  offerUndo(controller, url, "Deleted My bookmark");
  expect(toast.success).toHaveBeenCalledWith(
    "Deleted My bookmark",
    expect.objectContaining({
      duration: UNDO_MS,
      action: expect.objectContaining({ label: "Undo" }),
    }),
  );
  // Sonner paused (hover/focus) beyond the undo window: still nothing deleted.
  await vi.advanceTimersByTimeAsync(UNDO_MS * 2);
  expect(pod.has(url)).toBe(true);
  clickUndo();
  await vi.advanceTimersByTimeAsync(0);
  expect(toast.error).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(UNDO_MS + HOLD_GRACE_MS);
  expect(pod.has(url)).toBe(true);
});

it.each([
  "onAutoClose",
  "onDismiss",
] as const)("runs the delete when the toast's %s fires", async (close) => {
  const { controller, item, pod } = await setup();
  await controller.remove(item, vi.fn());
  offerUndo(controller, url, "Deleted My bookmark");
  (lastToast()[close] as (toast: unknown) => void)({});
  await vi.advanceTimersByTimeAsync(0);
  expect(pod.has(url)).toBe(false);
});

it("dismisses the toast when the delete starts another way and says when Undo is too late", async () => {
  const { controller, item, pod } = await setup();
  await controller.remove(item, vi.fn());
  offerUndo(controller, url, "Deleted My bookmark");
  // No toast close ever arrives (e.g. the toaster isn't mounted): the grace timer commits.
  await vi.advanceTimersByTimeAsync(UNDO_MS + HOLD_GRACE_MS);
  expect(pod.has(url)).toBe(false);
  expect(toast.dismiss).toHaveBeenCalledWith("toast-1");
  clickUndo();
  await vi.advanceTimersByTimeAsync(0);
  expect(toast.error).toHaveBeenCalledWith("Too late to undo");
});

it("offers Undo once for deletions resumed after a reload", async () => {
  const { controller, item, pod, session } = await setup();
  await controller.remove(item, vi.fn());
  controller.dispose();
  await vi.advanceTimersByTimeAsync(3_000);
  const reloaded = createDeleteController({ ...session }, async () => {});
  offerResumedUndo(reloaded);
  offerResumedUndo(reloaded);
  expect(toast.success).toHaveBeenCalledOnce();
  expect(toast.success.mock.calls[0]?.[0]).toBe("Deleting item");
  expect(lastToast().duration).toBeGreaterThan(UNDO_MS - 3_500);
  expect(lastToast().duration).toBeLessThanOrEqual(UNDO_MS - 3_000);
  clickUndo();
  await vi.advanceTimersByTimeAsync(UNDO_MS + HOLD_GRACE_MS);
  expect(pod.has(url)).toBe(true);
  expect(saved.size).toBe(0);
});

// AUTHORED-BY Claude Opus 5.5 — fix round 5 (finding 3)
it("offers Undo again when this page takes over a deletion another tab abandoned", async () => {
  const { item, pod, session } = await setup();
  const controller = deletionStore(session);
  await controller.remove(item, vi.fn());
  offerUndo(controller, url, "Deleted My bookmark");
  const key = `suite.home.pending-deletes:${session.webId}\u0000${root}`;
  const [tombstone] = JSON.parse(saved.get(key) as string);
  // Another tab claimed it, then closed before sending its DELETE.
  saved.set(key, JSON.stringify([{ ...tombstone, claim: { by: "closed-tab", at: Date.now() } }]));
  lastToast().onAutoClose?.({});
  await vi.advanceTimersByTimeAsync(0);
  expect(toast.success).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(CLAIM_STALE_MS);
  expect(toast.success).toHaveBeenCalledTimes(2);
  expect(toast.success.mock.calls[1]?.[0]).toBe("Deleting item");
  expect(lastToast().duration).toBe(UNDO_MS);
  clickUndo();
  await vi.advanceTimersByTimeAsync(0);
  expect(toast.error).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(UNDO_MS + HOLD_GRACE_MS);
  expect(pod.has(url)).toBe(true);
  expect(saved.size).toBe(0);
});
