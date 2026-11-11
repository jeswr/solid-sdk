// AUTHORED-BY Claude Opus 5.5
import { forgetHostBoundConnection } from "@jeswr/pod-migrator/connections";
import { isNativeApp } from "@jeswr/suite-native";
import { afterEach, expect, it, vi } from "vitest";
import {
  forgetMovePodDestination,
  movePodUnavailable,
} from "../src/shell/settings/move-pod-session";

vi.mock("@jeswr/pod-migrator/connections", () => ({ forgetHostBoundConnection: vi.fn() }));
vi.mock("@jeswr/suite-native", () => ({ isNativeApp: vi.fn(() => false) }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("forgets only the signing-out account's destination, or every one on sign-out-all", async () => {
  vi.stubGlobal("location", new URL("https://suite.example/settings"));
  await forgetMovePodDestination("alice");
  expect(forgetHostBoundConnection).toHaveBeenLastCalledWith({
    id: "target",
    origin: "https://suite.example",
    base: "/settings/move-pod/",
    owner: "alice",
  });
  await forgetMovePodDestination();
  expect(forgetHostBoundConnection).toHaveBeenLastCalledWith({
    id: "target",
    origin: "https://suite.example",
    base: "/settings/move-pod/",
  });
});

it.each([
  ["https://suite.example/", false, null],
  ["http://localhost:3000/", false, "insecure"],
  ["http://127.0.0.1:3000/", false, "insecure"],
  ["https://localhost/", true, "native"],
] as const)("reports availability for %s (native %s)", (href, native, expected) => {
  vi.stubGlobal("location", new URL(href));
  vi.mocked(isNativeApp).mockReturnValue(native);
  expect(movePodUnavailable()).toBe(expected);
});

it("has nothing to forget in the native app", async () => {
  vi.stubGlobal("location", new URL("https://localhost/"));
  vi.mocked(isNativeApp).mockReturnValue(true);
  await forgetMovePodDestination("alice");
  expect(forgetHostBoundConnection).not.toHaveBeenCalled();
});
