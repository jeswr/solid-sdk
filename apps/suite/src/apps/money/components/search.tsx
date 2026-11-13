// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
"use client";
import { Button, EmptyState } from "@jeswr/suite-ui";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { encodeRef } from "@/lib/refs";
import { useMoney } from "../state/money-context";
import { Amount } from "./money-forms";
export function SearchScreen() {
  const money = useMoney();
  const query = useSearchParams().get("q") ?? "";
  const since = new Date(`${money.today}T00:00:00Z`);
  since.setUTCDate(1);
  since.setUTCMonth(since.getUTCMonth() - 23);
  const rows = money.transactions
    .filter(
      (row) =>
        row.postingTime >= since.toISOString().slice(0, 10) &&
        `${row.payee ?? ""} ${row.description}`.toLowerCase().includes(query.toLowerCase()),
    )
    .sort((a, b) => b.postingTime.localeCompare(a.postingTime));
  return (
    <>
      <header className="mon-heading">
        <div>
          <p className="mon-eyebrow">Last 24 months</p>
          <h1>Results for “{query}”</h1>
          <p className="mon-subtitle" role="status">
            {rows.length} transactions found
          </p>
        </div>
      </header>
      <section className="mon-panel">
        <h2 className="sr-only">Search results</h2>
        {rows.length ? (
          <ul className="mon-recent">
            {rows.map((row) => (
              <li key={row.id}>
                <div>
                  <Link href={`/money/a/${encodeRef(row.account)}`}>{row.description}</Link>
                  <p>
                    {row.postingTime.slice(0, 10)} ·{" "}
                    {money.accounts.find((a) => a.id === row.account)?.label} ·{" "}
                    {row.debitAccount || row.creditAccount
                      ? "Transfer"
                      : (money.categories.find((category) => category.id === row.category)?.label ??
                        "Uncategorised")}
                  </p>
                </div>
                <Amount amount={row.amount} currency={row.currency} signed />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            variant={query ? "no-results" : "first-use"}
            title={
              query
                ? undefined
                : money.transactions.length
                  ? "No transactions in the last 24 months"
                  : "No transactions to search yet"
            }
            body={
              query ? undefined : "Import a statement to search your transactions across accounts."
            }
            query={query}
            primaryAction={
              <Button variant="outline" asChild>
                <Link href={query ? "/money/search" : "/money/import"}>
                  {query ? "Clear search" : "Import a statement"}
                </Link>
              </Button>
            }
          />
        )}
      </section>
    </>
  );
}
