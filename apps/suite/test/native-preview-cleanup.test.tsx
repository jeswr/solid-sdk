// AUTHORED-BY Claude Opus 5.5
import { expect, it, vi } from "vitest";
import { ClearOnAccountChange, PreviewIsolation } from "../src/components/native-preview-cleanup";
import { act, click, deferred, h, mount } from "./drive-ui-dom";

async function track(first: string | undefined) {
  const clear = vi.fn();
  const view = await mount(h(ClearOnAccountChange, { activeId: first, clear }));
  return {
    clear,
    to: (activeId: string | undefined) => view.render(h(ClearOnAccountChange, { activeId, clear })),
  };
}

it("never clears on mount, with or without a signed-in account", async () => {
  expect((await track(undefined)).clear).not.toHaveBeenCalled();
  expect((await track("alice")).clear).not.toHaveBeenCalled();
});

it("does not clear on the first sign-in or a re-render for the same account", async () => {
  const { clear, to } = await track(undefined);
  await to("alice");
  await to("alice");
  expect(clear).not.toHaveBeenCalled();
});

it("clears on sign-out and on every switch away from a signed-in account", async () => {
  const { clear, to } = await track("alice");
  await to(undefined);
  expect(clear).toHaveBeenCalledTimes(1);
  await to("bob");
  expect(clear).toHaveBeenCalledTimes(1);
  await to("carol");
  expect(clear).toHaveBeenCalledTimes(2);
  await to("alice");
  expect(clear).toHaveBeenCalledTimes(3);
});

async function isolate(clear: () => Promise<void>) {
  const view = await mount(h(PreviewIsolation, { activeId: "alice", clear }));
  return {
    to: (activeId: string | undefined) => view.render(h(PreviewIsolation, { activeId, clear })),
    dialog: () => view.host.querySelector('[role="alertdialog"]'),
    button: () => view.host.querySelector("button") as HTMLButtonElement,
  };
}

it("shows nothing after a successful clear", async () => {
  const clear = vi.fn(async () => undefined);
  const view = await isolate(clear);
  await view.to("bob");
  expect(clear).toHaveBeenCalledTimes(1);
  expect(view.dialog()).toBeNull();
});

it("blocks the app after a failed clear until a retry succeeds", async () => {
  const clear = vi.fn<() => Promise<void>>(async () => {
    throw new Error("cannot delete");
  });
  const view = await isolate(clear);
  await view.to("bob");
  expect(view.dialog()?.getAttribute("aria-modal")).toBe("true");
  expect(view.dialog()?.textContent).toContain("Can't clear the previous account's files");

  await click(view.button());
  expect(clear).toHaveBeenCalledTimes(2);
  expect(view.dialog()).not.toBeNull();

  const retry = deferred<void>();
  clear.mockImplementationOnce(() => retry.promise);
  await click(view.button());
  expect(view.button().disabled).toBe(true);
  expect(view.button().textContent).toBe("Clearing…");
  expect(view.dialog()).not.toBeNull();
  await act(async () => retry.resolve());
  expect(view.dialog()).toBeNull();
});

it("lets only the latest clear decide, so a slow earlier success never unblocks", async () => {
  const first = deferred<void>();
  const clear = vi
    .fn<() => Promise<void>>()
    .mockImplementationOnce(() => first.promise)
    .mockRejectedValueOnce(new Error("cannot delete"));
  const view = await isolate(clear);
  await view.to("bob");
  await view.to("carol");
  expect(view.dialog()).not.toBeNull();
  await act(async () => first.resolve());
  expect(view.dialog()).not.toBeNull();
});
