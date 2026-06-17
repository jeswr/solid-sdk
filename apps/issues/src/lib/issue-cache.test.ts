import { describe, it, expect, beforeEach } from "vitest";
import {
  clearAllIssueCaches,
  clearIssueCache,
  readIssueCache,
  writeIssueCache,
  type SyncStorage,
} from "./issue-cache";
import type { IssueRecord } from "./repository";

/** An in-memory SyncStorage (localStorage stand-in) for the cache tests. */
class MemStorage implements SyncStorage {
  private map = new Map<string, string>();
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  get length() {
    return this.map.size;
  }
}

const base: IssueRecord = {
  url: "",
  title: "",
  state: "open",
  status: "todo",
  issueType: "task",
  labels: [],
  components: [],
  blockedBy: [],
  relatesTo: [],
  attachments: [],
  comments: [],
  worklog: [],
  loggedSeconds: 0,
  canWrite: true,
  fields: {},
};
const mk = (p: Partial<IssueRecord>): IssueRecord => ({ ...base, ...p });

const TRACKER = "https://alice.example/issue-tracker/tracker.ttl";
const OTHER = "https://bob.example/issue-tracker/tracker.ttl";
const ALICE = "https://alice.example/profile/card#me";
const BOB = "https://bob.example/profile/card#me";

let storage: MemStorage;
beforeEach(() => {
  storage = new MemStorage();
});

describe("issue-cache — hydrate/merge for instant offline load (pss-tvds)", () => {
  it("round-trips issues for a (WebID, tracker)", () => {
    const issues = [mk({ url: "a", title: "One" }), mk({ url: "b", title: "Two", state: "closed", status: "done" })];
    writeIssueCache(ALICE, TRACKER, issues, storage);
    const read = readIssueCache(ALICE, TRACKER, storage);
    expect(read?.map((i) => i.url)).toEqual(["a", "b"]);
    expect(read?.[1].state).toBe("closed");
  });

  it("revives Date fields written via JSON", () => {
    const created = new Date("2026-06-10T08:00:00.000Z");
    writeIssueCache(ALICE, TRACKER, [mk({ url: "a", created, dateDue: new Date("2026-07-01T00:00:00.000Z") })], storage);
    const read = readIssueCache(ALICE, TRACKER, storage);
    expect(read?.[0].created).toBeInstanceOf(Date);
    expect(read?.[0].created?.getTime()).toBe(created.getTime());
    expect(read?.[0].dateDue).toBeInstanceOf(Date);
  });

  it("is scoped per tracker — one tracker's cache never paints under another", () => {
    writeIssueCache(ALICE, TRACKER, [mk({ url: "a" })], storage);
    expect(readIssueCache(ALICE, OTHER, storage)).toBeNull();
  });

  it("returns null when there is no cache", () => {
    expect(readIssueCache(ALICE, TRACKER, storage)).toBeNull();
  });

  it("ignores a stale cache older than the max age", () => {
    const t0 = 1_000_000_000_000;
    writeIssueCache(ALICE, TRACKER, [mk({ url: "a" })], storage, t0);
    // within the week → present
    expect(readIssueCache(ALICE, TRACKER, storage, t0 + 60_000)?.length).toBe(1);
    // older than the week → ignored
    expect(readIssueCache(ALICE, TRACKER, storage, t0 + 8 * 24 * 60 * 60 * 1000)).toBeNull();
  });

  it("degrades to null on a corrupt entry (never throws)", () => {
    storage.setItem(`solid-issues:cache:${ALICE}\u0000${TRACKER}`, "{not json");
    expect(readIssueCache(ALICE, TRACKER, storage)).toBeNull();
  });

  it("clearIssueCache removes one (WebID, tracker); clearAllIssueCaches removes every entry", () => {
    writeIssueCache(ALICE, TRACKER, [mk({ url: "a" })], storage);
    writeIssueCache(ALICE, OTHER, [mk({ url: "b" })], storage);
    clearIssueCache(ALICE, TRACKER, storage);
    expect(readIssueCache(ALICE, TRACKER, storage)).toBeNull();
    expect(readIssueCache(ALICE, OTHER, storage)?.length).toBe(1);

    writeIssueCache(ALICE, TRACKER, [mk({ url: "a" })], storage);
    clearAllIssueCaches(storage);
    expect(readIssueCache(ALICE, TRACKER, storage)).toBeNull();
    expect(readIssueCache(ALICE, OTHER, storage)).toBeNull();
    // and only our keys are touched — an unrelated key survives
    storage.setItem("unrelated", "x");
    clearAllIssueCaches(storage);
    expect(storage.getItem("unrelated")).toBe("x");
  });

  it("a null storage (SSR / private mode) is a safe no-op", () => {
    expect(() => writeIssueCache(ALICE, TRACKER, [mk({ url: "a" })], null)).not.toThrow();
    expect(readIssueCache(ALICE, TRACKER, null)).toBeNull();
    expect(() => clearAllIssueCaches(null)).not.toThrow();
  });
});

