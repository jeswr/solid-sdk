// AUTHORED-BY Claude Opus 5.5
import { expect, it, vi } from "vitest";
import { ClearOnAccountChange } from "../src/components/native-preview-cleanup";
import { h, mount } from "./drive-ui-dom";

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
