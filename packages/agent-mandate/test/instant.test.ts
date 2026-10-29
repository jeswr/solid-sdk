// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, it } from "vitest";
import { validInstant } from "../src/instant.js";
import { INVALID_INSTANTS } from "./helpers.js";

it.each([
  ...INVALID_INSTANTS,
  undefined,
  null,
  42,
  "x".repeat(65),
  "2026-00-10T00:00:00Z",
  "2026-13-10T00:00:00Z",
  "2026-01-00T00:00:00Z",
  "2026-01-32T00:00:00Z",
  "2026-01-01T00:60:00Z",
  "2026-01-01T00:00:60Z",
  "2026-12-31T23:59:59.123456Z",
])("rejects malformed or lossy calendar instants: %j", (value) => {
  expect(validInstant(value)).toBe(false);
});
it.each([
  "2024-02-29T23:59:59Z",
  "2000-02-29T00:00:00Z",
  "2026-12-31T23:59:59.123000Z",
  "0000-01-01T00:00:00Z",
  "2026-01-01T00:00:00+13:59",
  "2026-01-01T00:00:00-13:59",
  "2026-01-01T00:00:00+14:00",
  "2026-01-01T00:00:00-14:00",
])("accepts explicit calendar instants without changing their day or timezone: %s", (value) => {
  expect(validInstant(value)).toBe(true);
});
