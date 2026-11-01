// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import {
  DatePickerPopover,
  DateTimeField,
  type DateTimeValue,
  RecurrenceEditor,
  type RecurrenceRule,
} from "@jeswr/suite-ui/date-time";
import { useId, useState } from "react";

const reference = new Date("2026-10-26T10:00:00");
function AccountLocale({ value, onChange }: { value: string; onChange: (locale: string) => void }) {
  const id = useId();
  return (
    <label className="suite-date-stack" htmlFor={id}>
      Account locale
      <select
        id={id}
        className="suite-date-control"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="en-GB">English (United Kingdom)</option>
        <option value="en-US">English (United States)</option>
      </select>
    </label>
  );
}
function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main id="main-content" tabIndex={-1} className="fixture-page date-fixtures">
      <nav aria-label="Component fixtures">
        <a href="/dev/components">All component fixtures</a>
      </nav>
      <header className="fixture-heading">
        <p className="eyebrow">Solid Suite · Date and time</p>
        <h1>{title}</h1>
      </header>
      {children}
    </main>
  );
}
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="foundation-card suite-date-stack">
      <h2>{title}</h2>
      {children}
    </section>
  );
}
function FieldExample({
  label,
  locale,
  initialText,
  disabled = false,
}: {
  label: string;
  locale: string;
  initialText?: string;
  disabled?: boolean;
}) {
  const [value, setValue] = useState<DateTimeValue | null>(null);
  return (
    <DateTimeField
      label={label}
      locale={locale}
      value={value}
      onChange={setValue}
      referenceDate={reference}
      disabled={disabled}
      {...(initialText !== undefined ? { initialText } : {})}
    />
  );
}
export function DateTimeFixtures() {
  const [locale, setLocale] = useState("en-GB");
  return (
    <Frame title="DateTimeField">
      <AccountLocale value={locale} onChange={setLocale} />
      <div className="date-fixture-grid">
        <Card title="Choose a date">
          <FieldExample label="Due date" locale={locale} />
        </Card>
        <Card title="Live interpretation">
          <FieldExample label="Appointment" locale={locale} initialText="tomorrow 5pm" />
        </Card>
        <Card title="All day">
          <FieldExample label="Deadline" locale={locale} initialText="next mon" />
        </Card>
        <Card title="Locale date order">
          <FieldExample label="Numeric date" locale={locale} initialText="10/11/2026" />
        </Card>
        <Card title="Invalid date">
          <FieldExample label="Invalid date example" locale={locale} initialText="not a date" />
        </Card>
        <Card title="Unavailable">
          <FieldExample label="Read-only date" locale={locale} disabled />
        </Card>
      </div>
    </Frame>
  );
}
function PickerExample({
  label,
  locale,
  initial,
  disabled = false,
}: {
  label: string;
  locale: string;
  initial: DateTimeValue | null;
  disabled?: boolean;
}) {
  const [value, setValue] = useState(initial);
  return (
    <DatePickerPopover
      label={label}
      locale={locale}
      value={value}
      onChange={setValue}
      disabled={disabled}
      today={reference}
    />
  );
}
export function DatePickerFixtures() {
  const [locale, setLocale] = useState("en-GB");
  return (
    <Frame title="DatePickerPopover">
      <AccountLocale value={locale} onChange={setLocale} />
      <div className="date-fixture-grid">
        <Card title="Choose a date">
          <PickerExample label="Due date" locale={locale} initial={null} />
        </Card>
        <Card title="All day">
          <PickerExample
            label="Deadline"
            locale={locale}
            initial={{ kind: "date", date: "2026-10-27" }}
          />
        </Card>
        <Card title="With time">
          <PickerExample
            label="Appointment"
            locale={locale}
            initial={{ kind: "dateTime", dateTime: "2026-10-27T17:00:00.000Z" }}
          />
        </Card>
        <Card title="Unavailable">
          <PickerExample label="Read-only date" locale={locale} initial={null} disabled />
        </Card>
      </div>
    </Frame>
  );
}
const examples: [string, RecurrenceRule | null][] = [
  ["Does not repeat", null],
  ["Daily", { freq: "DAILY", interval: 1 }],
  ["Weekly", { freq: "WEEKLY", interval: 2, byDay: ["Monday", "Wednesday"] }],
  [
    "Every weekday",
    {
      freq: "WEEKLY",
      interval: 1,
      byDay: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    },
  ],
  ["Day of month", { freq: "MONTHLY", interval: 1, byMonthDay: [15] }],
  ["Nth weekday", { freq: "MONTHLY", interval: 1, byDay: ["Tuesday"], bySetPos: 2 }],
  ["Last weekday", { freq: "MONTHLY", interval: 1, byDay: ["Friday"], bySetPos: -1 }],
  ["Yearly", { freq: "YEARLY", interval: 1, byMonth: [10], byMonthDay: [26] }],
  ["Ends after", { freq: "DAILY", interval: 1, count: 10 }],
  ["Ends on date", { freq: "WEEKLY", interval: 1, byDay: ["Monday"], until: "2027-01-01" }],
];
function RecurrenceExample({
  initial,
  locale,
  disabled = false,
}: {
  initial: RecurrenceRule | null;
  locale: string;
  disabled?: boolean;
}) {
  const [value, setValue] = useState(initial);
  return (
    <RecurrenceEditor
      value={value}
      onChange={setValue}
      locale={locale}
      startDate="2026-10-26"
      disabled={disabled}
    />
  );
}
export function RecurrenceFixtures() {
  const [locale, setLocale] = useState("en-GB");
  return (
    <Frame title="RecurrenceEditor">
      <AccountLocale value={locale} onChange={setLocale} />
      <div className="date-fixture-grid">
        {examples.map(([title, initial]) => (
          <Card key={title} title={title}>
            <RecurrenceExample initial={initial} locale={locale} />
          </Card>
        ))}
        <Card title="Unavailable">
          <RecurrenceExample initial={{ freq: "DAILY", interval: 1 }} locale={locale} disabled />
        </Card>
      </div>
    </Frame>
  );
}
