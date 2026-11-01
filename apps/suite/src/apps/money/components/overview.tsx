// AUTHORED-BY Codex GPT-6
"use client";
import { Button, EmptyState } from "@jeswr/suite-ui";
import { ArrowDownToLine, ArrowUpRight, Plus, Wallet } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { encodeRef } from "@/lib/refs";
import { overview } from "../lib/data/overview";
import { useMoney } from "../state/money-context";
import { AccountDialog, Amount } from "./money-forms";
export function AccountsScreen({ overviewPage = false }: { overviewPage?: boolean }) {
  const money = useMoney();
  const [add, setAdd] = useState(false);
  const [table, setTable] = useState(false);
  const data = overview(money.accounts, money.transactions, money.categories, money.today);
  const category = (id: string | null | undefined) =>
    money.categories.find((c) => c.id === id)?.label ?? "Uncategorised";
  return (
    <>
      <header className="mon-heading">
        <div>
          <p className="mon-eyebrow">Your financial picture</p>
          <h1>{overviewPage ? "Overview" : "Accounts"}</h1>
          <p className="mon-subtitle">A clear view of your money. Kept in your pod.</p>
        </div>
        <div className="mon-actions">
          <Button variant="outline" asChild>
            <Link href="/money/import">
              <ArrowDownToLine size={16} aria-hidden="true" />
              Import statement
            </Link>
          </Button>
          <Button onClick={() => setAdd(true)}>
            <Plus size={16} aria-hidden="true" />
            Add account
          </Button>
        </div>
      </header>
      {!money.accounts.length ? (
        <section className="mon-panel">
          <h2>Get started</h2>
          <EmptyState
            title="Your money starts here"
            body="Add an account, then bring in a statement to see the full picture."
            icon={<Wallet aria-hidden="true" />}
            primaryAction={<Button onClick={() => setAdd(true)}>Add an account</Button>}
            secondaryAction={
              <Button asChild variant="outline">
                <Link href="/money/import">Import a statement</Link>
              </Button>
            }
          />
        </section>
      ) : (
        <>
          {overviewPage && (
            <div className="mon-worth-grid">
              {data.totals.map((total) => (
                <section className="mon-worth" key={total.currency}>
                  <p className="mon-eyebrow">Net worth · {total.currency}</p>
                  <h2>
                    <Amount {...total} />
                  </h2>
                  <p>
                    {money.accounts.filter((a) => a.currency === total.currency).length} accounts ·
                    as of {money.today}
                  </p>
                </section>
              ))}
            </div>
          )}
          <div className={overviewPage ? "mon-columns" : ""}>
            <section className="mon-panel">
              <div className="mon-panel-heading">
                <h2>Your accounts</h2>
                <span className="mon-hint">{money.accounts.length} accounts</span>
              </div>
              <ul className="mon-account-list">
                {money.accounts.map((account) => (
                  <li key={account.id}>
                    <span className="mon-account-icon">
                      <Wallet size={20} aria-hidden="true" />
                    </span>
                    <div>
                      <Link href={`/money/a/${encodeRef(account.id)}`}>{account.label}</Link>
                      <p>
                        {account.type.charAt(0).toUpperCase() + account.type.slice(1)} ·{" "}
                        {account.currency}
                      </p>
                    </div>
                    <Amount amount={account.currentBalance} currency={account.currency} />
                    <ArrowUpRight size={16} aria-hidden="true" />
                  </li>
                ))}
              </ul>
            </section>
            {overviewPage && (
              <section className="mon-panel">
                <div className="mon-panel-heading">
                  <h2>This month</h2>
                  <Button variant="ghost" size="sm" onClick={() => setTable(!table)}>
                    {table ? "Show as bars" : "Show as table"}
                  </Button>
                </div>
                <p className="mon-hint">Outflows by category · inflows and transfers excluded</p>
                {!data.spending.length ? (
                  <p className="mon-soft-empty">No spending this month yet.</p>
                ) : table ? (
                  <table className="mon-simple-table">
                    <caption className="sr-only">This month's spending</caption>
                    <thead>
                      <tr>
                        <th>Category</th>
                        <th>Spend</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.spending.map((row) => (
                        <tr key={`${row.currency}-${row.category}`}>
                          <td>{category(row.category)}</td>
                          <td>
                            <Amount amount={row.amount} currency={row.currency} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <ul className="mon-spend-list">
                    {data.spending.map((row) => (
                      <li key={`${row.currency}-${row.category}`}>
                        <div>
                          <span>{category(row.category)}</span>
                          <Amount amount={row.amount} currency={row.currency} />
                        </div>
                        <div className="mon-bar-track" aria-hidden="true">
                          <span
                            style={{
                              width: `${(Math.max(0, row.minor) / Math.max(1, ...data.spending.filter((s) => s.currency === row.currency).map((s) => s.minor))) * 100}%`,
                            }}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </div>
          {overviewPage && (
            <section className="mon-panel">
              <div className="mon-panel-heading">
                <h2>Recent transactions</h2>
                <span className="mon-hint">Last 10 across your accounts</span>
              </div>
              <ul className="mon-recent">
                {data.recent.map((row) => (
                  <li key={row.id}>
                    <div>
                      <Link href={`/money/a/${encodeRef(row.account)}`}>{row.description}</Link>
                      <p>
                        {row.postingTime.slice(0, 10)} ·{" "}
                        {money.accounts.find((a) => a.id === row.account)?.label} ·{" "}
                        {row.debitAccount ? "Transfer" : category(row.category)}
                      </p>
                    </div>
                    <Amount amount={row.amount} currency={row.currency} signed />
                  </li>
                ))}
              </ul>
              {!data.recent.length && (
                <p className="mon-soft-empty">Import a statement or add your first transaction.</p>
              )}
            </section>
          )}
        </>
      )}
      <AccountDialog open={add} onOpenChange={setAdd} />
    </>
  );
}
