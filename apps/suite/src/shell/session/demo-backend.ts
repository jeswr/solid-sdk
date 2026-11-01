// AUTHORED-BY Codex GPT-6.1-Sol
import { getDemoPod } from "../../lib/demo-pod/browser";
import { DEMO_NAME, DEMO_ROOT, DEMO_WEBID } from "../../lib/demo-pod/seed";
import { ACCOUNTS_KEY, parseAccounts } from "../lib/accounts-store";
import type { SessionBackend, SuiteAccount } from "./types";

export const demoAccount: SuiteAccount = {
  id: "demo",
  webId: DEMO_WEBID,
  name: DEMO_NAME,
  storageUrl: DEMO_ROOT,
  kind: "demo",
};

export class DemoBackend implements SessionBackend {
  readonly kind = "demo";
  async restore(): Promise<SuiteAccount | null> {
    try {
      const state = parseAccounts(localStorage.getItem(ACCOUNTS_KEY));
      return state.activeId === demoAccount.id ? { ...demoAccount } : null;
    } catch {
      return null;
    }
  }
  async signIn(): Promise<SuiteAccount> {
    return { ...demoAccount };
  }
  async signOut(): Promise<void> {}
  fetchFor(): typeof fetch {
    return async (input, init) => (await getDemoPod()).fetch(input, init);
  }
  onExpired(): () => void {
    return () => {};
  }
}
