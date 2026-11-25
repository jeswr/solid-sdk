// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
"use client";
import { Button, EmptyState, ErrorState, IconButton, Input } from "@jeswr/suite-ui";
import { ChevronLeft, ChevronRight, PiggyBank, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { type Allocation, money as amountOf, formatMoney, parseMoney } from "../lib/budget";
import {
  budgetMonthBounds,
  budgetView,
  incomeCategoryIds,
  saveBudgetAssignments,
} from "../lib/data/budget";
import { type Category, type CategoryNode, categoryTree } from "../lib/model";
import { useMoney } from "../state/money-context";
import { Amount } from "./money-forms";
import { focusMoneyHeading } from "./money-states";

const validMonth = (value: string) => /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(value);
function adjacent(month: string, offset: number) {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
}
const decimal = (currency: string, minor: number) => formatMoney(amountOf(currency, minor));

function useBudget(month: string) {
  const state = useMoney();
  return useMemo(() => {
    try {
      if (state.budgetProblem && !state.budgets.length) throw state.budgetProblem;
      return {
        data: budgetView(
          state.budgets,
          state.transactions,
          state.categories,
          month,
          [...new Set(state.accounts.map((account) => account.currency))],
          state.today.slice(0, 7),
        ),
        problem: undefined,
      };
    } catch (problem) {
      return { data: undefined, problem };
    }
  }, [
    state.budgets,
    state.transactions,
    state.categories,
    state.accounts,
    state.budgetProblem,
    state.today,
    month,
  ]);
}

function AssignmentInput({
  category,
  currency,
  month,
  assigned,
}: {
  category: Category;
  currency: string;
  month: string;
  assigned: number;
}) {
  const state = useMoney();
  const id = useId();
  const [draft, setDraft] = useState(decimal(currency, assigned));
  const [error, setError] = useState("");
  const focused = useRef(false);
  const editGeneration = useRef(0);
  const before = useRef<readonly Allocation[]>([]);
  useEffect(() => {
    if (!focused.current) setDraft(decimal(currency, assigned));
  }, [assigned, currency]);
  const save = () => {
    focused.current = false;
    let amount: Allocation["amount"];
    try {
      amount = parseMoney(currency, draft.trim() || "0");
    } catch {
      setError(`Enter an exact amount in ${currency}.`);
      return;
    }
    setError("");
    if (amount.minor === (before.current[0]?.amount.minor ?? 0)) {
      setDraft(decimal(currency, assigned));
      return;
    }
    const changes = [{ categoryId: category.id, amount }];
    const expected = before.current;
    const attempt = ++editGeneration.current;
    void state
      .mutate(
        () => saveBudgetAssignments(state.session, month, changes, expected),
        (snapshot) => {
          const file = snapshot.budgets.find((file) => file.month === month);
          const assignments = [
            ...(file?.assignments ?? []).filter(
              (row) => row.categoryId !== category.id || row.amount.currency !== currency,
            ),
            ...changes,
          ];
          return {
            ...snapshot,
            budgets: [
              ...snapshot.budgets.filter((file) => file.month !== month),
              { month, assignments },
            ],
          };
        },
      )
      .then((success) => {
        if (!success && attempt === editGeneration.current)
          setError("Couldn't save this assignment. Review the refreshed amount and try again.");
      });
  };
  return (
    <div className="mon-budget-input">
      <Input
        id={id}
        aria-label={`Assigned to ${category.label} (${currency})`}
        inputMode="decimal"
        value={draft}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        onFocus={() => {
          ++editGeneration.current;
          focused.current = true;
          before.current =
            state.budgets
              .find((file) => file.month === month)
              ?.assignments.filter(
                (row) => row.categoryId === category.id && row.amount.currency === currency,
              ) ?? [];
        }}
        onChange={(event) => {
          ++editGeneration.current;
          setDraft(event.target.value);
          setError("");
        }}
        onBlur={() => {
          if (focused.current) save();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            focused.current = false;
            setError("");
            setDraft(decimal(currency, assigned));
            event.currentTarget.blur();
          }
        }}
      />
      {error && (
        <span id={`${id}-error`} className="mon-rules-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

function flatten(node: CategoryNode, depth = 0): { category: Category; depth: number }[] {
  return [
    { category: node, depth },
    ...node.children.flatMap((child) => flatten(child, depth + 1)),
  ];
}

export function BudgetScreen() {
  const state = useMoney();
  const params = useSearchParams();
  const router = useRouter();
  const selected = params.get("m");
  const bounds = budgetMonthBounds(state.budgets, state.transactions, state.today.slice(0, 7));
  const accepted =
    selected && validMonth(selected) && selected >= bounds.min && selected <= bounds.max;
  const month = accepted ? selected : state.today.slice(0, 7);
  const { data, problem } = useBudget(month);
  const title = new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T00:00:00Z`));
  const incomeIds = incomeCategoryIds(state.categories);
  const roots = categoryTree(state.categories).filter((node) => !incomeIds.has(node.id));
  const assigned = state.budgets.find((file) => file.month === month)?.assignments ?? [];
  const previous =
    month === "0001-01"
      ? []
      : (state.budgets.find((file) => file.month === adjacent(month, -1))?.assignments ?? []);
  const copy = () => {
    void state.mutate(
      () => saveBudgetAssignments(state.session, month, previous, assigned, true),
      (snapshot) => ({
        ...snapshot,
        budgets: [
          ...snapshot.budgets.filter((file) => file.month !== month),
          {
            month,
            assignments: [
              ...assigned.filter(
                (row) =>
                  !previous.some(
                    (other) =>
                      other.categoryId === row.categoryId &&
                      other.amount.currency === row.amount.currency,
                  ),
              ),
              ...previous,
            ],
          },
        ],
      }),
    );
  };
  return (
    <>
      <header className="mon-heading">
        <div>
          <p className="mon-eyebrow">Give your money a purpose</p>
          <h1>Budget</h1>
          <p className="mon-subtitle">
            Assign income to envelopes. Unspent money and overspending carry forward.
          </p>
        </div>
      </header>
      <nav className="mon-budget-month" aria-label="Budget month">
        <IconButton
          label="Previous month"
          variant="outline"
          disabled={month <= bounds.min}
          onClick={() => router.push(`/money/budget?m=${adjacent(month, -1)}`)}
        >
          <ChevronLeft aria-hidden="true" />
        </IconButton>
        <p role="status">{title}</p>
        <IconButton
          label="Next month"
          variant="outline"
          disabled={month >= bounds.max}
          onClick={() => router.push(`/money/budget?m=${adjacent(month, 1)}`)}
        >
          <ChevronRight aria-hidden="true" />
        </IconButton>
        <Button variant="ghost" asChild>
          <Link href={`/money/budget?m=${state.today.slice(0, 7)}`}>This month</Link>
        </Button>
      </nav>
      {selected && !accepted && (
        <p role="status" className="mon-hint">
          That month is invalid or outside the allowed range. Showing this month.
        </p>
      )}
      {problem || !data ? (
        <section className="mon-panel">
          <h2>Couldn't calculate your budget</h2>
          <p>
            {state.budgetProblem
              ? "We couldn't read your saved budget. Try again to refresh it."
              : "Check for unsupported currencies or amounts with extra decimal places, then retry."}
          </p>
          <ErrorState
            error="unreachable"
            actions={{
              retry: async () => {
                await state.refresh();
                focusMoneyHeading();
              },
            }}
          />
        </section>
      ) : (
        <>
          <div className="mon-budget-tools">
            <Button
              variant="outline"
              disabled={
                assigned.some((row) => row.amount.minor !== 0) || !previous.length || state.saving
              }
              onClick={copy}
            >
              {`Assign last month's amounts`}
            </Button>
            <p className="mon-hint">
              Available for empty months. Edit an assignment, then press Enter or leave the field to
              save. Escape cancels.
            </p>
          </div>
          {!assigned.length && (
            <section className="mon-panel mon-budget-empty">
              <EmptyState
                title="Assign money to categories to start budgeting"
                icon={<PiggyBank aria-hidden="true" />}
                body={
                  roots.length
                    ? data.current.currencies.length
                      ? "Choose a category below and give it an amount."
                      : "Add an account to choose the currency for your budget envelopes."
                    : "Create categories to plan how your money will be spent."
                }
                primaryAction={
                  roots.length && data.current.currencies.length ? (
                    <Button
                      onClick={() =>
                        document.querySelector<HTMLInputElement>(".mon-budget-input input")?.focus()
                      }
                    >
                      Assign money
                    </Button>
                  ) : (
                    <Button asChild>
                      <Link href={roots.length ? "/money/accounts" : "/money/categories"}>
                        {roots.length ? "Add an account" : "Add categories"}
                      </Link>
                    </Button>
                  )
                }
              />
            </section>
          )}
          {data.uncategorised > 0 && (
            <p className="mon-rules-warning" role="status">
              {`${data.uncategorised} uncategorised outflows are excluded from envelopes. Categorise them in your account ledgers to include them.`}{" "}
              <Link href="/money/accounts">Review accounts</Link>
            </p>
          )}
          {data.current.currencies.map((budget) => {
            const retained = budget.envelopes.filter(
              (row) =>
                incomeIds.has(row.categoryId) ||
                !state.categories.some((category) => category.id === row.categoryId),
            );
            const groups = [
              ...roots.map((root) => ({ id: root.id, label: root.label, rows: flatten(root) })),
              ...(retained.length
                ? [
                    {
                      id: "removed",
                      label: "Other and removed categories",
                      rows: retained.map((row, index) => ({
                        category: state.categories.find(
                          (category) => category.id === row.categoryId,
                        ) ?? { id: row.categoryId, label: `Removed category ${index + 1}` },
                        depth: 0,
                      })),
                    },
                  ]
                : []),
            ];
            return (
              <section
                className="mon-budget-currency"
                key={budget.currency}
                aria-label={`Budget in ${budget.currency}`}
              >
                <div
                  className={`mon-worth mon-budget-ready ${budget.availableToBudget < 0 ? "mon-budget-warning" : ""}`}
                  aria-live="polite"
                >
                  <p className="mon-eyebrow">Ready to assign · {budget.currency}</p>
                  <h2>
                    <Amount
                      amount={decimal(budget.currency, budget.availableToBudget)}
                      currency={budget.currency}
                    />
                  </h2>
                  {budget.availableToBudget < 0 && (
                    <p>
                      <TriangleAlert size={16} aria-hidden="true" /> Over-assigned — reduce
                      assignments to cover the shortfall.
                    </p>
                  )}
                </div>
                {groups.map((group) => (
                  <section
                    className="mon-panel mon-budget-group"
                    key={group.id}
                    aria-label={`${group.label} · ${budget.currency}`}
                  >
                    <h3>{group.label}</h3>
                    <table className="mon-simple-table mon-budget-table">
                      <caption className="sr-only">{`${group.label} envelopes in ${budget.currency}`}</caption>
                      <thead>
                        <tr>
                          <th scope="col">Category</th>
                          <th scope="col">Assigned</th>
                          <th scope="col">Activity</th>
                          <th scope="col">Available</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.rows.map(({ category, depth }) => {
                          const row = budget.envelopes.find(
                            (row) => row.categoryId === category.id,
                          );
                          const available = row?.available ?? 0;
                          return (
                            <tr key={category.id}>
                              <th scope="row">
                                <span
                                  style={{ paddingInlineStart: `calc(var(--space-3) * ${depth})` }}
                                >
                                  {category.label}
                                </span>
                              </th>
                              <td data-label="Assigned">
                                <AssignmentInput
                                  category={category}
                                  currency={budget.currency}
                                  month={month}
                                  key={month}
                                  assigned={row?.assigned ?? 0}
                                />
                              </td>
                              <td data-label="Activity">
                                <Amount
                                  amount={decimal(budget.currency, row?.activity ?? 0)}
                                  currency={budget.currency}
                                  signed
                                />
                              </td>
                              <td
                                data-label="Available"
                                className={available < 0 ? "mon-budget-overspent" : ""}
                              >
                                <Amount
                                  amount={decimal(budget.currency, available)}
                                  currency={budget.currency}
                                />
                                {available < 0 && (
                                  <span className="mon-budget-flag">
                                    <TriangleAlert size={14} aria-hidden="true" />
                                    Overspent
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </section>
                ))}
              </section>
            );
          })}
          <p className="mon-hint">{`Budget history starts ${data.start}. Account balance snapshots are not counted as income.`}</p>
        </>
      )}
    </>
  );
}

export function BudgetSummary() {
  const state = useMoney();
  const { data, problem } = useBudget(state.today.slice(0, 7));
  return (
    <section className="mon-panel mon-budget-summary" aria-label="Budget this month">
      <div className="mon-panel-heading">
        <h2>Budget this month</h2>
        <Link href="/money/budget">Open budget</Link>
      </div>
      {problem || !data ? (
        <p>
          Budget unavailable.{" "}
          <Button
            variant="ghost"
            onClick={async () => {
              await state.refresh();
              focusMoneyHeading();
            }}
          >
            Retry
          </Button>
        </p>
      ) : data.current.currencies.length ? (
        <ul>
          {data.current.currencies.map((budget) => (
            <li key={budget.currency}>
              <span>Ready to assign · {budget.currency}</span>
              <Amount
                currency={budget.currency}
                amount={decimal(budget.currency, budget.availableToBudget)}
              />
              <span>
                {budget.availableToBudget < 0 ? "Over-assigned · " : ""}
                {budget.envelopes.filter((row) => row.available < 0).length} overspent envelopes
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p>Assign money to categories to start budgeting.</p>
      )}
    </section>
  );
}
