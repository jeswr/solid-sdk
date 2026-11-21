// AUTHORED-BY Codex GPT-6
import { validatePredecessorOrigins } from "@jeswr/suite-native";
import { expect, it, vi } from "vitest";
import { nativeSettings } from "../scripts/native-settings.mjs";

vi.mock("@jeswr/suite-native", { spy: true });

it("bakes the public remote origin by default without changing production URLs", () => {
  expect(nativeSettings({})).toEqual({
    target: "native",
    appBaseUrl: "https://localhost",
    publicSuiteUrl: "https://solid-suite.vercel.app",
    clientIdUrl: "https://solid-suite.vercel.app/.well-known/solid-client-id-mobile.jsonld",
    predecessorOrigins: ["https://solid-suite.vercel.app"],
  });
  expect(
    nativeSettings({ PUBLIC_SUITE_URL: "https://suite.example/base" }).predecessorOrigins,
  ).toEqual(["https://suite.example"]);
});

it("deduplicates explicit predecessor origins and allows an intentional empty list", () => {
  expect(
    nativeSettings({
      PREDECESSOR_ORIGINS: JSON.stringify([
        "https://old.example",
        "https://other.example:8443",
        "https://old.example",
      ]),
    }).predecessorOrigins,
  ).toEqual(["https://old.example", "https://other.example:8443"]);
  expect(nativeSettings({ PREDECESSOR_ORIGINS: "[]" }).predecessorOrigins).toEqual([]);
});

it.each([
  ["list", "PREDECESSOR_ORIGINS must be a JSON array of https origins"],
  ["origin", "PREDECESSOR_ORIGINS must contain canonical remote https origins"],
])("preserves the caller error when the SDK rejects a %s", (reason, message) => {
  const origins = ["https://old.example", "https://old.example"];
  vi.mocked(validatePredecessorOrigins).mockReturnValueOnce({ valid: false, reason });
  expect(() => nativeSettings({ PREDECESSOR_ORIGINS: JSON.stringify(origins) })).toThrow(message);
  expect(validatePredecessorOrigins).toHaveBeenLastCalledWith(origins);
});

it("validates the original plan before deduplicating", () => {
  expect(() =>
    nativeSettings({ PREDECESSOR_ORIGINS: JSON.stringify(Array(33).fill("https://old.example")) }),
  ).toThrow("PREDECESSOR_ORIGINS must be a JSON array of https origins");
  expect(() =>
    nativeSettings({
      PREDECESSOR_ORIGINS: JSON.stringify([
        "https://old.example",
        "https://old.example",
        "https://localhost",
      ]),
    }),
  ).toThrow("PREDECESSOR_ORIGINS must contain canonical remote https origins");
});

it("rejects malformed predecessor JSON before calling the SDK", () => {
  vi.mocked(validatePredecessorOrigins).mockClear();
  expect(() => nativeSettings({ PREDECESSOR_ORIGINS: "[" })).toThrow(SyntaxError);
  expect(validatePredecessorOrigins).not.toHaveBeenCalled();
});
