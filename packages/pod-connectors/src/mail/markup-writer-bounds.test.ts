// AUTHORED-BY Claude Opus 5.5

import type { DatasetCore } from "@rdfjs/types";
import { Container, Resource } from "@solid/object";
import { DataFactory, Store } from "n3";
import { describe, expect, it, vi } from "vitest";
import { jsonLdFixture } from "../../test-support/markup-fixtures.js";
import type { NormalisedDoc } from "../core/types.js";
import { MARKUP_STATE_CLASS, MailMarkupResource } from "./markup-vocab.js";
import {
  createMailMarkupWriter,
  MAX_MARKUP_ITEM_NODES,
  MAX_UNVERIFIED_MARKUP_ITEMS_PER_MESSAGE,
  markupStateSlug,
  rescanMailMarkup,
} from "./markup-writer.js";
import { accountRoot, messageSlug } from "./paths.js";

vi.mock("@jeswr/rdf-serialize", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@jeswr/rdf-serialize")>();
  return { ...actual, serialize: vi.fn(actual.serialize) };
});

const account = "v@example.test";
const ROOT = "https://pod.example.test/integrations/markup/";
const message = (id: string) => `${ROOT}${messageSlug(account, id)}#it`;

/** In-memory ports: datasets by slug, container listings derived from stored slugs. */
function memoryPorts(options: { stored?: (slug: string) => boolean } = {}) {
  const docs = new Map<string, DatasetCore>();
  const writes: NormalisedDoc[] = [];
  const removed: string[] = [];
  const reads: string[] = [];
  const ctx = {
    resolve: (slug: string) => `${ROOT}${slug}`,
    async read(slug: string): Promise<DatasetCore | undefined> {
      reads.push(slug);
      if (slug.endsWith("/")) {
        const children = [...docs.keys()].filter(
          (key) => key.startsWith(slug) && !key.slice(slug.length).includes("/"),
        );
        if (!children.length) return undefined;
        const listing = new Store();
        const container = new Container(`${ROOT}${slug}`, listing, DataFactory);
        for (const child of children)
          container.contains.add(new Resource(`${ROOT}${child}`, listing, DataFactory));
        return listing;
      }
      const doc = docs.get(slug);
      if (doc) return new Store([...doc]);
      // Source messages exist unless a test says otherwise; markup starts empty.
      return slug.includes("/messages/") && (options.stored?.(slug) ?? true)
        ? new Store()
        : undefined;
    },
    async write(doc: NormalisedDoc) {
      writes.push(doc);
      if (!doc.slug.includes("/messages/")) docs.set(doc.slug, new Store([...doc.dataset]));
      return { url: `${ROOT}${doc.slug}`, slug: doc.slug, category: doc.category, items: 1 };
    },
    async remove(slug: string) {
      removed.push(slug);
      docs.delete(slug);
    },
    releaseRead: () => {},
  };
  return { ctx, docs, writes, removed, reads };
}
const itemWrites = (writes: readonly NormalisedDoc[]) =>
  writes.filter((doc) => /\/(purchases|trips)\//.test(doc.slug));

describe("markup run budget", () => {
  it("caps unverified mail per message and per run without starving later verified mail", async () => {
    // The p5 scenario: many junk unverified messages, each asserting 100 orders.
    const { ctx, writes } = memoryPorts();
    const writer = createMailMarkupWriter(ctx, account);
    const junk = jsonLdFixture(
      Array.from({ length: 100 }, (_, i) => ({
        "@type": "Order",
        orderNumber: String(i),
        seller: "Junk",
      })),
    );
    for (let i = 0; i < 20; i++) {
      const items = await writer.add({
        messageIri: message(`junk-${i}`),
        html: jsonLdFixture(
          Array.from({ length: 100 }, (_, n) => ({
            "@type": "Order",
            orderNumber: `${i}-${n}`,
            seller: "Junk",
          })),
        ),
        sender: "mailto:x%40spam.example.test",
      });
      expect(items).toHaveLength(MAX_UNVERIFIED_MARKUP_ITEMS_PER_MESSAGE);
    }
    expect(itemWrites(writes)).toHaveLength(200);
    for (let i = 20; i < 60; i++)
      await writer.add({
        messageIri: message(`junk-${i}`),
        html: junk.replaceAll('"orderNumber":"', `"orderNumber":"${i}-`),
        sender: "mailto:x%40spam.example.test",
      });
    // 500 unverified items per run, counted only as they are accepted for writing.
    expect(itemWrites(writes)).toHaveLength(500);
    expect(writer.errors).toContain("markup-item-budget-exceeded");
    expect(writer.exhausted).toBe(false);
    const legit = await writer.add({
      messageIri: message("legit"),
      html: jsonLdFixture({
        "@type": "FlightReservation",
        reservationNumber: "ABC",
        provider: "Example Air",
      }),
      sender: "mailto:a%40air.example.test",
      authentication: { dmarc: "pass", alignedDomain: "air.example.test" },
    });
    expect(legit).toHaveLength(1);
    expect(legit[0]?.trust).toBe("verified");
    expect(itemWrites(writes)).toHaveLength(501);
  });
  it("keeps the full verified per-message cap and counts only accepted items", async () => {
    const { ctx, writes } = memoryPorts();
    const writer = createMailMarkupWriter(ctx, account, { maxTotalItems: 30 });
    const html = jsonLdFixture(
      Array.from({ length: 25 }, (_, i) => ({
        "@type": "Order",
        orderNumber: String(i),
        seller: "Example Retail",
      })),
    );
    const verified = {
      sender: "mailto:r%40example.test",
      authentication: { dmarc: "pass" as const, alignedDomain: "example.test" },
    };
    expect(
      await writer.add({
        messageIri: message("a"),
        html,
        ...verified,
        dateModified: new Date("2026-01-01T00:00:00Z"),
      }),
    ).toHaveLength(25);
    // Re-asserting the same items with an older receiver time writes nothing and spends nothing.
    const stale = await writer.add({
      messageIri: message("b"),
      html,
      ...verified,
      dateModified: new Date("2000-01-01T00:00:00Z"),
    });
    expect(stale.every((item) => !item.updated)).toBe(true);
    expect(itemWrites(writes)).toHaveLength(25);
    // Unverified mail never exceeds the run allowance, which is never above maxTotalItems.
    const unverified = await writer.add({ messageIri: message("c"), html, sender: "r@other.test" });
    expect(unverified).toHaveLength(10);
    const fresh = { ...verified, dateModified: new Date() };
    const more = await writer.add({ messageIri: message("d"), html, ...fresh });
    expect(more.filter((item) => item.updated)).toHaveLength(5);
    expect(itemWrites(writes)).toHaveLength(40);
    expect(writer.errors).toEqual([]);
    expect(writer.exhausted).toBe(false);
    expect(await writer.add({ messageIri: message("e"), html, ...fresh })).toEqual([]);
    expect(writer.errors).toEqual(["markup-item-budget-exceeded"]);
    // The unverified allowance is separate, so the writer is not yet exhausted.
    expect(writer.exhausted).toBe(false);
  });
});

it("reports exhaustion once both item allowances or the PUT budget are spent", () => {
  const { ctx } = memoryPorts();
  expect(createMailMarkupWriter(ctx, account).exhausted).toBe(false);
  expect(createMailMarkupWriter(ctx, account, { maxTotalItems: 0 }).exhausted).toBe(true);
  expect(createMailMarkupWriter(ctx, account, { maxTotalWrites: 0 }).exhausted).toBe(true);
  expect(createMailMarkupWriter(ctx, account, { maxUnverifiedItems: 0 }).exhausted).toBe(false);
});

describe("item size caps", () => {
  it("abandons the 64x64 Order at the node cap, before serializing it", async () => {
    const { serialize } = await import("@jeswr/rdf-serialize");
    const { ctx, writes } = memoryPorts();
    const writer = createMailMarkupWriter(ctx, account);
    const order = {
      "@type": "Order",
      orderNumber: "1",
      seller: "Example Retail",
      acceptedOffer: Array.from({ length: 64 }, () => ({
        "@type": "Offer",
        itemOffered: Array.from({ length: 64 }, () => ({ "@type": "Product" })),
      })),
    };
    vi.mocked(serialize).mockClear();
    const items = await writer.add({
      messageIri: message("big"),
      html: jsonLdFixture(order),
      sender: "r@example.test",
    });
    expect(items).toEqual([]);
    expect(writer.errors).toEqual(["markup-item-too-large"]);
    expect(serialize).not.toHaveBeenCalled();
    expect(itemWrites(writes)).toHaveLength(0);
    // A small item in the same writer is still written.
    expect(
      await writer.add({
        messageIri: message("small"),
        html: jsonLdFixture({ ...order, acceptedOffer: { "@type": "Offer", price: "1" } }),
        sender: "r@example.test",
      }),
    ).toHaveLength(1);
    expect(MAX_MARKUP_ITEM_NODES).toBe(256);
  });
  it("abandons an item once the running byte estimate exceeds 64 KiB, before serializing", async () => {
    // The p3b scenario: a long source IRI repeated in provenance on every nested node.
    const { serialize } = await import("@jeswr/rdf-serialize");
    const { ctx, writes } = memoryPorts();
    const writer = createMailMarkupWriter(ctx, account);
    vi.mocked(serialize).mockClear();
    const items = await writer.add({
      messageIri: message(`m${"a".repeat(8000)}`),
      html: jsonLdFixture({
        "@type": "Order",
        orderNumber: "1",
        seller: "Example Retail",
        acceptedOffer: Array.from({ length: 16 }, () => ({ "@type": "Offer", price: "1" })),
      }),
      sender: "r@example.test",
    });
    expect(items).toEqual([]);
    expect(writer.errors).toEqual(["markup-item-too-large"]);
    expect(serialize).not.toHaveBeenCalled();
    expect(itemWrites(writes)).toHaveLength(0);
  });
});

describe("missing source message", () => {
  it("skips every item write when the source message read returns nothing", async () => {
    const { ctx, writes } = memoryPorts({ stored: () => false });
    const writer = createMailMarkupWriter(ctx, account);
    const items = await writer.add({
      messageIri: message("gone"),
      html: jsonLdFixture([
        { "@type": "Order", orderNumber: "1", seller: "Example Retail" },
        { "@type": "Order", orderNumber: "2", seller: "Example Retail" },
      ]),
      sender: "r@example.test",
    });
    expect(items).toEqual([]);
    expect(writes).toEqual([]);
    expect(writer.errors).toEqual(["markup-source-missing"]);
  });
});

describe("prune paging", () => {
  it("pages through 4,500 resources in three capped runs using a persisted cursor", async () => {
    const { ctx, docs, writes, removed, reads } = memoryPorts({
      // Every third resource still has its source message.
      stored: (slug) => /\/messages\/keep-/.test(slug),
    });
    const root = accountRoot(account);
    for (let i = 0; i < 4500; i++) {
      const family = i % 2 ? "trips" : "purchases";
      const slug = `${root}${family}/${i.toString(16).padStart(64, "0")}.ttl`;
      const dataset = new Store();
      new MailMarkupResource(`${ROOT}${slug}#it`, dataset, DataFactory).derivedFrom.add(
        message(i % 3 ? `gone-${i}` : `keep-${i}`),
      );
      docs.set(slug, dataset);
    }
    const checked = new Set<string>();
    const pruned: number[] = [];
    for (let run = 0; run < 3; run++) {
      reads.length = 0;
      // The prune cap is separate from the item budget.
      const result = await rescanMailMarkup(ctx, account, { prune: true, maxTotalItems: 1 });
      pruned.push(result.pruned ?? 0);
      const visited = reads.filter((slug) => /\/(purchases|trips)\/[a-f0-9]{64}\.ttl$/.test(slug));
      expect(visited.length).toBeLessThanOrEqual(2000);
      for (const slug of visited) {
        expect(checked.has(slug)).toBe(false);
        checked.add(slug);
      }
    }
    expect(checked.size).toBe(4500);
    expect(pruned.reduce((a, b) => a + b, 0)).toBe(3000);
    expect(new Set(removed).size).toBe(3000);
    expect([...docs.keys()].filter((slug) => /\/(purchases|trips)\//.test(slug))).toHaveLength(
      1500,
    );
    // The cursor lives in an unregistered state document beside the account's mail.
    const stateWrites = writes.filter((doc) => doc.slug === markupStateSlug(account));
    expect(stateWrites).toHaveLength(3);
    for (const doc of stateWrites) {
      expect(doc.skipRegistration).toBe(true);
      expect(doc.forClass).toBe(MARKUP_STATE_CLASS);
    }
    const cursor = (doc: NormalisedDoc) =>
      new MailMarkupResource(`${ROOT}${doc.slug}#it`, doc.dataset, DataFactory).pruneCursor;
    expect(cursor(stateWrites[0] as NormalisedDoc)).toMatch(/^purchases|trips\//);
    expect(cursor(stateWrites[1] as NormalisedDoc)).toBeDefined();
    // The final run reached the end, so the next run wraps to the start.
    expect(cursor(stateWrites[2] as NormalisedDoc)).toBeUndefined();
    reads.length = 0;
    expect((await rescanMailMarkup(ctx, account, { prune: true })).pruned).toBe(0);
    expect(
      reads.filter((slug) => /\/(purchases|trips)\/[a-f0-9]{64}\.ttl$/.test(slug)),
    ).toHaveLength(1500);
  });
  it("ignores a malformed persisted cursor and honors maxPruneItems", async () => {
    const { ctx, docs, writes } = memoryPorts({ stored: () => false });
    const root = accountRoot(account);
    for (let i = 0; i < 3; i++) {
      const slug = `${root}purchases/${String(i).repeat(64)}.ttl`;
      const dataset = new Store();
      new MailMarkupResource(`${ROOT}${slug}#it`, dataset, DataFactory).derivedFrom.add(
        message(`gone-${i}`),
      );
      docs.set(slug, dataset);
    }
    const state = new Store();
    new MailMarkupResource(
      `${ROOT}${markupStateSlug(account)}#it`,
      state,
      DataFactory,
    ).pruneCursor = "../../outside.ttl";
    docs.set(markupStateSlug(account), state);
    expect((await rescanMailMarkup(ctx, account, { prune: true, maxPruneItems: 2 })).pruned).toBe(
      2,
    );
    expect((await rescanMailMarkup(ctx, account, { prune: true, maxPruneItems: 2 })).pruned).toBe(
      1,
    );
    expect((await rescanMailMarkup(ctx, account, { prune: true, maxPruneItems: 0 })).pruned).toBe(
      0,
    );
    expect(writes.filter((doc) => doc.slug === markupStateSlug(account))).toHaveLength(2);
    await expect(
      rescanMailMarkup(ctx, account, { prune: true, maxPruneItems: -1 }),
    ).rejects.toThrow(TypeError);
  });
});
