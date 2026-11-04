// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import { isLoopbackOrigin } from "./loopback";

it.each([
  ["http://localhost:5173", true],
  ["http://127.0.0.1:5173", true],
  ["http://[::1]:5173", true],
  ["https://docs.example", false],
  ["http://localhost.evil.example", false],
  ["http://192.168.1.1", false],
  ["not a URL", false],
])("keeps the authentication and identity-read loopback policy aligned for %s", (origin, expected) => {
  expect(isLoopbackOrigin(origin)).toBe(expected);
});
