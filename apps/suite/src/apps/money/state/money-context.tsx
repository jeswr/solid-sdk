// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { toast } from "@jeswr/suite-ui";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PodSession } from "@/lib/session/pod-session";
import { ensureSample } from "../demo/sample";
import type { AccountSummary } from "../lib/data/accounts";
import type { BudgetFile } from "../lib/data/budget";
import { moneyRoot } from "../lib/data/container";
import { type LedgerFilters, ledgerRows } from "../lib/data/ledger";
import type { SavedRule } from "../lib/data/rules";
import type { Category, Range, Transaction } from "../lib/model";
import { type ReadProblem, readMoneySnapshot } from "./read-snapshot";
export interface Snapshot {
  problems?: ReadProblem[];
  accounts: AccountSummary[];
  transactions: Transaction[];
  categories: Category[];
  /** Categorisation rules, in priority order. */
  rules: SavedRule[];
  budgets: BudgetFile[];
  budgetProblem?: unknown;
  /**
   * Why the rules couldn't be loaded, if they couldn't: the file's contents are
   * unusable, or the read failed. Imports fall back to category names meanwhile.
   */
  rulesProblem?: "invalid" | "unavailable" | undefined;
}
type Optimistic = (snapshot: Snapshot) => Snapshot;
interface MoneyState extends Snapshot {
  status: "loading" | "ready" | "empty" | "error";
  error: unknown;
  saving: boolean;
  session: PodSession;
  today: string;
  refresh: () => Promise<void>;
  mutate: (write: () => Promise<unknown>, optimistic?: Optimistic) => Promise<boolean>;
}
const Context = createContext<MoneyState | null>(null);
const empty: Snapshot = {
  accounts: [],
  transactions: [],
  categories: [],
  rules: [],
  budgets: [],
};
export function MoneyProvider({ session, children }: { session: PodSession; children: ReactNode }) {
  const today = new Date().toISOString().slice(0, 10);
  const [snapshot, setSnapshot] = useState(empty);
  const [status, setStatus] = useState<MoneyState["status"]>("loading");
  const [error, setError] = useState<unknown>();
  const [saving, setSaving] = useState(false);
  const baseline = useRef(empty);
  const pending = useRef<{ id: number; apply: Optimistic }[]>([]);
  const generation = useRef(0);
  const invalidated = useRef(false);
  const serial = useRef(Promise.resolve());
  const counter = useRef(0);
  const alive = useRef(true);
  const upgraded = useRef(false);
  const paint = useCallback(() => {
    if (!alive.current) return;
    setSnapshot(pending.current.reduce((value, op) => op.apply(value), baseline.current));
    setSaving(pending.current.length > 0);
  }, []);
  const read = useCallback(async () => {
    const result = await readMoneySnapshot(session, today);
    if (result.upgraded && !upgraded.current) {
      upgraded.current = true;
      toast("Upgraded your categories. Changes will be saved with your next edit.");
    }
    return result;
  }, [session, today]);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    if (pending.current.length) {
      invalidated.current = true;
      return;
    }
    invalidated.current = false;
    try {
      await ensureSample(session);
      const next = await read();
      if (!alive.current || request !== generation.current || pending.current.length) return;
      baseline.current = retainUnread(next, baseline.current);
      paint();
      setError(undefined);
      setStatus(next.accounts.length ? "ready" : "empty");
    } catch (failure) {
      if (alive.current && request === generation.current && !pending.current.length) {
        setError(failure);
        setStatus("error");
      }
    }
  }, [paint, read, session]);
  useEffect(() => {
    alive.current = true;
    let timer: ReturnType<typeof setTimeout>;
    void refresh();
    const unsubscribe = session.subscribe((url) => {
      const root = moneyRoot(session);
      // Extension focus events invalidate the storage root. Ancestor hints cover Money too;
      // require container boundaries so similarly named siblings cannot match.
      if (!url.startsWith(root) && !(url.endsWith("/") && root.startsWith(url))) return;
      invalidated.current = true;
      ++generation.current;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!pending.current.length) void refresh();
      }, 100);
    });
    return () => {
      alive.current = false;
      ++generation.current;
      clearTimeout(timer);
      unsubscribe();
    };
  }, [session, refresh]);
  const mutate = useCallback(
    (write: () => Promise<unknown>, optimistic: Optimistic = (value) => value) => {
      const id = ++counter.current;
      ++generation.current;
      pending.current.push({ id, apply: optimistic });
      paint();
      const task = serial.current.then(async () => {
        let success = true;
        try {
          await write();
        } catch (failure) {
          success = false;
          const conflict =
            typeof failure === "object" &&
            failure !== null &&
            "status" in failure &&
            failure.status === 412;
          toast.error(
            conflict
              ? "This item changed elsewhere. Your data has been refreshed; review it before trying again."
              : failure instanceof Error
                ? failure.message
                : "Couldn't save your changes. Try again.",
          );
        }
        // Always reload: multi-shard writes can finish some shards before a failure.
        const request = ++generation.current;
        try {
          const next = await read();
          if (alive.current && request === generation.current) {
            baseline.current = retainUnread(next, baseline.current);
            setStatus(baseline.current.accounts.length ? "ready" : "empty");
            setError(undefined);
          }
        } catch (failure) {
          if (alive.current && request === generation.current) {
            setError(failure);
            setStatus("error");
          }
        }
        pending.current = pending.current.filter((op) => op.id !== id);
        paint();
        if (alive.current && !pending.current.length && invalidated.current) await refresh();
        return success;
      });
      serial.current = task.then(() => undefined);
      return task;
    },
    [paint, read, refresh],
  );
  const value = useMemo(
    () => ({ ...snapshot, status, error, saving, session, today, refresh, mutate }),
    [snapshot, status, error, saving, session, today, refresh, mutate],
  );
  return <Context value={value}>{children}</Context>;
}
export function useMoney() {
  const value = useContext(Context);
  if (!value) throw new Error("MoneyProvider is required");
  return value;
}
export const useAccounts = () => useMoney().accounts;
export const useCategories = () => useMoney().categories;
export function useTransactions(
  account: AccountSummary | undefined,
  range: Range,
  filters: LedgerFilters = {},
) {
  const money = useMoney();
  return {
    status: money.status,
    error: money.error,
    refresh: money.refresh,
    transactions:
      account && range.start <= range.end
        ? ledgerRows(account, money.transactions, range, filters, money.categories)
        : [],
  };
}

/** Keep the last readable version visible until the failed document can be re-read. */
function retainUnread(next: Snapshot, previous: Snapshot): Snapshot {
  const failed = (id: string) => next.problems?.some((problem) => problem.url === id.split("#")[0]);
  return {
    ...next,
    accounts: [...next.accounts, ...previous.accounts.filter((row) => failed(row.id))],
    transactions: [...next.transactions, ...previous.transactions.filter((row) => failed(row.id))],
    budgets: [
      ...next.budgets,
      ...previous.budgets.filter(
        (row) =>
          next.budgetProblem ||
          next.problems?.some((problem) => problem.url.endsWith(`/budgets/${row.month}.ttl`)),
      ),
    ],
    categories: next.problems?.some((problem) => problem.kind === "categories")
      ? previous.categories
      : next.categories,
    rules: next.rulesProblem ? previous.rules : next.rules,
  };
}
