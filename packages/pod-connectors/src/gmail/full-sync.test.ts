// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it } from "vitest";
import { createFetchPodWriter } from "../core/pod-writer.js";
import { createMemoryPod, TEST_POD_ROOT, TEST_PROFILE_DOC, TEST_WEBID } from "../core/testing.js";
import type { ImportContext } from "../core/types.js";
import { FullSyncJournal, JOURNAL_PERSIST_LIMITS } from "./full-sync.js";

const ACCOUNT = "mail/alex~40example.test/";
const URL_ = `${TEST_POD_ROOT}integrations/gmail/${ACCOUNT}_full-sync.ttl`;

function context() {
  const pod = createMemoryPod();
  const writer = createFetchPodWriter({
    adapterId: "gmail",
    webId: TEST_WEBID,
    profileDocumentUrl: TEST_PROFILE_DOC,
    podRoot: TEST_POD_ROOT,
    fetch: pod.fetch,
  });
  const etags = new Map<string, string | undefined>();
  const ctx = {
    resolve: writer.resolve,
    read: async (slug: string) => {
      const found = await writer.read(slug);
      etags.set(slug, found?.etag);
      return found?.dataset;
    },
    write: (doc: Parameters<ImportContext["write"]>[0]) => {
      const etag = etags.get(doc.slug);
      etags.delete(doc.slug);
      return writer.write(doc, etag ? { ifMatch: etag } : undefined);
    },
    remove: (slug: string) => writer.remove?.(slug) ?? Promise.resolve(),
  } as unknown as ImportContext;
  return { pod, ctx };
}
const member = (i: number) => `${ACCOUNT}messages/gmail-${String(i).padStart(6, "0")}.ttl`;

describe("Gmail full-sync journal persistence bounds", () => {
  it("over-estimates the serialised size and quad count of what it writes", async () => {
    const { pod, ctx } = context();
    const journal = await FullSyncJournal.load(ctx, ACCOUNT, "1000");
    journal.pageToken = "next-page";
    for (let i = 0; i < 3000; i++) {
      journal.remember(member(i));
      if (i % 2 === 0) journal.complete(member(i));
    }
    await journal.save();
    const written = new TextEncoder().encode(pod.get(URL_) ?? "").byteLength;
    expect(written).toBeGreaterThan(0);
    expect(written).toBeLessThanOrEqual(journal.persistedSize);
    expect(pod.dataset(URL_).size).toBeLessThanOrEqual(3 + 3000 + 1500);
    // Reloading accounts for the absolute IRIs again.
    const reloaded = await FullSyncJournal.load(ctx, ACCOUNT, "2000");
    expect(reloaded.historyId).toBe("1000");
    expect(reloaded.completed.size).toBe(1500);
    expect(reloaded.persistedSize).toBe(journal.persistedSize);
  });

  it("stops writing at the byte bound and keeps the last readable checkpoint", async () => {
    const { pod, ctx } = context();
    const probe = await FullSyncJournal.load(ctx, ACCOUNT, "1000");
    const empty = probe.persistedSize;
    probe.remember(member(0));
    const perMember = probe.persistedSize - empty;
    // Room for exactly ten members.
    const limits = { maxBytes: empty + 10 * perMember, maxQuads: 1_000_000 };
    const journal = await FullSyncJournal.load(ctx, ACCOUNT, "1000", limits);
    for (let i = 0; i < 9; i++) journal.remember(member(i));
    await journal.save();
    const checkpoint = pod.get(URL_);
    journal.remember(member(9));
    expect(journal.persistable).toBe(true);
    expect(journal.persistedSize).toBe(limits.maxBytes);
    await journal.save();
    const atBound = pod.get(URL_);
    expect(atBound).not.toBe(checkpoint);
    journal.remember(member(10));
    expect(journal.persistable).toBe(false);
    await journal.save();
    expect(pod.get(URL_)).toBe(atBound);
    expect((await FullSyncJournal.load(ctx, ACCOUNT, "x")).seen.size).toBe(10);
  });

  it("stops writing at the quad bound", async () => {
    const { pod, ctx } = context();
    const journal = await FullSyncJournal.load(ctx, ACCOUNT, "1000", {
      maxBytes: JOURNAL_PERSIST_LIMITS.maxBytes,
      maxQuads: 3 + 4,
    });
    journal.remember(member(0));
    journal.complete(member(0));
    journal.remember(member(1));
    journal.complete(member(1));
    expect(journal.persistable).toBe(true);
    await journal.save();
    journal.remember(member(2));
    expect(journal.persistable).toBe(false);
    const before = pod.get(URL_);
    await journal.save();
    expect(pod.get(URL_)).toBe(before);
  });

  it("only deletes a journal that exists", async () => {
    const { pod, ctx } = context();
    const journal = await FullSyncJournal.load(ctx, ACCOUNT, "1000");
    await journal.clear();
    journal.remember(member(0));
    await journal.save();
    expect(pod.get(URL_)).toBeDefined();
    await journal.clear();
    expect(pod.get(URL_)).toBeUndefined();
  });

  it("keeps the reader-compatible defaults below the Pod reader's 16 MiB / 1,000,000-quad caps", () => {
    expect(JOURNAL_PERSIST_LIMITS.maxBytes).toBeLessThan(16 * 1024 * 1024);
    expect(JOURNAL_PERSIST_LIMITS.maxQuads).toBeLessThan(1_000_000);
  });
});
