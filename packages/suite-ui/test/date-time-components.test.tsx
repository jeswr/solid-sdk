// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import axe from "axe-core";
import { type ReactNode, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DatePickerPopover } from "../src/date-time/date-picker-popover.js";
import { DateTimeField } from "../src/date-time/date-time-field.js";
import type { DateTimeValue } from "../src/date-time/date-value.js";
import { fromRRule, type RecurrenceRule, toRRule } from "../src/date-time/recurrence.js";
import { RecurrenceEditor } from "../src/date-time/recurrence-editor.js";

process.env.TZ = "UTC";
afterEach(cleanup);
const reference = new Date("2026-10-26T10:00:00Z");
function mount(children: ReactNode) {
  return render(
    <main>
      <h1>Dates</h1>
      {children}
    </main>,
  );
}
async function accessible() {
  // jsdom has no layout or canvas: contrast and reflow run in dispatcher Playwright.
  const result = await axe.run(document.body, { rules: { "color-contrast": { enabled: false } } });
  expect(result.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.html) }))).toEqual(
    [],
  );
}
function Picker({ initial = null }: { initial?: DateTimeValue | null }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <DatePickerPopover
        label="Due date"
        locale="en-GB"
        value={value}
        onChange={setValue}
        today={reference}
      />
      <div data-testid="value">{JSON.stringify(value)}</div>
    </>
  );
}
function Editor({ initial = null }: { initial?: RecurrenceRule | null }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <RecurrenceEditor locale="en-GB" startDate="2026-10-26" value={value} onChange={setValue} />
      <div data-testid="value">{value ? toRRule(value) : "none"}</div>
    </>
  );
}
const change = (name: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(name), { target: { value } });

