// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DatePickerPopover } from "../src/date-time/date-picker-popover.js";
import { DateTimeField } from "../src/date-time/date-time-field.js";
import type { DateTimeValue } from "../src/date-time/date-value.js";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

const components = [
  { name: "field", Component: DateTimeField, role: "textbox" },
  { name: "picker", Component: DatePickerPopover, role: "button" },
] as const;
const values: DateTimeValue[] = [
  { kind: "dateTime", dateTime: "2026-10-27T00:30:00.000Z" },
  { kind: "date", date: "2026-10-27" },
];

describe.each(["en-GB", "en-US"])("date hydration in %s", (locale) => {
  describe.each(["America/New_York", "Pacific/Kiritimati"])("browser in %s", (timeZone) => {
    describe.each(components)("$name", ({ Component, role }) => {
      it.each(values)("hydrates a $kind from a UTC server and then localizes", (value) => {
        const onChange = vi.fn();
        const element = (
          <Component label="Due date" locale={locale} value={value} onChange={onChange} />
        );
        vi.stubEnv("TZ", "UTC");
        const container = document.createElement("div");
        container.innerHTML = renderToString(element);
        document.body.appendChild(container);
        const control = container.querySelector(role === "textbox" ? "input" : "button");
        vi.stubEnv("TZ", timeZone);
        expect(new Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(timeZone);
        const onRecoverableError = vi.fn();
        const view = render(element, { container, hydrate: true, onRecoverableError });
        expect(onRecoverableError).not.toHaveBeenCalled();
        expect(view.getByRole(role)).toBe(control);
        const expected =
          value.kind === "dateTime"
            ? new Intl.DateTimeFormat(locale, {
                dateStyle: "full",
                timeStyle: "short",
                timeZone,
              }).format(new Date(value.dateTime))
            : `${new Intl.DateTimeFormat(locale, {
                dateStyle: "full",
                timeZone: "UTC",
              }).format(new Date(`${value.date}T12:00:00Z`))} · All day`;
        expect(view.getByRole("status").textContent).toBe(expected);
        if (role === "textbox") {
          expect((control as HTMLInputElement).value).toBe(expected.replace(" · All day", ""));
        } else {
          expect(control?.textContent).toBe(expected);
        }
        expect(onChange).not.toHaveBeenCalled();
      });
    });
  });
  it("hydrates an initial natural-language draft before interpreting browser wall time", () => {
    const onChange = vi.fn();
    const element = (
      <DateTimeField
        label="Due date"
        locale={locale}
        value={null}
        initialText="tomorrow 5pm"
        referenceDate={new Date("2026-10-26T10:00:00Z")}
        onChange={onChange}
      />
    );
    vi.stubEnv("TZ", "UTC");
    const container = document.createElement("div");
    container.innerHTML = renderToString(element);
    document.body.appendChild(container);
    const input = container.querySelector("input");
    vi.stubEnv("TZ", "America/New_York");
    const onRecoverableError = vi.fn();
    const view = render(element, { container, hydrate: true, onRecoverableError });
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(view.getByRole("textbox")).toBe(input);
    expect(input?.value).toBe("tomorrow 5pm");
    expect(view.getByRole("status").textContent).toBe(
      new Intl.DateTimeFormat(locale, {
        dateStyle: "full",
        timeStyle: "short",
        timeZone: "America/New_York",
      }).format(new Date("2026-10-27T21:00:00Z")),
    );
    expect(onChange).not.toHaveBeenCalled();
  });
});
