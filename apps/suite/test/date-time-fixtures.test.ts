// AUTHORED-BY Codex GPT-6.1-Sol
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { DatePickerFixtures } from "../src/app/dev/components/date-time-fixtures.js";

afterEach(() => vi.unstubAllEnvs());

it.each([
  "America/New_York",
  "Pacific/Kiritimati",
])("keeps the picker fixture's initial markup identical between UTC and %s", (timeZone) => {
  vi.stubEnv("TZ", "UTC");
  const server = renderToString(createElement(DatePickerFixtures));
  expect(server).toContain("Tuesday, 27 October 2026 at 17:00");
  vi.stubEnv("TZ", timeZone);
  expect(new Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(timeZone);
  const client = renderToString(createElement(DatePickerFixtures));
  expect(client).toBe(server);
});
