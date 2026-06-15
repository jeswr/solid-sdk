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

let storage: MemStorage;
beforeEach(() => {
  storage = new MemStorage();
});

describe("issue-cache — hydrate/merge for instant offline load (pss-tvds)", () => {
  it("round-trips issues for a tracker", () => {
    const issues = [mk({ url: "a", title: "One" }), mk({ url: "b", title: "Two", state: "closed", status: "done" })];
    writeIssueCache(TRACKER, issues, storage);
    const read = readIssueCache(TRACKER, storage);
    expect(read?.map((i) => i.url)).toEqual(["a", "b"]);
    expect(read?.[1].state).toBe("closed");
  });

  it("revives Date fields written via JSON", () => {
    const created = new Date("2026-06-10T08:00:00.000Z");
    writeIssueCache(TRACKER, [mk({ url: "a", created, dateDue: new Date("2026-07-01T00:00:00.000Z") })], storage);
    const read = readIssueCache(TRACKER, storage);
    expect(read?.[0].created).toBeInstanceOf(Date);
    expect(read?.[0].created?.getTime()).toBe(created.getTime());
    expect(read?.[0].dateDue).toBeInstanceOf(Date);
  });

  it("is scoped per tracker — one tracker's cache never paints under another", () => {
    writeIssueCache(TRACKER, [mk({ url: "a" })], storage);
    expect(readIssueCache(OTHER, storage)).toBeNull();
  });

  it("returns null when there is no cache", () => {
    expect(readIssueCache(TRACKER, storage)).toBeNull();
  });

  it("ignores a stale cache older than the max age", () => {
    const t0 = 1_000_000_000_000;
    writeIssueCache(TRACKER, [mk({ url: "a" })], storage, t0);
    // within the week → present
    expect(readIssueCache(TRACKER, storage, t0 + 60_000)?.length).toBe(1);
    // older than the week → ignored
    expect(readIssueCache(TRACKER, storage, t0 + 8 * 24 * 60 * 60 * 1000)).toBeNull();
  });

  it("degrades to null on a corrupt entry (never throws)", () => {
    storage.setItem("solid-issues:cache:" + TRACKER, "{not json");
    expect(readIssueCache(TRACKER, storage)).toBeNull();
  });

  it("clearIssueCache removes one tracker; clearAllIssueCaches removes every entry", () => {
    writeIssueCache(TRACKER, [mk({ url: "a" })], storage);
    writeIssueCache(OTHER, [mk({ url: "b" })], storage);
    clearIssueCache(TRACKER, storage);
    expect(readIssueCache(TRACKER, storage)).toBeNull();
    expect(readIssueCache(OTHER, storage)?.length).toBe(1);

    writeIssueCache(TRACKER, [mk({ url: "a" })], storage);
    clearAllIssueCaches(storage);
    expect(readIssueCache(TRACKER, storage)).toBeNull();
    expect(readIssueCache(OTHER, storage)).toBeNull();
    // and only our keys are touched — an unrelated key survives
    storage.setItem("unrelated", "x");
    clearAllIssueCaches(storage);
    expect(storage.getItem("unrelated")).toBe("x");
  });

  it("a null storage (SSR / private mode) is a safe no-op", () => {
    expect(() => writeIssueCache(TRACKER, [mk({ url: "a" })], null)).not.toThrow();
    expect(readIssueCache(TRACKER, null)).toBeNull();
    expect(() => clearAllIssueCaches(null)).not.toThrow();
  });
});
