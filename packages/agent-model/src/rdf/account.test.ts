// AUTHORED-BY Codex GPT-6
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type Account, type AccountInventory, podRecordSchema } from "../records.js";
import { exampleRecords } from "../testing.js";
import { fromRdf, recordFromTurtle, recordToTurtle, toRdf } from "./records.js";

const inventory: AccountInventory = {
  setupStatus: "planned",
  observedAt: "2026-10-20",
  lastTested: "2026-10-19T01:02:03Z",
  channelHandles: ["salted-test-hash-account", "salted-test-hash-alias"],
  credentialRefs: ["profile:fixture", "op://test-vault/account-01/credential"],
  evidence: [
    {
      channel: "email",
      provider: "google",
      handleHash: "salted-test-hash-account",
      observedOn: "2026-10-19",
      method: "historic_connector",
    },
  ],
  identityConflicts: [
    {
      kind: "identity-mismatch",
      handleHashes: ["salted-test-hash-account", "salted-test-hash-other"],
    },
  ],
};
describe("account inventory mapping", () => {
  it("round-trips setup observations, multiple handles/references and hash-only evidence", async () => {
    const account: Account = {
      ...exampleRecords.account,
      credentialRef: inventory.credentialRefs[0],
      inventory,
    };
    expect(fromRdf(toRdf(account), account.id)).toEqual(account);
    expect(await recordFromTurtle(await recordToTurtle(account), account.id)).toEqual(account);
  });
  it("supports a not-yet-configured account without inventing a primary handle", async () => {
    const { channelHandleHash: _, credentialRef: __, ...base } = exampleRecords.account;
    const account: Account = {
      ...base,
      inventory: {
        ...inventory,
        channelHandles: [],
        credentialRefs: [],
        evidence: [],
        identityConflicts: [],
      },
    };
    expect(fromRdf(toRdf(account), account.id)).toEqual(account);
    expect(await recordFromTurtle(await recordToTurtle(account), account.id)).toEqual(account);
    expect(() => podRecordSchema.parse(base)).toThrow();
    expect(() => podRecordSchema.parse({ ...base, inventory })).toThrow();
  });
  it("keeps arbitrary bounded inventory lists intact, including empty lists and duplicates", async () => {
    const strings = fc.array(fc.string({ minLength: 1, maxLength: 60 }), { maxLength: 20 });
    await fc.assert(
      fc.asyncProperty(strings, strings, async (channelHandles, credentialRefs) => {
        const { channelHandleHash: _, credentialRef: __, ...base } = exampleRecords.account;
        const account: Account = {
          ...base,
          ...(channelHandles[0] ? { channelHandleHash: channelHandles[0] } : {}),
          ...(credentialRefs[0] ? { credentialRef: credentialRefs[0] } : {}),
          inventory: { ...inventory, channelHandles, credentialRefs },
        };
        expect(fromRdf(toRdf(account), account.id)).toEqual(account);
        expect(await recordFromTurtle(await recordToTurtle(account), account.id)).toEqual(account);
      }),
      { numRuns: 100, seed: 7007 },
    );
  });
  it.each([
    { channelHandles: [""] },
    { credentialRefs: Array(21).fill("profile:fixture") },
    { setupStatus: "" },
    { identityConflicts: [{ kind: "resolved", handleHashes: [] }] },
    {
      identityConflicts: [{ kind: "identity-mismatch", handleHashes: [], notes: "private prose" }],
    },
    { evidence: [{ ...inventory.evidence[0], handleHash: 12 }] },
    { read: true },
  ])("refuses malformed or owner-controlled data inside inventory", (change) => {
    expect(() =>
      podRecordSchema.parse({ ...exampleRecords.account, inventory: { ...inventory, ...change } }),
    ).toThrow();
  });
});