describe("issue-cache — WebID scoping (cross-user leak guard)", () => {
  it("hydrates ONLY for the WebID that wrote the snapshot", () => {
    writeIssueCache(ALICE, TRACKER, [mk({ url: "secret", title: "Alice private" })], storage);
    // Same tracker, but a DIFFERENT signed-in user must not see Alice's data.
    expect(readIssueCache(BOB, TRACKER, storage)).toBeNull();
    // Alice still sees her own snapshot.
    expect(readIssueCache(ALICE, TRACKER, storage)?.[0].url).toBe("secret");
  });

  it("treats a missing/anonymous WebID as a cache MISS (no hydrate)", () => {
    writeIssueCache(ALICE, TRACKER, [mk({ url: "a" })], storage);
    expect(readIssueCache(null, TRACKER, storage)).toBeNull();
    expect(readIssueCache(undefined, TRACKER, storage)).toBeNull();
    // and a write without a WebID stores nothing (would be unreadable anyway).
    writeIssueCache(null, OTHER, [mk({ url: "b" })], storage);
    expect(readIssueCache(ALICE, OTHER, storage)).toBeNull();
  });

  it("does NOT hydrate a tampered envelope whose stored webId differs from the key", () => {
    // Forge an entry under Bob's KEY but stamped with Alice's webId in the body —
    // the in-envelope webId check (not just the key) must still reject it for Bob.
    const env = { v: 2, at: Date.now(), webId: ALICE, tracker: TRACKER, issues: [mk({ url: "x" })] };
    storage.setItem(`solid-issues:cache:${BOB}\u0000${TRACKER}`, JSON.stringify(env));
    expect(readIssueCache(BOB, TRACKER, storage)).toBeNull();
  });

  it("two users on one browser keep independent snapshots; clearAll wipes both", () => {
    writeIssueCache(ALICE, TRACKER, [mk({ url: "a-issue" })], storage);
    writeIssueCache(BOB, TRACKER, [mk({ url: "b-issue" })], storage);
    expect(readIssueCache(ALICE, TRACKER, storage)?.[0].url).toBe("a-issue");
    expect(readIssueCache(BOB, TRACKER, storage)?.[0].url).toBe("b-issue");
    // Account switch / logout clears every user's snapshot.
    clearAllIssueCaches(storage);
    expect(readIssueCache(ALICE, TRACKER, storage)).toBeNull();
    expect(readIssueCache(BOB, TRACKER, storage)).toBeNull();
  });

  it("ignores a legacy v1 (un-WebID-scoped) entry — it cannot leak", () => {
    // A pre-upgrade entry has no webId and v:1; the v:2 reader must reject it.
    const legacy = { v: 1, at: Date.now(), tracker: TRACKER, issues: [mk({ url: "old" })] };
    storage.setItem(`solid-issues:cache:${ALICE}\u0000${TRACKER}`, JSON.stringify(legacy));
    expect(readIssueCache(ALICE, TRACKER, storage)).toBeNull();
  });
});
