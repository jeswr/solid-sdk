// AUTHORED-BY Codex GPT-6.1-Sol
/** Available only in the explicitly enabled dev-fixture build, through the existing backend seam. */
import { ACCOUNTS_KEY, parseAccounts } from "../lib/accounts-store";
import { DemoBackend } from "../session/demo-backend";
import { SolidBackend } from "../session/solid-backend";
import type { SessionBackend, SuiteAccount } from "../session/types";

export const secondDemoAccount: SuiteAccount = {
  id: "test-second-demo",
  kind: "demo",
  name: "Rowan Vale",
  webId: "https://example.org/rowan/profile#me",
  storageUrl: "https://example.org/rowan/",
};

class RememberedFixtureBackend extends DemoBackend {
  async restore(): Promise<SuiteAccount | null> {
    try {
      return parseAccounts(localStorage.getItem(ACCOUNTS_KEY)).accounts.some(
        (account) => account.id === secondDemoAccount.id && account.kind === "demo",
      )
        ? { ...secondDemoAccount }
        : null;
    } catch {
      return null;
    }
  }
  fetchFor(): typeof fetch {
    return async () => {
      throw new Error("This fixture has no storage resources.");
    };
  }
}

export function accountFixtureProps(): { backends?: readonly SessionBackend[] } {
  return process.env.NEXT_PUBLIC_DEV_FIXTURES === "1"
    ? { backends: [new DemoBackend(), new SolidBackend(), new RememberedFixtureBackend()] }
    : {};
}
