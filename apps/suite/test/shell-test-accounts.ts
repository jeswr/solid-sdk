// AUTHORED-BY Codex GPT-6.1-Sol

import { vi } from "vitest";
import type { AccountsContextValue } from "../src/shell/session/accounts-provider";

const ROOT = "https://alice.example/";
const ME = `${ROOT}profile#me`;
export function shellTestAccounts(
  status: AccountsContextValue["status"] = "ready",
): AccountsContextValue {
  const active = { id: "demo", kind: "demo" as const, webId: ME, name: "Alice", storageUrl: ROOT };
  return {
    active,
    accounts: [active],
    status,
    isActiveAccount: () => true,
    fetch: vi.fn(),
    signIn: vi.fn(),
    signInDemo: vi.fn(),
    signInWith: vi.fn(),
    add: vi.fn(),
    switchTo: vi.fn(),
    signOut: vi.fn(),
    signOutAll: vi.fn(),
    reauth: vi.fn(),
    backendKinds: ["demo"],
  };
}
