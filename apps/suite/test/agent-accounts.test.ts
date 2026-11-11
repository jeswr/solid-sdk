// AUTHORED-BY Codex GPT-6.1-Sol

import type { Account } from "@jeswr/agent-model";
import { exampleRecords } from "@jeswr/agent-model/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AccountSettingsQueue,
  accountBinding,
  accountDescriptor,
  accountDescriptorConflict,
  accountLoginCommand,
  overlayAccountControls,
  readAccountSettings,
} from "../src/apps/agent/lib/accounts";
import type { AgentClient } from "../src/apps/agent/lib/client";
import { collection } from "../src/apps/agent/lib/collections";
import * as readers from "../src/apps/agent/lib/readers";

const account: Account = {
  ...exampleRecords.account,
  id: "https://alice.demo.pod/agent/accounts/personal.ttl",
  provider: "gmail",
};
const owner = "https://alice.demo.pod/profile/card#me";
const now = Date.parse("2026-11-01T12:00:00Z");
const control = {
  id: "https://alice.demo.pod/agent/control/1.trig",
  kind: "SetBindingState" as const,
  attributedTo: owner,
  target: account.id,
  binding: "gmail",
  bindingState: "connected" as const,
  createdAt: new Date(now - 1000).toISOString(),
  expires: new Date(now + 1000).toISOString(),
  verification: "verified" as const,
  restrictions: { ...account.restrictions, read: true },
};
afterEach(() => vi.restoreAllMocks());

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

describe("agent-host login command", () => {
  it.each([
    ["personal", "awp login personal"],
    ["profile:work-mail", "awp login work-mail"],
    ["demo.profile_1", "awp login demo.profile_1"],
    ["op://vault/item/token", "awp login email-personal"],
    ["https://credentials.example/private", "awp login email-personal"],
    ["profile:bad;rm -rf /", "awp login email-personal"],
    ["owner@example.com", "awp login email-personal"],
    ["", "awp login email-personal"],
    [undefined, "awp login email-personal"],
  ])("derives command for %s without copying a secret reference", (credentialRef, expected) => {
    const { credentialRef: _, ...withoutRef } = account;
    expect(
      accountLoginCommand({
        ...withoutRef,
        ...(credentialRef === undefined ? {} : { credentialRef }),
      }),
    ).toBe(expected);
  });
  it("bounds every fallback to a single safe shell argument", () => {
    expect(
      accountLoginCommand({
        id: "https://alice.demo.pod/a%20%3Brm.trig",
        channel: "bad;channel",
        credentialRef: "$TOKEN",
      }),
    ).toBe("awp login bad-channel-a-20-3Brm");
    expect(accountLoginCommand({ id: "https://alice.demo.pod/plain", channel: "email" })).toBe(
      "awp login email-plain",
    );
  });
});

