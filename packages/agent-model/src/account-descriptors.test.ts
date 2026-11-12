// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it } from "vitest";
import {
  type Account,
  accountBinding,
  accountDescriptor,
  accountDescriptorConflict,
} from "./index.js";
import { exampleRecords } from "./testing.js";

const account: Account = {
  ...exampleRecords.account,
  id: "https://alice.demo.pod/agent/accounts/personal.ttl",
  provider: "gmail",
};

describe("account capability selection", () => {
  const shared = { ...exampleRecords["channel-capability"], binding: "gmail" };
  const own = {
    ...shared,
    id: `${shared.id}-own`,
    account: account.id,
    grantedScopes: ["mail.read"],
  };
  const other = { ...own, id: `${shared.id}-other`, account: `${account.id}-other` };
  it("uses account-specific observations before shared capabilities, independent of listing order", () => {
    expect(accountDescriptor(account, [shared, other, own])).toBe(own);
    expect(accountDescriptor(account, [own, shared])).toBe(own);
    expect(accountDescriptor(account, [other, shared])).toBe(shared);
    expect(accountDescriptor(account, [other])).toBeUndefined();
    expect(accountDescriptor(account, [{ ...own, binding: "matrix" }])).toBeUndefined();
    expect(accountDescriptor(account, [])).toBeUndefined();
  });
  it("reports disagreeing records as a conflict instead of choosing one", () => {
    expect(accountDescriptorConflict(account, [own, { ...own, id: `${own.id}-2` }])).toBe(true);
    expect(accountDescriptorConflict(account, [shared, { ...shared, id: `${shared.id}-2` }])).toBe(
      true,
    );
    expect(accountDescriptorConflict(account, [own, shared, other])).toBe(false);
    expect(accountDescriptorConflict(account, [])).toBe(false);
  });
  it("does not silently choose between disagreeing descriptor records", () => {
    expect(
      accountDescriptor(account, [own, { ...own, id: `${own.id}-duplicate` }, shared]),
    ).toBeUndefined();
    expect(
      accountDescriptor(account, [shared, { ...shared, id: `${shared.id}-duplicate` }]),
    ).toBeUndefined();
  });
});

describe("account binding identifiers", () => {
  it.each([
    ["email", "google", "gmail"],
    ["email", "google_workspace", "gmail"],
    ["email", "microsoft", "graph-mail"],
    ["email", "gmail", "gmail"],
    ["microsoft_teams", "microsoft", "graph-teams"],
    ["phone_messages", "apple", "imessage"],
    ["matrix_bot", "matrix", "matrix"],
    ["signal", "matrix_bridge", "matrix"],
    ["whatsapp", "matrix_bridge", "matrix"],
    ["github_notifications", "github", "github"],
    ["slack", "slack", "slack"],
    ["constructor", "other", "other"],
  ])("maps %s / %s to %s", (channel, provider, binding) => {
    expect(accountBinding({ channel, provider })).toBe(binding);
  });
});
