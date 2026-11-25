// AUTHORED-BY Claude Sonnet 5.5
import { describe, expect, it } from "vitest";
import {
  allowDrafts,
  audioIndices,
  clearDraft,
  DRAFT_TTL_MS,
  isReceipt,
  legacyDraftKey,
  loadDraft,
  lostRecordings,
  ownerOf,
  purgeDrafts,
  RENEW_MARGIN_MS,
  receiptUsable,
  revokeDrafts,
  saveDraft,
  withoutRecordings,
} from "../src/feedback/draft";

const submissionId = "11111111-1111-4111-8111-111111111111";
const now = 1_800_000_000_000;
const receipt = (expiry = now + 2 * 3_600_000, over = {}) => ({
  submissionId,
  sha: "a".repeat(40),
  size: 10,
  ext: "webm" as const,
  sig: `${expiry}.${"b".repeat(64)}`,
  ...over,
});
function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    data,
  };
}
const draft = (receipts: unknown[] = []) => ({
  submissionId,
  record: JSON.stringify({ transcript: [] }),
  uncertain: false,
  receipts: receipts as never,
});

describe("draft ownership", () => {
  it("keys drafts by account with a separate signed-out bucket", () => {
    expect(ownerOf("alice")).toBe("account:alice");
    expect(ownerOf(undefined)).toBe("signed-out");
    expect(ownerOf(null)).toBe("signed-out");
    expect(ownerOf("")).toBe("signed-out");
  });
  it("never restores one account's draft under another or the signed-out bucket", () => {
    const storage = memory();
    saveDraft(storage, ownerOf("alice"), draft(), now);
    expect(loadDraft(storage, ownerOf("alice"), now)?.submissionId).toBe(submissionId);
    expect(loadDraft(storage, ownerOf("bob"), now)).toBeUndefined();
    expect(loadDraft(storage, ownerOf(undefined), now)).toBeUndefined();
    // Another owner's draft is left alone, not deleted by a look-up.
    expect(storage.data.size).toBe(1);
  });
  it("rejects a draft copied under another owner's key", () => {
    const storage = memory();
    saveDraft(storage, ownerOf("alice"), draft(), now);
    const [key = "", value = ""] = [...storage.data][0] ?? [];
    storage.data.set(key.replace("alice", "bob"), value);
    expect(loadDraft(storage, ownerOf("bob"), now)).toBeUndefined();
    expect(storage.data.has(key.replace("alice", "bob"))).toBe(false);
  });
  it("clears one owner's draft only", () => {
    const storage = memory();
    saveDraft(storage, ownerOf("alice"), draft(), now);
    saveDraft(storage, ownerOf("bob"), draft(), now);
    clearDraft(storage, ownerOf("alice"));
    expect(loadDraft(storage, ownerOf("alice"), now)).toBeUndefined();
    expect(loadDraft(storage, ownerOf("bob"), now)).toBeDefined();
  });
});

describe("uncertainty and revocation", () => {
  it("remembers whether the saved attempt may have reached storage", () => {
    const storage = memory();
    saveDraft(storage, "signed-out", { ...draft(), uncertain: true }, now);
    expect(loadDraft(storage, "signed-out", now)?.uncertain).toBe(true);
    saveDraft(storage, "signed-out", { ...draft(), uncertain: false }, now);
    expect(loadDraft(storage, "signed-out", now)?.uncertain).toBe(false);
  });
  it("treats a draft saved without the flag as possibly stored", () => {
    const storage = memory({
      "suite.feedback.draft.v2:signed-out": JSON.stringify({
        version: 2,
        owner: "signed-out",
        savedAt: now,
        record: "{}",
        submissionId,
        receipts: [],
      }),
    });
    expect(loadDraft(storage, "signed-out", now)?.uncertain).toBe(true);
  });
  it("removes a revoked owner's draft and refuses later saves until allowed again", () => {
    const storage = memory();
    saveDraft(storage, ownerOf("alice"), draft(), now);
    revokeDrafts(storage, ownerOf("alice"));
    expect(storage.data.size).toBe(0);
    saveDraft(storage, ownerOf("alice"), draft(), now);
    expect(storage.data.size).toBe(0);
    saveDraft(storage, ownerOf("bob"), draft(), now);
    expect(storage.data.size).toBe(1);
    allowDrafts(ownerOf("alice"));
    saveDraft(storage, ownerOf("alice"), draft(), now);
    expect(storage.data.size).toBe(2);
  });
  it("revokes without storage", () => {
    expect(() => revokeDrafts(undefined, "account:x")).not.toThrow();
    allowDrafts("account:x");
  });
});

