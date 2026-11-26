// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it, vi } from "vitest";
import { PrivateDestinationError } from "../errors.js";
import { requiresPrivateDestination } from "../pod-writer-policy.js";
import {
  createFakeTwoWayAdapter,
  createMemorySyncPod,
  type MemorySyncPodOptions,
} from "./fake-platform.js";
import { syncItemSlug } from "./hash.js";
import { runTwoWaySync } from "./runner.js";
import type { SyncConnection, SyncPorts } from "./types.js";

const ITEM = await syncItemSlug("account/items", "remote-1");
const SECOND = await syncItemSlug("account/items", "remote-2");

/** A run whose every Pod mutation and destination check is logged in order. */
function fixture(options: MemorySyncPodOptions = {}) {
  const pod = createMemorySyncPod(options);
  const { adapter, platform } = createFakeTwoWayAdapter("account");
  const log: { kind: "verify" | "write" | "remove" | "acl"; url: string; refused?: boolean }[] = [];
  const writer = pod.writer;
  const { write, remove, ensureOwnerOnly } = writer;
  writer.write = (doc, ...rest) => {
    log.push({ kind: "write", url: writer.resolve(doc.slug) });
    return write(doc, ...rest);
  };
  writer.remove = (slug, ...rest) => {
    log.push({ kind: "remove", url: writer.resolve(slug) });
    return remove?.(slug, ...rest) ?? Promise.resolve();
  };
  writer.ensureOwnerOnly = (slug) => {
    log.push({ kind: "acl", url: writer.resolve(slug) });
    return ensureOwnerOnly(slug);
  };
  let refuse: (url: string) => boolean = () => false;
  pod.privacy.verify = (url) => {
    const refused = refuse(url);
    log.push({ kind: "verify", url, refused });
    return !refused;
  };
  const ports: SyncPorts = {
    podWriter: writer,
    sourceAuth: { fetch: vi.fn() },
    scopes: ["fake:write"],
  };
  return {
    pod,
    adapter,
    platform,
    log,
    refuseWhen(predicate: (url: string) => boolean) {
      refuse = predicate;
    },
    run: (settings: Partial<SyncConnection> = {}) =>
      runTwoWaySync(adapter, { account: "account", ...settings }, ports),
    /** Mutations logged after the first refused destination check. */
    afterRefusal() {
      const index = log.findIndex((entry) => entry.refused);
      expect(index).toBeGreaterThanOrEqual(0);
      return log.slice(index + 1).filter((entry) => entry.kind !== "verify");
    },
  };
}
const urls = (f: ReturnType<typeof fixture>) => [...f.pod.documents.keys()];

