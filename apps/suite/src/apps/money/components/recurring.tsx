// AUTHORED-BY Claude Opus 5.5
"use client";
import { EmptyState } from "@jeswr/suite-ui";
import Link from "next/link";
import { useMemo } from "react";
import { encodeRef } from "@/lib/refs";
import {
  describeRecurrence,
  type RecurringPayment,
  recurringPayments,
} from "../lib/data/recurring";
import { useMoney } from "../state/money-context";
import { Amount } from "./money-forms";

const day = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

function PaymentList({
  title,
  payments,
  accounts,
}: {
  title: string;
  payments: readonly RecurringPayment[];
  accounts: ReadonlyMap<string, string>;
}) {
  const id = `mon-recurring-${title.toLowerCase()}`;
  return (
    <section className="mon-panel mon-recurring" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      <ul>
        {payments.map((payment) => (
          <li key={payment.key} className="mon-recurring-row">
            <span className="mon-recurring-main">
              <strong>{payment.payee}</strong>
              <span className="mon-recurring-meta">
                {describeRecurrence(payment.recurrence)}
                {accounts.get(payment.accountId) && (
                  <>
                    {" · "}
                    <Link href={`/money/a/${encodeRef(payment.accountId)}`}>
                      {accounts.get(payment.accountId)}
                    </Link>
                  </>
                )}
              </span>
            </span>
            <span className="mon-recurring-side">
              <Amount amount={payment.amount} currency={payment.currency} />
              <span className="mon-recurring-meta">Next {day(payment.nextDate)}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function RecurringScreen() {
  const money = useMoney();
  const payments = useMemo(
    () => recurringPayments(money.transactions, money.today),
    [money.transactions, money.today],
  );
  const accounts = useMemo(
    () => new Map(money.accounts.map((account) => [account.id, account.label])),
    [money.accounts],
  );
  const bills = payments.filter((payment) => payment.amount.startsWith("-"));
  const income = payments.filter((payment) => !payment.amount.startsWith("-"));
  return (
    <>
      <header className="mon-heading">
        <div>
          <p className="mon-eyebrow">Plan ahead</p>
          <h1>Recurring</h1>
          <p className="mon-subtitle">
            Bills and income that repeat on a schedule, found in your transactions.
          </p>
        </div>
      </header>
      {!payments.length ? (
        <section className="mon-panel">
          <EmptyState
            title="Nothing repeating yet"
            body="A payment shows up here once it has happened three times on a regular schedule: weekly, every 2 weeks, monthly or yearly."
          />
        </section>
      ) : (
        <>
          {bills.length > 0 && <PaymentList title="Bills" payments={bills} accounts={accounts} />}
          {income.length > 0 && (
            <PaymentList title="Income" payments={income} accounts={accounts} />
          )}
          <p className="mon-hint">
            Found from at least three payments with the same description on a regular schedule. A
            schedule that misses its date by more than a week is hidden.
          </p>
        </>
      )}
    </>
  );
}
