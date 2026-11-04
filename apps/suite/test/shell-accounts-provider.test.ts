// AUTHORED-BY Codex GPT-6.1-Sol
import { beforeEach, expect, it, vi } from "vitest";
import { AccountsProvider, useAccounts } from "../src/shell/session/accounts-provider";
import type { SessionBackend, SuiteAccount } from "../src/shell/session/types";
import { act, h, mount } from "./drive-ui-dom";

const one: SuiteAccount = {
  id: "one",
  kind: "solid",
  name: "Avery Reed",
  webId: "https://example.org/one#me",
  storageUrl: "https://example.org/one/",
};
const two: SuiteAccount = {
  id: "two",
  kind: "extension",
  name: "Robin Fern",
  webId: "https://example.com/two#me",
  storageUrl: "https://example.com/two/",
};
let accounts: ReturnType<typeof useAccounts>;
function Probe() {
  accounts = useAccounts();
  return null;
}
function backend(account: SuiteAccount): SessionBackend {
  return {
    kind: account.kind,
    restore: async () => account,
    signIn: async () => account,
    signOut: vi.fn(async () => {}),
    fetchFor: () => fetch,
    onExpired: () => () => {},
  };
}
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(
    "suite.accounts.v1",
    JSON.stringify({ activeId: "one", accounts: [one, two] }),
  );
  for (const id of ["one", "two", "removed"]) localStorage.setItem(`suite.recent.v1.${id}`, "[]");
  localStorage.setItem(
    "suite.outbox.v1.one",
    JSON.stringify({
      pending: [
        {
          id: "unsent",
          label: "Rename",
          where: "Drive",
          state: "pending",
          queuedAt: "2026-11-01T12:00:00Z",
        },
      ],
      conflicts: [],
    }),
  );
});

it("removes only the signed-out account's history and retains its pending outbox even if logout fails", async () => {
  const first = backend(one);
  const failure = vi.spyOn(first, "signOut").mockRejectedValue(new Error("provider unavailable"));
  await mount(h(AccountsProvider, { backends: [first, backend(two)], children: h(Probe) }));
  expect(accounts.status).toBe("ready");
  const outbox = localStorage.getItem("suite.outbox.v1.one");
  await act(async () => {
    await expect(accounts.signOut("one")).rejects.toThrow("provider unavailable");
  });
  expect(failure).toHaveBeenCalledWith(one);
  expect(accounts.active?.id).toBe("two");
  expect(localStorage.getItem("suite.recent.v1.one")).toBeNull();
  expect(localStorage.getItem("suite.recent.v1.two")).toBe("[]");
  expect(localStorage.getItem("suite.outbox.v1.one")).toBe(outbox);
});

it("clears every recent-items key on sign-out-all while preserving unsent changes", async () => {
  await mount(h(AccountsProvider, { backends: [backend(one), backend(two)], children: h(Probe) }));
  const outbox = localStorage.getItem("suite.outbox.v1.one");
  await act(async () => {
    await accounts.signOutAll();
  });
  expect(accounts.status).toBe("signed-out");
  expect(accounts.accounts).toEqual([]);
  expect(Object.keys(localStorage).filter((key) => key.startsWith("suite.recent.v1."))).toEqual([]);
  expect(localStorage.getItem("suite.outbox.v1.one")).toBe(outbox);
});