describe("verified account controls", () => {
  it("overlays only the exact owner's verified, live, matching account and binding", () => {
    const ignored = [
      { ...control, verification: "unchecked" as const },
      { ...control, verification: { invalid: "signature" } },
      { ...control, attributedTo: "https://attacker.example/#me" },
      { ...control, kind: "Halt" as const },
      { ...control, target: `${account.id}-other` },
      { ...control, binding: "matrix" },
      { ...control, createdAt: new Date(now + 1).toISOString() },
      { ...control, expires: new Date(now).toISOString() },
    ];
    expect(overlayAccountControls(account, ignored, owner, now)).toEqual(account);
    expect(
      overlayAccountControls(account, [control, ...ignored], owner, now).restrictions.read,
    ).toBe(true);
    expect(account.restrictions.read).toBe(false);
  });
  it("applies chronological changes and retains restrictions when a disconnect omits them", () => {
    const { restrictions: _, bindingState: __, ...minimal } = control;
    const later = {
      ...minimal,
      id: `${control.id}-new`,
      createdAt: new Date(now - 500).toISOString(),
      bindingState: "disabled" as const,
    };
    const result = overlayAccountControls(account, [later, control], owner, now);
    expect(result.bindingState).toBe("disabled");
    expect(result.restrictions.read).toBe(true);
    expect(overlayAccountControls(account, [minimal], owner, now)).toEqual(account);
    const equalDate = { ...control, id: `${control.id}-z`, bindingState: "disabled" as const };
    expect(overlayAccountControls(account, [equalDate, control], owner, now).bindingState).toBe(
      "disabled",
    );
  });
  it("loads settings without dropping unreadable accounts or control rows", async () => {
    const failedAccount = {
      url: "https://alice.demo.pod/agent/accounts/error.ttl",
      error: new Error("fixture"),
    };
    const failedControl = {
      url: "https://alice.demo.pod/agent/control/error.trig",
      error: new Error("fixture"),
    };
    vi.spyOn(readers, "readAccounts").mockResolvedValue(
      collection([
        { record: account, url: account.id, etag: '"1"', verified: "unchecked" },
        failedAccount,
      ]),
    );
    vi.spyOn(readers, "readControl").mockResolvedValue(
      collection([
        { record: control, url: control.id, etag: '"1"', verified: "verified" },
        failedControl,
      ]),
    );
    const session = { webId: owner, fetch: vi.fn<typeof globalThis.fetch>() };
    const result = await readAccountSettings({} as AgentClient, session, now);
    expect(result[0]).toMatchObject({ record: { restrictions: { read: true } } });
    expect(result.slice(1)).toEqual([failedAccount, failedControl]);
    // The default clock path also accepts an entirely empty inventory.
    vi.mocked(readers.readAccounts).mockResolvedValue(collection([]));
    vi.mocked(readers.readControl).mockResolvedValue(collection([]));
    expect(await readAccountSettings({} as AgentClient, session)).toEqual([]);
  });
});

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("optimistic account settings", () => {
  it("publishes immediately, serializes field changes and retains independent changes after failure", async () => {
    const first = deferred();
    const second = deferred();
    const persist = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const changed = vi.fn();
    const queue = new AccountSettingsQueue(account, persist, changed);
    expect(queue.busy).toBe(false);
    await queue.change({ restrictions: { read: false } });
    expect(persist).not.toHaveBeenCalled();
    const one = queue.change({ restrictions: { read: true } });
    const two = queue.change({ restrictions: { draft: true } });
    expect(queue.value.restrictions).toMatchObject({ read: true, draft: true });
    queue.reconcile({ ...account, bindingState: "error" });
    expect(queue.value.bindingState).toBe("connected");
    await Promise.resolve();
    expect(persist).toHaveBeenCalledTimes(1);
    const rejected = expect(one).rejects.toThrow("save failed");
    first.reject(new Error("save failed"));
    await rejected;
    await Promise.resolve();
    expect(queue.value.restrictions).toMatchObject({ read: false, draft: true });
    expect(persist).toHaveBeenCalledTimes(2);
    expect(persist.mock.calls[1]?.[0]).toEqual({ restrictions: { draft: true } });
    second.resolve();
    await two;
    expect(queue.busy).toBe(false);
    expect(changed).toHaveBeenCalledTimes(4);
    await queue.change({ bindingState: "disabled" });
    expect(queue.value.bindingState).toBe("disabled");
    queue.reconcile(account);
    expect(queue.value).toMatchObject({
      bindingState: "connected",
      restrictions: account.restrictions,
    });
  });
  it("does not resurrect unconfirmed values when successive same-field changes both fail", async () => {
    const first = deferred();
    const second = deferred();
    const queue = new AccountSettingsQueue(
      account,
      vi
        .fn()
        .mockImplementationOnce(() => first.promise)
        .mockImplementationOnce(() => second.promise),
      () => undefined,
    );
    const one = queue.change({ restrictions: { read: true } });
    const two = queue.change({ restrictions: { read: false } });
    const failOne = expect(one).rejects.toThrow();
    first.reject(new Error("one"));
    await failOne;
    const failTwo = expect(two).rejects.toThrow();
    second.reject(new Error("two"));
    await failTwo;
    expect(queue.value.restrictions.read).toBe(false);
    expect(queue.busy).toBe(false);
  });
});