describe("DateTimeField", () => {
  it("announces live interpretations, keeps drafts, rejects invalid edits and clears", async () => {
    const onChange = vi.fn();
    mount(
      <DateTimeField
        label="Due date"
        locale="en-GB"
        value={null}
        onChange={onChange}
        referenceDate={reference}
      />,
    );
    await accessible();
    change("Due date", "tomorrow 5pm");
    expect(onChange).toHaveBeenLastCalledWith({
      kind: "dateTime",
      dateTime: "2026-10-27T17:00:00.000Z",
    });
    expect(screen.getByRole("status").textContent).toContain("27 October 2026 at 17:00");
    expect((screen.getByLabelText("Due date") as HTMLInputElement).value).toBe("tomorrow 5pm");
    await accessible();
    onChange.mockClear();
    change("Due date", "not a date");
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("Enter a date");
    expect((screen.getByLabelText("Due date") as HTMLInputElement).checkValidity()).toBe(false);
    await accessible();
    change("Due date", "next mon");
    expect(onChange).toHaveBeenLastCalledWith({ kind: "date", date: "2026-11-02" });
    expect(screen.getByRole("status").textContent).toContain("All day");
    await accessible();
    change("Due date", "");
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
  it("accepts external changes and account locale switches", async () => {
    const onChange = vi.fn();
    const view = render(
      <DateTimeField
        label="Date"
        locale="en-GB"
        value={null}
        onChange={onChange}
        referenceDate={reference}
      />,
    );
    change("Date", "10/11/2026");
    expect(onChange).toHaveBeenLastCalledWith({ kind: "date", date: "2026-11-10" });
    view.rerender(
      <DateTimeField
        label="Date"
        locale="en-US"
        value={{ kind: "date", date: "2027-01-01" }}
        onChange={onChange}
        referenceDate={reference}
      />,
    );
    expect((screen.getByLabelText("Date") as HTMLInputElement).value).toContain("January 1, 2027");
    change("Date", "10/11/2026");
    expect(onChange).toHaveBeenLastCalledWith({ kind: "date", date: "2026-10-11" });
  });
  it("reinterprets an edited numeric date when the account locale changes", () => {
    const onChange = vi.fn();
    const value = { kind: "date" as const, date: "2026-11-10" };
    const view = render(
      <DateTimeField
        label="Date"
        locale="en-GB"
        value={value}
        onChange={onChange}
        referenceDate={reference}
      />,
    );
    change("Date", "10/11/2026");
    view.rerender(
      <DateTimeField
        label="Date"
        locale="en-US"
        value={value}
        onChange={onChange}
        referenceDate={reference}
      />,
    );
    expect(onChange).toHaveBeenLastCalledWith({ kind: "date", date: "2026-10-11" });
  });
  it("renders disabled dates accessibly", async () => {
    mount(
      <DateTimeField
        label="Date"
        locale="en-US"
        value={{ kind: "date", date: "2026-10-27" }}
        onChange={vi.fn()}
        disabled
      />,
    );
    expect((screen.getByLabelText("Date") as HTMLInputElement).disabled).toBe(true);
    await accessible();
  });
});

describe("DatePickerPopover", () => {
  it("selects a day, switches all-day and time, clears and closes", async () => {
    mount(<Picker />);
    await accessible();
    fireEvent.click(screen.getByRole("button", { name: /Due date Choose/ }));
    const dialog = screen.getByRole("dialog", { name: "Due date" });
    expect((within(dialog).getByLabelText("Time") as HTMLInputElement).disabled).toBe(true);
    await accessible();
    const day = within(dialog).getByRole("button", { name: /Tuesday, 27 October 2026/ });
    fireEvent.click(day);
    expect(screen.getByTestId("value").textContent).toBe('{"kind":"date","date":"2026-10-27"}');
    await accessible();
    fireEvent.click(screen.getByLabelText("All day"));
    change("Time", "17:30");
    expect(screen.getByTestId("value").textContent).toContain("2026-10-27T17:30:00.000Z");
    await accessible();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBe(null);
    fireEvent.click(screen.getByRole("button", { name: /Due date/ }));
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByTestId("value").textContent).toBe("null");
  });
  it("retains the time when switching an existing appointment to all day and back", () => {
    mount(<Picker initial={{ kind: "dateTime", dateTime: "2026-10-27T17:00:00.000Z" }} />);
    fireEvent.click(screen.getByRole("button", { name: /Due date/ }));
    fireEvent.click(screen.getByLabelText("All day"));
    expect(screen.getByTestId("value").textContent).toContain('"kind":"date"');
    fireEvent.click(screen.getByLabelText("All day"));
    expect(screen.getByTestId("value").textContent).toContain("2026-10-27T17:00:00.000Z");
  });
  it("keeps empty date empty when toggling all day and handles disabled", async () => {
    mount(
      <DatePickerPopover
        label="Date"
        locale="en-US"
        value={null}
        onChange={vi.fn()}
        defaultOpen
        today={reference}
      />,
    );
    fireEvent.click(screen.getByLabelText("All day"));
    expect((screen.getByLabelText("Time") as HTMLInputElement).disabled).toBe(true);
    await accessible();
    cleanup();
    mount(
      <DatePickerPopover label="Date" locale="en-US" value={null} onChange={vi.fn()} disabled />,
    );
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
    await accessible();
  });
  it("closes an open picker when disabled and stays closed when re-enabled", () => {
    const onChange = vi.fn();
    const picker = (disabled: boolean) => (
      <DatePickerPopover
        label="Due date"
        locale="en-GB"
        value={{ kind: "dateTime", dateTime: "2026-10-27T17:00:00.000Z" }}
        onChange={onChange}
        disabled={disabled}
        defaultOpen
        today={reference}
      />
    );
    const view = render(picker(false));
    const dialog = screen.getByRole("dialog", { name: "Due date" });
    expect((within(dialog).getByLabelText("Time") as HTMLInputElement).disabled).toBe(false);
    view.rerender(picker(true));
    expect(screen.queryByRole("dialog")).toBe(null);
    const trigger = screen.getByRole("button", { name: /Due date/ });
    expect((trigger as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(trigger);
    expect(screen.queryByRole("dialog")).toBe(null);
    expect(onChange).not.toHaveBeenCalled();
    view.rerender(picker(false));
    expect(screen.queryByRole("dialog")).toBe(null);
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith(null);
  });
  it("keeps a disabled picker closed even with defaultOpen", () => {
    const onChange = vi.fn();
    render(
      <DatePickerPopover
        label="Date"
        locale="en-GB"
        value={null}
        onChange={onChange}
        defaultOpen
        disabled
        today={reference}
      />,
    );
    expect(screen.queryByRole("dialog")).toBe(null);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("RecurrenceEditor", () => {
  it.each([
    "MONTHLY",
    "YEARLY",
  ] as const)("edits an imported %s rule with a day defaulting to DTSTART", (freq) => {
    const rule = fromRRule(`FREQ=${freq}`);
    const onChange = vi.fn();
    const editor = (startDate: string) => (
      <RecurrenceEditor locale="en-GB" startDate={startDate} value={rule} onChange={onChange} />
    );
    const view = render(editor("2026-10-26"));
    expect((screen.getByLabelText("Day of month") as HTMLSelectElement).value).toBe("26");
    expect(onChange).not.toHaveBeenCalled();
    if (freq === "MONTHLY") {
      expect((screen.getByLabelText("Monthly pattern") as HTMLSelectElement).value).toBe("day");
    } else {
      expect((screen.getByLabelText("Month") as HTMLSelectElement).value).toBe("10");
    }
    view.rerender(editor("2026-11-30"));
    expect((screen.getByLabelText("Day of month") as HTMLSelectElement).value).toBe("30");
    expect(onChange).not.toHaveBeenCalled();
    change("Day of month", "15");
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      ...rule,
      byMonthDay: [15],
      ...(freq === "YEARLY" ? { byMonth: [11] } : {}),
    });
    expect((screen.getByLabelText("Day of month") as HTMLSelectElement).value).toBe("15");
  });
  it.each([
    ["FREQ=YEARLY", "10"],
    ["FREQ=YEARLY;BYMONTH=2", "2"],
    ["FREQ=YEARLY;BYMONTH=2,10", "2,10"],
  ])("preserves the selected months when editing a day in %s", (input, months) => {
    const onChange = vi.fn();
    render(
      <RecurrenceEditor
        locale="en-GB"
        startDate="2026-10-26"
        value={fromRRule(input)}
        onChange={onChange}
      />,
    );
    expect((screen.getByLabelText("Month") as HTMLSelectElement).value).toBe(months.split(",")[0]);
    expect(onChange).not.toHaveBeenCalled();
    change("Day of month", "15");
    expect(onChange).toHaveBeenCalledOnce();
    expect(toRRule(onChange.mock.calls[0]?.[0])).toBe(
      `RRULE:FREQ=YEARLY;INTERVAL=1;BYMONTHDAY=15;BYMONTH=${months}`,
    );
  });
  it.each([
    ["2026-10-26", "Monday", "MO,WE"],
    ["2026-11-01", "Sunday", "WE,SU"],
  ])("shows and retains the implicit %s weekday when adding Wednesday", (startDate, day, days) => {
    const onChange = vi.fn();
    render(
      <RecurrenceEditor
        locale="en-GB"
        startDate={startDate}
        value={fromRRule("FREQ=WEEKLY")}
        onChange={onChange}
      />,
    );
    const checked = () =>
      screen.getAllByRole("checkbox").filter((input) => (input as HTMLInputElement).checked);
    expect(checked()).toEqual([screen.getByRole("checkbox", { name: new RegExp(day) })]);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox", { name: /Wednesday/ }));
    expect(checked()).toHaveLength(2);
    expect(onChange).toHaveBeenCalledOnce();
    expect(toRRule(onChange.mock.calls[0]?.[0])).toBe(`RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=${days}`);
  });
  it("validates removing the implicit weekday without restoring it on later edits", () => {
    const onChange = vi.fn();
    render(
      <RecurrenceEditor
        locale="en-GB"
        startDate="2026-10-26"
        value={fromRRule("FREQ=WEEKLY")}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: /Monday/ }));
    expect(screen.getByRole("alert").textContent).toBe("Choose at least one weekday.");
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox", { name: /Wednesday/ }));
    expect(screen.queryByRole("alert")).toBe(null);
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      freq: "WEEKLY",
      interval: 1,
      byDay: ["Wednesday"],
    });
  });
  it.each([
    { until: "2027-02-01", interval: 1 },
    { until: "2027-01-01", interval: 2 },
  ])("resets an end-date error on external updates to $until, interval $interval", (next) => {
    const onChange = vi.fn();
    const rule = fromRRule("FREQ=DAILY;UNTIL=20270101");
    const editor = (value: RecurrenceRule) => (
      <RecurrenceEditor locale="en-GB" startDate="2026-10-26" value={value} onChange={onChange} />
    );
    const view = render(editor(rule));
    const input = screen.getByLabelText("End date") as HTMLInputElement;
    change("End date", "");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.checkValidity()).toBe(false);
    expect(screen.getByRole("alert").textContent).toBe("Enter an end date.");
    view.rerender(editor({ ...rule }));
    expect(input.value).toBe("");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    view.rerender(editor({ ...rule, ...next }));
    expect(input.value).toBe(next.until);
    expect(input.getAttribute("aria-invalid")).toBe("false");
    expect(input.getAttribute("aria-describedby")).toBe(null);
    expect(input.checkValidity()).toBe(true);
    expect(screen.queryByRole("alert")).toBe(null);
    expect(onChange).not.toHaveBeenCalled();
  });
  it("builds daily, weekly, monthly ordinal and yearly objects", async () => {
    mount(<Editor />);
    await accessible();
    change("Frequency", "DAILY");
    change(/Repeat every/, "2");
    expect(screen.getByTestId("value").textContent).toBe("RRULE:FREQ=DAILY;INTERVAL=2");
    await accessible();
    change("Frequency", "WEEKLY");
    fireEvent.click(screen.getByRole("checkbox", { name: /Wednesday/ }));
    expect(screen.getByTestId("value").textContent).toContain("BYDAY=MO,WE");
    await accessible();
    fireEvent.click(screen.getByRole("checkbox", { name: /Monday/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Wednesday/ }));
    expect(screen.getByRole("alert").textContent).toContain("at least one");
    expect(screen.getByTestId("value").textContent).toContain("BYDAY=WE"); // invalid draft is not emitted
    await accessible();
    change("Frequency", "MONTHLY");
    change("Day of month", "-1");
    expect(screen.getByTestId("value").textContent).toContain("BYMONTHDAY=-1");
    await accessible();
    change("Monthly pattern", "weekday");
    expect(screen.queryByLabelText("Day of month")).toBe(null);
    change("Which week", "-1");
    change("Weekday", "Friday");
    expect(screen.getByTestId("value").textContent).toContain("BYDAY=-1FR");
    expect(screen.getByRole("status").textContent).toContain("last Fri");
    await accessible();
    change("Frequency", "YEARLY");
    change("Month", "2");
    change("Day of month", "29");
    expect(screen.getByTestId("value").textContent).toContain("BYMONTHDAY=29;BYMONTH=2");
    await accessible();
    change("Frequency", "none");
    expect(screen.getByTestId("value").textContent).toBe("none");
  });
  it("keeps count and until exclusive, reports bad numbers and blank end dates", async () => {
    mount(<Editor initial={{ freq: "DAILY", interval: 1 }} />);
    change("Ends", "after");
    change("Occurrences", "3");
    expect(screen.getByTestId("value").textContent).toContain("COUNT=3");
    await accessible();
    change("Occurrences", "0");
    expect(screen.getByRole("alert").textContent).toContain("whole number");
    expect(screen.getByTestId("value").textContent).toContain("COUNT=3");
    await accessible();
    change("Ends", "on");
    change("End date", "2027-01-01");
    expect(screen.getByTestId("value").textContent).toContain("UNTIL=20270101");
    expect(screen.getByTestId("value").textContent).not.toContain("COUNT");
    await accessible();
    change("End date", "");
    expect(screen.getByRole("alert").textContent).toBe("Enter an end date.");
    await accessible();
    change("Ends", "never");
    expect(screen.getByTestId("value").textContent).not.toMatch(/COUNT|UNTIL/);
    change(/Repeat every/, "");
    expect(screen.getByRole("alert").textContent).toContain("whole number");
    await accessible();
  });
  it.each([
    "Repeat every (days)",
    "Occurrences",
  ])("blocks form submission for rejected %s drafts and clears validity after correction", (label) => {
    const onChange = vi.fn();
    const onSubmit = vi.fn();
    render(
      <form
        aria-label="Repeat schedule"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <RecurrenceEditor
          locale="en-GB"
          startDate="2026-10-26"
          value={{ freq: "DAILY", interval: 1, count: 3 }}
          onChange={onChange}
        />
        <button type="submit">Save</button>
      </form>,
    );
    const form = screen.getByRole("form", { name: "Repeat schedule" }) as HTMLFormElement;
    const input = screen.getByLabelText(label) as HTMLInputElement;
    expect(form.checkValidity()).toBe(true);
    for (const draft of ["1e2", "2.0"]) {
      change(label, draft);
      expect(input.value).toBe(draft);
      expect(input.getAttribute("aria-invalid")).toBe("true");
      expect(input.validity.customError).toBe(true);
      expect(form.checkValidity()).toBe(false);
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(onSubmit).not.toHaveBeenCalled();
      expect(onChange).not.toHaveBeenCalled();
    }
    change(label, "4");
    expect(input.validity.customError).toBe(false);
    expect(form.checkValidity()).toBe(true);
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      freq: "DAILY",
      interval: label === "Occurrences" ? 1 : 4,
      count: label === "Occurrences" ? 4 : 3,
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit).toHaveBeenCalledOnce();
  });
  it("renders disabled recurrence", async () => {
    mount(
      <RecurrenceEditor
        locale="en-GB"
        startDate="2026-10-26"
        value={{ freq: "DAILY", interval: 1 }}
        onChange={vi.fn()}
        disabled
      />,
    );
    expect(
      (screen.getByLabelText("Frequency") as HTMLSelectElement).closest("fieldset")?.disabled,
    ).toBe(true);
    await accessible();
  });
});
