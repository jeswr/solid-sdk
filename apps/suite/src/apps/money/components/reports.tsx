// AUTHORED-BY Claude Opus 5.5
"use client";
import { Button, EmptyState } from "@jeswr/suite-ui";
import { ArrowDownRight, ArrowUpRight, BarChart3, Minus } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import {
  buildReport,
  type MoneyReport,
  type MonthBar,
  REPORT_PRESETS,
  type ReportChange,
  type ReportPreset,
  reportCurrencies,
} from "../lib/data/reports";
import { minorUnits } from "../lib/reports";
import { useMoney } from "../state/money-context";
import { Amount } from "./money-forms";

const monthLabel = (month: string, style: "short" | "long" = "short") =>
  new Intl.DateTimeFormat("en-GB", { month: style, year: "numeric", timeZone: "UTC" }).format(
    new Date(`${month}-01T12:00:00Z`),
  );
const dateLabel = (date: string) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));

/** Whole percent, but never "0%" for a share that isn't zero. */
function shareLabel(share: number) {
  const value = Math.round(share * 100);
  return value === 0 && share > 0 ? "<1%" : `${value}%`;
}
function partial(row: MonthBar) {
  return row.days === undefined ? "" : ` (${row.days} ${row.days === 1 ? "day" : "days"})`;
}

