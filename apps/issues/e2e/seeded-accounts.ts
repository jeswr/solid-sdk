// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { CSS_BASE } from "./helpers";

export interface SeededAccount {
  webId: string;
  podRoot: string;
  inboxUrl: string;
  email: string;
  password: string;
}

/** Consume only the disposable, local accounts created by global setup. */
export function seededAccounts(): { alice: SeededAccount; bob: SeededAccount } {
  const value = process.env.SOLID_E2E_ACCOUNTS;
  if (!value) throw new Error("Run through Playwright global setup to seed the local CSS accounts.");
  const accounts = JSON.parse(value) as { alice: SeededAccount; bob: SeededAccount };
  for (const account of [accounts.alice, accounts.bob]) {
    if (
      new URL(account.webId).origin !== CSS_BASE ||
      !account.inboxUrl.startsWith(account.podRoot) ||
      new URL(account.podRoot).origin !== CSS_BASE
    ) throw new Error("Seeded accounts must belong to the local CSS.");
  }
  return accounts;
}