describe("draft expiry and validity", () => {
  it("expires after the lifetime and removes the draft", () => {
    const storage = memory();
    saveDraft(storage, "signed-out", draft(), now);
    expect(loadDraft(storage, "signed-out", now + DRAFT_TTL_MS - 1)).toBeDefined();
    expect(loadDraft(storage, "signed-out", now + DRAFT_TTL_MS)).toBeUndefined();
    expect(storage.data.size).toBe(0);
  });
  it("rejects a draft saved in the future", () => {
    const storage = memory();
    saveDraft(storage, "signed-out", draft(), now + 3_600_000);
    expect(loadDraft(storage, "signed-out", now)).toBeUndefined();
  });
  it.each([
    ["not json", "{"],
    ["a wrong version", JSON.stringify({ version: 1, owner: "signed-out" })],
    [
      "no save time",
      JSON.stringify({ version: 2, owner: "signed-out", record: "{}", submissionId, receipts: [] }),
    ],
    [
      "a bad id",
      JSON.stringify({
        version: 2,
        owner: "signed-out",
        savedAt: now,
        record: "{}",
        submissionId: "x",
        receipts: [],
      }),
    ],
    [
      "a non-string record",
      JSON.stringify({
        version: 2,
        owner: "signed-out",
        savedAt: now,
        record: {},
        submissionId,
        receipts: [],
      }),
    ],
    [
      "too many receipts",
      JSON.stringify({
        version: 2,
        owner: "signed-out",
        savedAt: now,
        record: "{}",
        submissionId,
        receipts: Array(11).fill(null),
      }),
    ],
    [
      "receipts that are not a list",
      JSON.stringify({
        version: 2,
        owner: "signed-out",
        savedAt: now,
        record: "{}",
        submissionId,
        receipts: {},
      }),
    ],
  ])("discards a draft with %s", (_name, raw) => {
    const storage = memory({ "suite.feedback.draft.v2:signed-out": raw });
    expect(loadDraft(storage, "signed-out", now)).toBeUndefined();
    expect(storage.data.size).toBe(0);
  });
  it("returns nothing when storage is missing or throws", () => {
    expect(loadDraft(undefined, "signed-out", now)).toBeUndefined();
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadDraft(broken, "signed-out", now)).toBeUndefined();
    expect(() => saveDraft(broken, "signed-out", draft(), now)).not.toThrow();
    expect(() => clearDraft(broken, "signed-out")).not.toThrow();
    expect(() => saveDraft(undefined, "signed-out", draft(), now)).not.toThrow();
    expect(() => clearDraft(undefined, "signed-out")).not.toThrow();
  });
  it("purges the legacy unowned draft, expired drafts and unreadable drafts, keeping fresh ones", () => {
    const storage = memory({ [legacyDraftKey]: "{}", unrelated: "keep" });
    saveDraft(storage, ownerOf("old"), draft(), now - DRAFT_TTL_MS - 1);
    saveDraft(storage, ownerOf("fresh"), draft(), now);
    storage.data.set("suite.feedback.draft.v2:garbage", "{");
    storage.data.set(
      "suite.feedback.draft.v2:mismatch",
      JSON.stringify({ owner: "other", savedAt: now }),
    );
    storage.data.set("suite.feedback.draft.v2:nodate", JSON.stringify({ owner: "nodate" }));
    purgeDrafts(storage, now);
    expect([...storage.data.keys()].sort()).toEqual([
      "suite.feedback.draft.v2:account:fresh",
      "unrelated",
    ]);
  });
  it("purges nothing without storage and survives a throwing one", () => {
    expect(() => purgeDrafts(undefined, now)).not.toThrow();
    const broken = {
      length: 1,
      key: () => {
        throw new Error("blocked");
      },
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    };
    expect(() => purgeDrafts(broken, now)).not.toThrow();
  });
});

describe("receipts", () => {
  it("validates restored receipt shape and drops corrupt entries to null without shifting indices", () => {
    const storage = memory();
    const good = receipt();
    saveDraft(
      storage,
      "signed-out",
      draft([
        { ...good, extra: 1 },
        good,
        null,
        { ...good, sha: "nope" },
        { ...good, submissionId: "22222222-2222-4222-8222-222222222222" },
        "string",
        [],
        { ...good, ext: "mp3" },
        { ...good, size: 0 },
        { ...good, sig: "bad" },
      ]),
      now,
    );
    const restored = loadDraft(storage, "signed-out", now);
    expect(restored?.receipts).toEqual([
      null,
      good,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
  });
  it("accepts only a complete, well-formed receipt for this submission", () => {
    expect(isReceipt(receipt(), submissionId)).toBe(true);
    expect(isReceipt(receipt(), "22222222-2222-4222-8222-222222222222")).toBe(false);
    expect(isReceipt({ ...receipt(), size: 3 * 1024 * 1024 + 1 }, submissionId)).toBe(false);
    expect(isReceipt(undefined, submissionId)).toBe(false);
  });
  it("treats a receipt as usable only until ten minutes before expiry", () => {
    expect(receiptUsable(receipt(now + RENEW_MARGIN_MS + 1), now)).toBe(true);
    expect(receiptUsable(receipt(now + RENEW_MARGIN_MS), now)).toBe(false);
    expect(receiptUsable(null, now)).toBe(false);
    expect(receiptUsable(undefined, now)).toBe(false);
  });
});

describe("lost recordings", () => {
  const record = { transcript: [{ audio: [0] }, {}, { audio: [2, 0] }] };
  it("lists referenced indices in order, once", () => {
    expect(audioIndices(record)).toEqual([0, 2]);
    expect(audioIndices({ transcript: [] })).toEqual([]);
  });
  it("finds every slot up to the highest reference that cannot be sent, without compacting", () => {
    const fine = receipt(now + 3_600_000);
    const expired = receipt(now - 1);
    // Slot 1 is unreferenced but missing: the server numbers by position, so it still counts.
    expect(lostRecordings(record, [fine, null, fine], () => false, now)).toEqual([1]);
    expect(lostRecordings(record, [expired, fine, fine], () => false, now)).toEqual([0]);
    expect(lostRecordings(record, [], () => false, now)).toEqual([0, 1, 2]);
  });
  it("does not count slots whose audio is still in memory or that nothing references", () => {
    expect(lostRecordings(record, [], () => true, now)).toEqual([]);
    expect(lostRecordings({ transcript: [{}] }, [], () => false, now)).toEqual([]);
  });
  it("removes every recording reference and keeps the rest of the record", () => {
    const stripped = withoutRecordings({
      pathway: "quick",
      transcript: [
        { role: "user", content: "x", audio: [0] },
        { role: "assistant", content: "y" },
      ],
    });
    expect(stripped).toEqual({
      pathway: "quick",
      transcript: [
        { role: "user", content: "x" },
        { role: "assistant", content: "y" },
      ],
    });
  });
});
