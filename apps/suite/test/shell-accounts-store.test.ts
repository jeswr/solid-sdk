// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import {
  ACCOUNTS_KEY,
  accountsReducer,
  emptyAccounts,
  parseAccounts,
  serializeAccounts,
} from "../src/shell/lib/accounts-store";
import type { SuiteAccount } from "../src/shell/session/types";

const first: SuiteAccount = {
  id: "a",
  name: "Alex Example",
  webId: "https://example.org/alex#me",
  storageUrl: "https://example.org/alex/",
  issuer: "https://id.example.org/",
  photoUrl: "https://example.org/avatar.png",
  kind: "solid",
};
const second: SuiteAccount = {
  id: "b",
  name: "Robin Example",
  webId: "https://example.com/robin#me",
  storageUrl: "https://example.com/robin/",
  kind: "demo",
};
describe("remembered accounts", () => {
  it("remembers, updates, and switches without duplicates", () => {
    expect(ACCOUNTS_KEY).toBe("suite.accounts.v1");
    let state = accountsReducer(emptyAccounts, { type: "remember", account: first });
    state = accountsReducer(state, { type: "remember", account: second });
    state = accountsReducer(state, { type: "remember", account: { ...first, name: "Updated" } });
    expect(state.accounts).toEqual([second, { ...first, name: "Updated" }]);
    expect(state.activeId).toBe("a");
    expect(accountsReducer(state, { type: "switch", id: "missing" })).toBe(state);
    expect(accountsReducer(state, { type: "switch", id: "b" }).activeId).toBe("b");
  });
  it("chooses the next account on active signout, keeps the active on other signout, and clears all", () => {
    const state = { accounts: [first, second], activeId: "a" };
    expect(accountsReducer(state, { type: "remove", id: "b" })).toEqual({
      accounts: [first],
      activeId: "a",
    });
    expect(accountsReducer(state, { type: "remove", id: "a" })).toEqual({
      accounts: [second],
      activeId: "b",
    });
    expect(
      accountsReducer({ accounts: [first], activeId: "a" }, { type: "remove", id: "a" }),
    ).toEqual(emptyAccounts);
    expect(accountsReducer(state, { type: "clear" })).toEqual(emptyAccounts);
  });
  it.each([
    null,
    "{",
    "null",
    "1",
    "[]",
    "{}",
    '{"accounts":{}}',
    '{"accounts":[null,{}, {"id":"x","kind":"alien"}]}',
  ])("tolerates corrupt storage %j", (value) =>
    expect(parseAccounts(value)).toEqual(emptyAccounts));
  it("filters invalid entries and duplicates, and validates the active pointer", () => {
    expect(
      parseAccounts(
        JSON.stringify({
          accounts: [first, null, first, { ...second, storageUrl: "file:///private" }, second],
          activeId: "b",
        }),
      ),
    ).toEqual({ accounts: [first, second], activeId: "b" });
    expect(
      parseAccounts(JSON.stringify({ accounts: [first], activeId: "unknown" })).activeId,
    ).toBeNull();
    expect(parseAccounts(JSON.stringify({ accounts: [first] })).activeId).toBeNull();
  });
  it("serializes only allowlisted public metadata, never credentials", () => {
    const serialized = serializeAccounts({
      accounts: [
        { ...first, accessToken: "SECRET", refreshToken: "SECRET", dpopKey: "SECRET" },
        second,
      ] as SuiteAccount[],
      activeId: "a",
    });
    expect(serialized).not.toContain("SECRET");
    expect(JSON.parse(serialized)).toEqual({ accounts: [first, second], activeId: "a" });
    expect(emptyAccounts).toEqual({ accounts: [], activeId: null });
  });
});
