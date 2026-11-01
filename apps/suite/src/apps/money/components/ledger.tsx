// AUTHORED-BY Codex GPT-6
"use client";
import { Button, DataTable, EmptyState, FilterChips, Input, useSelection } from "@jeswr/suite-ui";
import { DateTimeField } from "@jeswr/suite-ui/date-time";
import { ArrowLeftRight, Pencil, Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { renameAccount } from "../lib/data/accounts";
import { bulkCategorise, categorised, deleteTransaction } from "../lib/data/ledger";
import type { Range, Transaction } from "../lib/model";
import { useMoney, useTransactions } from "../state/money-context";
import {
  Amount,
  CategorySelect,
  Modal,
  MoneySelect,
  TransactionDialog,
  TransferDialog,
} from "./money-forms";

function rangeFor(preset: string, today: string): Range {
  const now = new Date(`${today}T00:00:00Z`);
  let start = today;
  let end = `${today}T23:59:59.999Z`;
  if (preset === "month") start = `${today.slice(0, 7)}-01`;
  else if (preset === "last") {
    const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
    end = `${at.toISOString().slice(0, 10)}T23:59:59.999Z`;
    start = `${end.slice(0, 7)}-01`;
  } else if (preset === "year") start = `${today.slice(0, 4)}-01-01`;
  else {
    now.setUTCDate(now.getUTCDate() - 89);
    start = now.toISOString().slice(0, 10);
  }
  return { start, end };
}
export function LedgerScreen({ accountId }: { accountId: string }) {
  const money = useMoney();
  const account = money.accounts.find((a) => a.id === accountId);
  const [presets, setPresets] = useState(["month"]);
  const [custom, setCustom] = useState<Range>(rangeFor("90", money.today));
  const [category, setCategory] = useState<string>();
  const [sign, setSign] = useState("all");
  const [query, setQuery] = useState("");
  const [add, setAdd] = useState(false);
  const [transfer, setTransfer] = useState(false);
  const [edit, setEdit] = useState<Transaction>();
  const [deleting, setDeleting] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState("");
  const selection = useSelection();
  const range = presets[0] === "custom" ? custom : rangeFor(presets[0] ?? "90", money.today);
  const result = useTransactions(account, range, {
    category,
    query,
    sign: sign === "all" ? undefined : (sign as "in" | "out"),
  });
  const rows = result.transactions.reverse();
  // Selection is scoped to the visible range and filter, including the phone cards.
  const visible = rows.map((row) => row.id).join("|");
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  useEffect(() => {
    void visible;
    selectionRef.current.clear();
  }, [visible]);
  if (!account)
    return (
      <>
        <h1>Account not found</h1>
        <section className="mon-panel">
          <h2>Choose an account</h2>
          <EmptyState
            title="This account isn't here"
            body="Open one of your accounts from the overview."
            primaryAction={
              <Button asChild>
                <Link href="/money">Go to overview</Link>
              </Button>
            }
          />
        </section>
      </>
    );
  const ids = [...selection.selectedKeys];
  const categorise = (ids: string[], value?: string) =>
    void money.mutate(
      () => bulkCategorise(money.session, ids, value),
      (snapshot) => ({
        ...snapshot,
        transactions: snapshot.transactions.map((row) =>
          ids.includes(row.id) ? categorised(row, value) : row,
        ),
      }),
    );
  return (
    <>
      <header className="mon-heading">
        <div>
          <Link href="/money/accounts" className="mon-back">
            Accounts
          </Link>
          <div className="mon-account-title">
            <h1>{account.label}</h1>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Rename account"
              onClick={() => {
                setName(account.label);
                setRenaming(true);
              }}
            >
              <Pencil size={16} aria-hidden="true" />
            </Button>
          </div>
          <p className="mon-subtitle">
            {account.type} · {account.currency} · Current balance{" "}
            <Amount amount={account.currentBalance} currency={account.currency} />
          </p>
        </div>
        <div className="mon-actions">
          <Button variant="outline" asChild>
            <Link href={`/money/import?account=${encodeURIComponent(account.id)}`}>Import</Link>
          </Button>
          <Button variant="outline" onClick={() => setTransfer(true)}>
            <ArrowLeftRight size={16} aria-hidden="true" />
            Transfer
          </Button>
          <Button onClick={() => setAdd(true)}>
            <Plus size={16} aria-hidden="true" />
            Add transaction
          </Button>
        </div>
      </header>
      <section className="mon-panel mon-ledger">
        <h2 className="sr-only">Transactions</h2>
        <div className="mon-filters">
          <FilterChips
            label="Date range"
            options={[
              { id: "month", label: "This month" },
              { id: "last", label: "Last month" },
              { id: "90", label: "Last 90 days" },
              { id: "year", label: "This year" },
              { id: "custom", label: "Custom range" },
            ]}
            value={presets}
            onChange={(values) =>
              setPresets(values.length ? [values[values.length - 1] as string] : [])
            }
            resultCount={rows.length}
          />
          {presets[0] === "custom" && (
            <div className="mon-two-fields">
              <DateTimeField
                label="From date"
                locale="en-GB"
                value={{ kind: "date", date: custom.start }}
                onChange={(value) => {
                  if (value?.kind === "date") setCustom({ ...custom, start: value.date });
                }}
              />
              <DateTimeField
                label="To date"
                locale="en-GB"
                value={{ kind: "date", date: custom.end.slice(0, 10) }}
                onChange={(value) => {
                  if (value?.kind === "date")
                    setCustom({ ...custom, end: `${value.date}T23:59:59.999Z` });
                }}
              />
            </div>
          )}
          {range.start > range.end && <p role="alert">End date must be after the start date.</p>}
          <div className="mon-filter-row">
            <label className="mon-field" htmlFor="mon-ledger-search">
              Search transactions
              <Input
                id="mon-ledger-search"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Payee or description"
              />
            </label>
            <MoneySelect
              label="Filter category"
              value={category ?? "all"}
              onChange={(value) => setCategory(value === "all" ? undefined : value)}
              options={[
                { value: "all", label: "All categories" },
                { value: "uncategorised", label: "Uncategorised" },
                ...money.categories.map((c) => ({ value: c.id, label: c.label })),
              ]}
            />
            <MoneySelect
              label="Amount"
              value={sign}
              onChange={setSign}
              options={[
                { value: "all", label: "Money in and out" },
                { value: "in", label: "Money in" },
                { value: "out", label: "Money out" },
              ]}
            />
          </div>
        </div>
        {ids.length > 0 && (
          <div className="mon-bulk" role="toolbar" aria-label="Selection actions">
            <strong>{ids.length} selected</strong>
            <CategorySelect
              label="Categorise selected as"
              onChange={(value) => categorise(ids, value)}
            />
            <Button variant="outline" onClick={() => setDeleting(true)}>
              Delete selected
            </Button>
            <Button variant="ghost" onClick={selection.clear}>
              Clear selection
            </Button>
          </div>
        )}
        {!rows.length ? (
          <EmptyState
            title="No transactions in this view"
            body="Try another date range, import a statement, or add a transaction."
            primaryAction={<Button onClick={() => setAdd(true)}>Add transaction</Button>}
            secondaryAction={
              <Button
                variant="outline"
                onClick={() => {
                  setPresets(["90"]);
                  setCategory(undefined);
                  setSign("all");
                  setQuery("");
                }}
              >
                Clear filters
              </Button>
            }
          />
        ) : (
          <>
            <div className="mon-desktop" data-selection-empty={ids.length === 0}>
              <DataTable
                label="Transactions"
                items={rows}
                getKey={(row) => row.id}
                getLabel={(row) => row.description}
                selection={selection}
                onOpen={setEdit}
                height={520}
                columns={[
                  {
                    id: "date",
                    header: "Date",
                    accessor: (row) => row.postingTime,
                    size: 120,
                    minSize: 110,
                    render: (row) => <span>{row.postingTime.slice(0, 10)}</span>,
                  },
                  {
                    id: "payee",
                    header: "Payee / Description",
                    accessor: (row) => row.description,
                    size: 240,
                    minSize: 160,
                    render: (row) => (
                      <button type="button" className="mon-row-open" onClick={() => setEdit(row)}>
                        {row.description}
                        {row.debitAccount && (
                          <span className="mon-transfer-label">Paired transfer</span>
                        )}
                      </button>
                    ),
                  },
                  {
                    id: "category",
                    header: "Category",
                    accessor: (row) => row.category ?? "",
                    size: 190,
                    minSize: 160,
                    render: (row) =>
                      row.debitAccount ? (
                        <span>Transfer</span>
                      ) : (
                        <CategorySelect
                          label={`Category for ${row.description}`}
                          value={row.category}
                          onChange={(value) => categorise([row.id], value)}
                        />
                      ),
                  },
                  {
                    id: "amount",
                    header: "Amount",
                    accessor: (row) => Number(row.amount),
                    size: 130,
                    minSize: 120,
                    render: (row) => <Amount amount={row.amount} currency={row.currency} signed />,
                  },
                  {
                    id: "balance",
                    header: "Balance",
                    accessor: (row) => Number(row.runningBalance),
                    size: 130,
                    minSize: 120,
                    render: (row) => <Amount amount={row.runningBalance} currency={row.currency} />,
                  },
                ]}
              />
            </div>
            <section className="mon-cards" aria-label="Transaction cards">
              <label className="mon-select-all">
                <input
                  type="checkbox"
                  checked={rows.every((row) => selection.selectedKeys.has(row.id))}
                  onChange={() => selection.toggleAll(rows.map((row) => row.id))}
                />
                Select all transactions
              </label>
              {rows.map((row) => (
                <article className="mon-ledger-card" key={row.id}>
                  <div className="mon-card-top">
                    <input
                      type="checkbox"
                      aria-label={`Select ${row.description}`}
                      checked={selection.selectedKeys.has(row.id)}
                      onChange={() => selection.toggle(row.id)}
                    />
                    <button type="button" className="mon-row-open" onClick={() => setEdit(row)}>
                      {row.description}
                    </button>
                    <Amount amount={row.amount} currency={row.currency} signed />
                  </div>
                  <div className="mon-card-bottom">
                    <time>{row.postingTime.slice(0, 10)}</time>
                    {row.debitAccount ? (
                      <span>Paired transfer</span>
                    ) : (
                      <CategorySelect
                        label={`Category for ${row.description}`}
                        value={row.category}
                        onChange={(value) => categorise([row.id], value)}
                      />
                    )}
                  </div>
                  <p className="mon-card-balance">
                    Balance <Amount amount={row.runningBalance} currency={row.currency} />
                  </p>
                </article>
              ))}
            </section>
          </>
        )}
      </section>
      <Modal
        open={renaming}
        onOpenChange={setRenaming}
        title="Rename account"
        description="Choose a name for this account."
      >
        <form
          className="mon-form"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!name.trim()) return;
            if (
              await money.mutate(
                () => renameAccount(money.session, account.id, name.trim()),
                (snapshot) => ({
                  ...snapshot,
                  accounts: snapshot.accounts.map((a) =>
                    a.id === account.id ? { ...a, label: name.trim() } : a,
                  ),
                }),
              )
            )
              setRenaming(false);
          }}
        >
          <label htmlFor="mon-account-name">
            Account name
            <Input
              id="mon-account-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </label>
          <Button type="submit" disabled={money.saving || !name.trim()}>
            Save name
          </Button>
        </form>
      </Modal>
      <TransactionDialog
        account={account}
        open={add || Boolean(edit)}
        transaction={edit}
        onOpenChange={(open) => {
          if (!open) {
            setAdd(false);
            setEdit(undefined);
          }
        }}
      />
      <TransferDialog account={account} open={transfer} onOpenChange={setTransfer} />
      <Modal
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete ${ids.length} transactions?`}
        description="This cannot be undone. Paired transfers cannot be deleted individually."
      >
        <Button
          variant="destructive"
          onClick={async () => {
            if (
              await money.mutate(
                async () => {
                  const selected = money.transactions.filter((row) => ids.includes(row.id));
                  if (selected.some((row) => row.debitAccount))
                    throw new Error("Exclude paired transfers before deleting transactions");
                  for (const row of selected) await deleteTransaction(money.session, row);
                },
                (snapshot) => ({
                  ...snapshot,
                  transactions: snapshot.transactions.filter((row) => !ids.includes(row.id)),
                }),
              )
            ) {
              setDeleting(false);
              selection.clear();
            }
          }}
        >
          Delete transactions
        </Button>
      </Modal>
    </>
  );
}
