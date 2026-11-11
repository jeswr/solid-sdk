// AUTHORED-BY Codex GPT-6

import { StrictMode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { act, deferred, h, mount } from "./drive-ui-dom";

const fixture = vi.hoisted(() => ({ native: true, take: vi.fn() }));
vi.mock("@jeswr/suite-native", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  isNativeApp: () => fixture.native,
}));
vi.mock("@jeswr/suite-native/capacitor", () => ({
  secureStorePlugin: { takeMigrationNotice: fixture.take },
}));

import { NativeMigrationNotice } from "../src/components/native-migration-notice";

beforeEach(() => {
  fixture.native = true;
  fixture.take.mockReset().mockResolvedValue({ signInAgain: false });
});

it("shows the native notice once and consumes no origin or token arguments", async () => {
  fixture.take.mockResolvedValueOnce({ signInAgain: true });
  const first = await mount(h(StrictMode, { children: h(NativeMigrationNotice) }));
  await act(async () => vi.dynamicImportSettled());
  expect(fixture.take).toHaveBeenCalledExactlyOnceWith();
  expect(first.host.querySelector('[role="status"]')?.textContent).toBe(
    "Sign in again to continue",
  );
  await first.unmount();
  const second = await mount(h(NativeMigrationNotice));
  await act(async () => vi.dynamicImportSettled());
  expect(second.host.textContent).toBe("");
  expect(fixture.take).toHaveBeenCalledTimes(2);
});

it("never consumes or shows a notice on the web", async () => {
  fixture.native = false;
  fixture.take.mockResolvedValue({ signInAgain: true });
  const view = await mount(h(NativeMigrationNotice));
  await act(async () => vi.dynamicImportSettled());
  expect(view.host.textContent).toBe("");
  expect(fixture.take).not.toHaveBeenCalled();
});

it.each([
  {},
  { signInAgain: "true" },
  { signInAgain: true, token: "private" },
  null,
])("ignores malformed native signal %j", async (value) => {
  fixture.take.mockResolvedValue(value);
  const view = await mount(h(NativeMigrationNotice));
  await act(async () => vi.dynamicImportSettled());
  expect(view.host.textContent).toBe("");
});

it("keeps sign-in usable on failure and permits retry on a later visit", async () => {
  fixture.take.mockRejectedValueOnce(new Error("private native detail"));
  const first = await mount(h(NativeMigrationNotice));
  await act(async () => vi.dynamicImportSettled());
  expect(first.host.textContent).toBe("");
  await first.unmount();
  fixture.take.mockResolvedValueOnce({ signInAgain: true });
  const next = await mount(h(NativeMigrationNotice));
  await act(async () => vi.dynamicImportSettled());
  expect(next.host.textContent).toBe("Sign in again to continue");
});

it("drops a late native response after the sign-in view unmounts", async () => {
  const pending = deferred<{ signInAgain: boolean }>();
  fixture.take.mockReturnValue(pending.promise);
  const view = await mount(h(NativeMigrationNotice));
  await act(async () => vi.dynamicImportSettled());
  await view.unmount();
  await act(async () => pending.resolve({ signInAgain: true }));
  expect(view.host.textContent).toBe("");
});