export function ReportsScreen() {
  const money = useMoney();
  const [preset, setPreset] = useState<ReportPreset>("month");
  const [rollUp, setRollUp] = useState(true);
  const currencies = reportCurrencies(money.accounts, money.transactions);
  const [chosen, setChosen] = useState<string>();
  const currency = chosen && currencies.includes(chosen) ? chosen : currencies[0];
  const versus = REPORT_PRESETS.find((item) => item.id === preset)?.versus ?? "";
  if (!currency)
    return (
      <>
        <Heading />
        <section className="mon-panel">
          <EmptyState
            title="Nothing to report yet"
            body="Add an account or import a statement to see where your money goes."
            icon={<BarChart3 aria-hidden="true" />}
            primaryAction={
              <Button asChild>
                <Link href="/money/import">Import a statement</Link>
              </Button>
            }
          />
        </section>
      </>
    );
  let report: MoneyReport | undefined;
  try {
    report = buildReport(money.transactions, money.categories, currency, preset, money.today, {
      rollUp,
    });
  } catch {
    // Totals beyond safe integers or other data the exact library rejects.
    report = undefined;
  }
  return (
    <>
      <Heading />
      <div className="mon-report-controls">
        <fieldset className="mon-segmented">
          <legend className="sr-only">Period</legend>
          {REPORT_PRESETS.map((item) => (
            <label key={item.id}>
              <input
                type="radio"
                name="mon-report-period"
                value={item.id}
                checked={preset === item.id}
                onChange={() => setPreset(item.id)}
              />
              <span>{item.label}</span>
            </label>
          ))}
        </fieldset>
        {currencies.length > 1 && (
          <label className="mon-field mon-report-currency">
            <span>Currency</span>
            <select value={currency} onChange={(event) => setChosen(event.target.value)}>
              {currencies.map((code) => (
                <option key={code}>{code}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      {!report ? (
        <section className="mon-panel">
          <EmptyState
            title="Can't build this report"
            body={`Your ${currency} transactions can't be added up exactly, so there's no report for them. Try another currency.`}
          />
        </section>
      ) : (
        <ReportBody report={report} versus={versus} rollUp={rollUp} onRollUp={setRollUp} />
      )}
    </>
  );
}

function ReportBody({
  report,
  versus,
  rollUp,
  onRollUp,
}: {
  report: MoneyReport;
  versus: string;
  rollUp: boolean;
  onRollUp: (value: boolean) => void;
}) {
  const { currency } = report;
  return (
    <>
      <p className="mon-hint mon-report-period">
        {dateLabel(report.current.start)} to {dateLabel(report.current.end)}, compared with {versus}{" "}
        ({dateLabel(report.previous.start)} to {dateLabel(report.previous.end)}). Transfers between
        your accounts are left out, and refunds count as money in for now.
      </p>
      {report.skipped > 0 && (
        <p className="mon-hint" role="status">
          {report.skipped} {report.skipped === 1 ? "transaction has" : "transactions have"} an
          amount with more decimal places than {currency} allows and{" "}
          {report.skipped === 1 ? "isn't" : "aren't"} included.
        </p>
      )}
      <div className="mon-worth-grid mon-report-totals">
        <Total title="Money in" value={report.income} currency={currency} />
        <Total title="Spending" value={report.expense} currency={currency} />
        <Total title="Net" value={report.net} currency={currency} signed />
      </div>
      <div className="mon-columns">
        <Categories report={report} rollUp={rollUp} onRollUp={onRollUp} />
        <Months report={report} />
      </div>
    </>
  );
}

function Heading() {
  return (
    <header className="mon-heading">
      <div>
        <p className="mon-eyebrow">Where your money goes</p>
        <h1>Reports</h1>
        <p className="mon-subtitle">Worked out in your browser from the data in your pod.</p>
      </div>
    </header>
  );
}

function Total({
  title,
  value,
  currency,
  signed = false,
}: {
  title: string;
  value: ReportChange;
  currency: string;
  signed?: boolean;
}) {
  const direction = value.change.startsWith("-")
    ? "down"
    : /^0(\.0+)?$/.test(value.change)
      ? "same"
      : "up";
  const Icon = direction === "down" ? ArrowDownRight : direction === "up" ? ArrowUpRight : Minus;
  const size = value.percent === null ? null : Math.abs(value.percent);
  return (
    <section className="mon-worth" aria-label={title}>
      <p className="mon-eyebrow">{title}</p>
      <h2>
        <Amount amount={value.amount} currency={currency} signed={signed} />
      </h2>
      <p className="mon-report-change">
        <Icon size={16} aria-hidden="true" />
        {direction === "same" ? (
          "No change"
        ) : size === null ? (
          "No previous figure"
        ) : (
          <>
            {direction === "up" ? "Up" : "Down"} {size === 0 ? "<1" : size}% (
            <Amount amount={value.change} currency={currency} signed />)
          </>
        )}
      </p>
      <p className="mon-report-was">
        Previous period: <Amount amount={value.previous} currency={currency} signed={signed} />
      </p>
    </section>
  );
}

function Categories({
  report,
  rollUp,
  onRollUp,
}: {
  report: MoneyReport;
  rollUp: boolean;
  onRollUp: (value: boolean) => void;
}) {
  const [table, setTable] = useState(false);
  const largest = Math.max(1, ...report.categories.map((row) => row.minor));
  return (
    <section className="mon-panel" aria-labelledby="mon-report-categories">
      <div className="mon-panel-heading">
        <h2 id="mon-report-categories">Spending by category</h2>
        <Button variant="ghost" size="sm" onClick={() => setTable(!table)}>
          {table ? "Show as bars" : "Show as table"}
        </Button>
      </div>
      <label className="mon-checkbox-label">
        <input
          type="checkbox"
          checked={rollUp}
          onChange={(event) => onRollUp(event.target.checked)}
        />
        Include subcategories in their parent
      </label>
      {!report.categories.length ? (
        <p className="mon-soft-empty">No spending in this period.</p>
      ) : table ? (
        <table className="mon-simple-table">
          <caption className="sr-only">Spending by category</caption>
          <thead>
            <tr>
              <th>Category</th>
              <th>Share</th>
              <th>Spend</th>
            </tr>
          </thead>
          <tbody>
            {report.categories.map((row) => (
              <tr key={row.id ?? "none"}>
                <td>{row.label}</td>
                <td>{shareLabel(row.share)}</td>
                <td>
                  <Amount amount={row.amount} currency={report.currency} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <ul className="mon-spend-list">
          {report.categories.map((row) => (
            <li key={row.id ?? "none"}>
              <div>
                <span>{row.label}</span>
                <span className="mon-report-share">
                  <span className="mon-hint">{shareLabel(row.share)}</span>
                  <Amount amount={row.amount} currency={report.currency} />
                </span>
              </div>
              <div className="mon-bar-track" aria-hidden="true">
                <span style={{ width: `${(row.minor / largest) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Rounds the axis maximum up to 1, 2 or 5 times a power of ten. */
function niceMax(minor: number) {
  if (minor <= 0) return 100;
  const power = 10 ** Math.floor(Math.log10(minor));
  return ([1, 2, 5, 10].find((step) => step * power >= minor) ?? 10) * power;
}

function Months({ report }: { report: MoneyReport }) {
  const [table, setTable] = useState(false);
  const [hovered, setHovered] = useState<string>();
  const [focusedMonth, setFocusedMonth] = useState<string>();
  const [dismissed, setDismissed] = useState(false);
  const active = dismissed ? undefined : (focusedMonth ?? hovered);
  const scale = 10 ** minorUnits(report.currency);
  const tip = useId();
  const top = niceMax(Math.max(0, ...report.months.map((row) => row.minor)));
  const ticks = [0, top / 2, top];
  const width = 100 / report.months.length;
  const index = report.months.findIndex((row) => row.month === active);
  const focused = report.months[index];
  return (
    <section className="mon-panel" aria-labelledby="mon-report-months">
      <div className="mon-panel-heading">
        <h2 id="mon-report-months">Spending by month</h2>
        <Button variant="ghost" size="sm" onClick={() => setTable(!table)}>
          {table ? "Show as chart" : "Show as table"}
        </Button>
      </div>
      {table ? (
        <table className="mon-simple-table">
          <caption className="sr-only">Spending by month</caption>
          <thead>
            <tr>
              <th>Month</th>
              <th>Spend</th>
            </tr>
          </thead>
          <tbody>
            {report.months.map((row) => (
              <tr key={row.month}>
                <td>
                  {monthLabel(row.month, "long")}
                  {partial(row)}
                </td>
                <td>
                  <Amount amount={row.amount} currency={report.currency} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="mon-chart">
          <div className="mon-chart-axis" aria-hidden="true">
            {[...ticks].reverse().map((tick) => (
              <span key={tick}>
                {new Intl.NumberFormat("en-GB", {
                  style: "currency",
                  currency: report.currency,
                  notation: "compact",
                }).format(tick / scale)}
              </span>
            ))}
          </div>
          <div className="mon-chart-plot">
            {ticks.map((tick) => (
              <span
                key={tick}
                className="mon-chart-grid"
                style={{ bottom: `${(tick / top) * 100}%` }}
                aria-hidden="true"
              />
            ))}
            <ul className="mon-chart-bars" aria-label="Spending by month">
              {report.months.map((row) => (
                <li key={row.month} style={{ width: `${width}%` }}>
                  <button
                    type="button"
                    className="mon-chart-hit"
                    aria-describedby={active === row.month ? tip : undefined}
                    onPointerEnter={(event) => {
                      if (event.pointerType === "touch") return;
                      setDismissed(false);
                      setHovered(row.month);
                    }}
                    onPointerLeave={(event) => {
                      if (event.pointerType !== "touch") setHovered(undefined);
                    }}
                    onFocus={() => {
                      setDismissed(false);
                      setFocusedMonth(row.month);
                    }}
                    onBlur={() => setFocusedMonth(undefined)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") setDismissed(true);
                    }}
                  >
                    <span
                      className="mon-chart-bar"
                      style={{ height: `${(Math.max(0, row.minor) / top) * 100}%` }}
                    />
                    <span className="sr-only">
                      {monthLabel(row.month, "long")}
                      {partial(row)}: <Amount amount={row.amount} currency={report.currency} />
                    </span>
                  </button>
                  <span className="mon-chart-label" aria-hidden="true">
                    {monthLabel(row.month).split(" ")[0]}
                  </span>
                </li>
              ))}
            </ul>
            {focused && (
              <div
                className="mon-chart-tip"
                id={tip}
                role="tooltip"
                style={{
                  left: `${Math.min(85, Math.max(15, (index + 0.5) * width))}%`,
                  bottom: `${Math.min(100, (Math.max(0, focused.minor) / top) * 100)}%`,
                }}
              >
                <strong>
                  {monthLabel(focused.month, "long")}
                  {partial(focused)}
                </strong>
                <Amount amount={focused.amount} currency={report.currency} />
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
