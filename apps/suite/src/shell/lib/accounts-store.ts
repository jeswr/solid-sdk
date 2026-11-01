// AUTHORED-BY Codex GPT-6.1-Sol
import { z } from "zod";
import type { SuiteAccount } from "../session/types";

export const ACCOUNTS_KEY = "suite.accounts.v1";
const publicAccount = z.object({
  id: z.string().min(1),
  webId: z.url({ protocol: /^https?$/ }),
  name: z.string().min(1),
  photoUrl: z.url({ protocol: /^https?$/ }).optional(),
  storageUrl: z.url({ protocol: /^https?$/ }),
  issuer: z.url({ protocol: /^https?$/ }).optional(),
  kind: z.enum(["demo", "solid", "extension"]),
});
export interface AccountsState {
  accounts: SuiteAccount[];
  activeId: string | null;
}
export const emptyAccounts: AccountsState = { accounts: [], activeId: null };
export type AccountsAction =
  | { type: "remember"; account: SuiteAccount }
  | { type: "switch"; id: string }
  | { type: "remove"; id: string }
  | { type: "clear" };

export function accountsReducer(state: AccountsState, action: AccountsAction): AccountsState {
  switch (action.type) {
    case "remember":
      return {
        accounts: [...state.accounts.filter((a) => a.id !== action.account.id), action.account],
        activeId: action.account.id,
      };
    case "switch":
      return state.accounts.some((a) => a.id === action.id)
        ? { ...state, activeId: action.id }
        : state;
    case "remove": {
      const accounts = state.accounts.filter((a) => a.id !== action.id);
      return {
        accounts,
        activeId: state.activeId === action.id ? (accounts[0]?.id ?? null) : state.activeId,
      };
    }
    case "clear":
      return { accounts: [], activeId: null };
  }
}

export function parseAccounts(value: string | null): AccountsState {
  try {
    const parsed: unknown = JSON.parse(value ?? "null");
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !("accounts" in parsed) ||
      !Array.isArray(parsed.accounts)
    )
      return { ...emptyAccounts };
    const accounts: SuiteAccount[] = [];
    for (const item of parsed.accounts) {
      const account = publicAccount.safeParse(item);
      if (account.success && !accounts.some((a) => a.id === account.data.id))
        accounts.push(account.data as SuiteAccount);
    }
    const activeId =
      "activeId" in parsed && accounts.some((a) => a.id === parsed.activeId)
        ? String(parsed.activeId)
        : null;
    return { accounts, activeId };
  } catch {
    return { ...emptyAccounts };
  }
}
/** Round-tripping through the allowlist drops tokens and future private fields. */
export function serializeAccounts(state: AccountsState): string {
  return JSON.stringify(parseAccounts(JSON.stringify(state)));
}