describe("two-way sync private-destination contract", () => {
  it("treats the reference adapter as a private import (no test allowlist)", () => {
    expect(requiresPrivateDestination(createFakeTwoWayAdapter().adapter.metadata.id)).toBe(true);
  });

  it("runs every direct mutation through the owner-only checks", async () => {
    const f = fixture();
    f.platform.set("initial");
    await f.run();
    const mutations = f.log.filter((entry) => entry.kind !== "verify");
    expect(mutations.length).toBeGreaterThan(0);
    // Each mutation (data, link shard, manifest, ACL install) follows a check of its resource.
    for (const [index, entry] of f.log.entries()) {
      if (entry.kind === "verify") continue;
      const checked = f.log
        .slice(0, index)
        .some((prior) => prior.kind === "verify" && prior.url === entry.url);
      if (entry.kind !== "remove") expect(checked, entry.url).toBe(true);
    }
    // Every resource written was confirmed afterwards.
    for (const url of new Set(mutations.filter((m) => m.kind === "write").map((m) => m.url)))
      expect(f.pod.confirmed).toContain(url);
    expect(f.pod.documents.has(f.pod.writer.resolve(ITEM))).toBe(true);
  });

  it("refuses before any Pod mutation when the host supplies no verifier", async () => {
    const f = fixture({ withoutPrivacyChecks: true });
    f.platform.set("initial");
    const failure = await f.run().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(PrivateDestinationError);
    expect((failure as PrivateDestinationError).phase).toBe("before-write");
    expect(f.log.filter((entry) => entry.kind !== "verify")).toEqual([]);
    expect(f.pod.documents.size).toBe(0);
    expect(f.pod.protectedUrls.size).toBe(0);
  });

  it("stops the run on a refusing verifier with no item data written", async () => {
    const f = fixture();
    f.platform.set("initial");
    f.refuseWhen((url) => url.includes("/account/items/"));
    const failure = await f.run().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(PrivateDestinationError);
    expect((failure as PrivateDestinationError).phase).toBe("before-write");
    expect(urls(f).some((url) => url.includes("/account/items/"))).toBe(false);
    expect(f.afterRefusal()).toEqual([]);
    // No run provenance or outbound record after the refusal.
    expect(urls(f).some((url) => /_provenance\.ttl$|outbound-/.test(url))).toBe(false);
  });

  it("cleans up a created item refused after the write and surfaces that refusal", async () => {
    const f = fixture();
    f.platform.set("initial");
    const item = f.pod.writer.resolve(ITEM);
    f.pod.privacy.confirm = (url) => url !== item;
    const onState = vi.fn();
    const failure = await runTwoWaySync(
      f.adapter,
      { account: "account" },
      {
        podWriter: f.pod.writer,
        sourceAuth: { fetch: vi.fn() },
        scopes: ["fake:write"],
        onState,
      },
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(PrivateDestinationError);
    expect((failure as PrivateDestinationError).phase).toBe("after-write");
    expect((failure as PrivateDestinationError).removed).toBe(true);
    expect(f.pod.documents.has(item)).toBe(false);
    // The confirmation refusal is the last mutation: nothing (links, provenance) follows it.
    const index = f.log.findLastIndex((entry) => entry.kind === "write" && entry.url === item);
    expect(f.log.slice(index + 1).filter((entry) => entry.kind !== "verify")).toEqual([]);
    expect(urls(f).some((url) => /_provenance\.ttl$|outbound-/.test(url))).toBe(false);
    // As runImport: an after-write refusal is thrown without reporting a failed state.
    expect(onState).not.toHaveBeenCalled();
  });

  it("blocks later link shard, snapshot and provenance writes after a mid-run refusal", async () => {
    const f = fixture();
    f.platform.set("first", "remote-1");
    f.platform.set("second", "remote-2");
    const second = f.pod.writer.resolve(SECOND);
    f.refuseWhen((url) => url === second);
    await expect(f.run()).rejects.toBeInstanceOf(PrivateDestinationError);
    // The first item and its link were written before the refusal.
    expect(f.pod.documents.has(f.pod.writer.resolve(ITEM))).toBe(true);
    expect(f.pod.documents.has(second)).toBe(false);
    expect(f.afterRefusal()).toEqual([]);
    expect(urls(f).some((url) => /_provenance\.ttl$|outbound-/.test(url))).toBe(false);
  });

  it("blocks the outbound record after a refusal once write-back started", async () => {
    const f = fixture();
    f.platform.set("initial");
    await f.run({ writeBack: true });
    await f.pod.put(ITEM, "local edit");
    // The outbound update reaches the provider, then the link-shard write is refused.
    f.platform.afterApply = () => f.refuseWhen((url) => url.includes("/account/links/"));
    await expect(f.run({ writeBack: true })).rejects.toBeInstanceOf(PrivateDestinationError);
    expect(f.platform.calls.update).toBe(1);
    expect(f.afterRefusal()).toEqual([]);
    expect(urls(f).some((url) => /outbound-/.test(url))).toBe(false);
  });

  it("blocks trash snapshots and deletes after a refusal", async () => {
    const f = fixture();
    f.platform.set("initial");
    await f.run();
    f.platform.remove();
    f.refuseWhen((url) => url.includes("/account/trash/"));
    await expect(f.run()).rejects.toBeInstanceOf(PrivateDestinationError);
    expect(f.afterRefusal()).toEqual([]);
    // The item was neither moved to trash nor deleted.
    expect(f.pod.documents.has(f.pod.writer.resolve(ITEM))).toBe(true);
    expect(urls(f).some((url) => url.includes("/account/trash/"))).toBe(false);
  });

  it("refuses every later run once the pod stops being owner-only", async () => {
    const f = fixture();
    f.platform.set("initial");
    await f.run();
    const before = f.log.length;
    f.pod.privacy.owner = false;
    await expect(f.run()).rejects.toBeInstanceOf(PrivateDestinationError);
    expect(f.log.slice(before).filter((entry) => entry.kind !== "verify")).toEqual([]);
  });
});
