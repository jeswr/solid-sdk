// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
"use client";
import { createContext, useContext } from "react";
import type { AccountsContextValue } from "./accounts-provider";

export const AccountsContext = createContext<AccountsContextValue | null>(null);

/** Standalone previews and the native session can still use the interim adapters. */
export function useOptionalAccounts() {
  return useContext(AccountsContext);
}

export function useAccounts(): AccountsContextValue {
  const value = useOptionalAccounts();
  if (!value) throw new Error("useAccounts requires AccountsProvider");
  return value;
}
