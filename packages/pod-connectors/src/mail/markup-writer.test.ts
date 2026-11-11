// AUTHORED-BY Codex GPT-6.1-Sol
import { Container, Resource } from "@solid/object";
import { DataFactory, Store } from "n3";
import { describe, expect, it, vi } from "vitest";
import { runImport } from "../core/import-runner.js";
import { createFetchPodWriter } from "../core/pod-writer.js";
import { Provenance } from "../core/provenance.js";
import { createMemoryPod, TEST_POD_ROOT, TEST_PROFILE_DOC, TEST_WEBID } from "../core/testing.js";
import type { ImportContext } from "../core/types.js";
import { EMAIL_MARKUP_FIXTURES, jsonLdFixture } from "./markup-fixtures.js";
import { MARKUP_CLASSES, MARKUP_PREDICATES, MailMarkupResource } from "./markup-vocab.js";
import {
  createMailMarkupWriter,
  type MailMarkupSource,
  rescanMailMarkup,
  type StoredEmailMarkup,
} from "./markup-writer.js";
import { messageSlug } from "./paths.js";
import { MAIL_CLASSES, MailMessage } from "./vocab.js";

const account = "example@example.test";
const ROOT = `${TEST_POD_ROOT}integrations/markup/`;
const message = (id: string) => `${ROOT}${messageSlug(account, id)}#it`;
const date = new Date("2026-12-01T09:00:00Z");
function setup() {
  const pod = createMemoryPod();
  const podWriter = createFetchPodWriter({
    adapterId: "markup",
    webId: TEST_WEBID,
    profileDocumentUrl: TEST_PROFILE_DOC,
    podRoot: TEST_POD_ROOT,
    fetch: pod.fetch,
  });
  async function run(callback: (ctx: ImportContext) => Promise<void>, signal?: AbortSignal) {
    return runImport({
      adapter: {
        metadata: {
          id: "markup",
          name: "Markup",
          tier: "C",
          authKind: "export-file",
          scopes: [],
          categories: ["mail"],
          whatYouGet: "",
          requirements: [],
        },
        fixtures: () => [],
        async import(ctx) {
          await callback(ctx);
          return {};
        },
      },
      podWriter,
      mode: "demo",
      signal,
    });
  }
  return { pod, podWriter, run };
}
function source(index = 2, extra: Partial<MailMarkupSource> = {}): MailMarkupSource {
  return {
    messageIri: message("one"),
    html: jsonLdFixture(EMAIL_MARKUP_FIXTURES[index]),
    dateModified: date,
    ...extra,
  };
}
const resource = (pod: ReturnType<typeof createMemoryPod>, item: StoredEmailMarkup) =>
  new MailMarkupResource(item.iri, pod.dataset(`${ROOT}${item.slug}`), DataFactory);
const markupUrls = (pod: ReturnType<typeof createMemoryPod>) =>
  pod.urls().filter((url) => /\/(purchases|trips)\/.+\.ttl$/.test(url));

describe("MailMarkupWriter persistence", () => {
  it("writes every supported type, nested resources, trust, message provenance and registrations", async () => {
    const { pod, run } = setup();
    await run(async (ctx) => {
      const writer = createMailMarkupWriter(ctx, account);
      for (const [index, fixture] of EMAIL_MARKUP_FIXTURES.entries()) {
        const [result] = await writer.add(source(index, { messageIri: message(String(index)) }));
        expect(result?.type).toBe(fixture["@type"]);
        expect(result?.trust).toBe("unverified");
        expect(result?.slug).toContain(index < 2 ? "/purchases/" : "/trips/");
        const stored = resource(pod, result as StoredEmailMarkup);
        expect(stored.types.has(MARKUP_CLASSES[result?.type ?? "Order"])).toBe(true);
        expect(stored.derivedFrom.has(message(String(index)))).toBe(true);
        expect(stored.dateModified).toEqual(date);
        const childIris = [...stored.links(index === 0 ? "acceptedOffer" : "provider")];
        if (index !== 1) expect(childIris).toHaveLength(1);
      }
    });
    expect(markupUrls(pod)).toHaveLength(9);
    const index = pod.urls().find((url) => url.includes("privateTypeIndex"));
    expect(index).toBeDefined();
    expect(pod.get(index as string)).toContain("purchases/");
    expect(pod.get(index as string)).toContain("trips/");
  });
  it("replays idempotently and applies a newer change email to the same reservation", async () => {
    const { pod, run } = setup();
    let first: StoredEmailMarkup;
    await run(async (ctx) => {
      [first] = (await createMailMarkupWriter(ctx, account).add(source())) as StoredEmailMarkup[];
    });
    await run(async (ctx) => {
      const [again] = await createMailMarkupWriter(ctx, account).add(source());
      expect(again?.iri).toBe(first.iri);
    });
    const newer = new Date("2026-12-02T09:00:00Z");
    await run(async (ctx) => {
      const [changed] = await createMailMarkupWriter(ctx, account).add(
        source(2, {
          messageIri: message("change"),
          dateModified: newer,
          html: jsonLdFixture({
            ...EMAIL_MARKUP_FIXTURES[2],
            reservationStatus: "https://schema.org/ReservationCancelled",
          }),
        }),
      );
      expect(changed?.iri).toBe(first.iri);
      const stored = resource(pod, changed as StoredEmailMarkup);
      expect(stored.dateModified).toEqual(newer);
      expect([...stored.strings("reservationStatus")]).toEqual([
        "https://schema.org/ReservationCancelled",
      ]);
      expect(stored.derivedFrom.has(message("change"))).toBe(true);
      expect(
        new Provenance(changed?.iri as string, stored.dataset, DataFactory).generatedBy.size,
      ).toBe(1);
    });
    await run(async (ctx) => {
      const [older] = await createMailMarkupWriter(ctx, account).add(source());
      expect(older?.updated).toBe(false);
      expect(resource(pod, older as StoredEmailMarkup).dateModified).toEqual(newer);
    });
    expect(markupUrls(pod)).toHaveLength(1);
  });
  it("separates providers, root types, accounts, and numberless message/index identities", async () => {
    const { pod, run } = setup();
    await run(async (ctx) => {
      const writer = createMailMarkupWriter(ctx, account);
      const [one] = await writer.add(source());
      const [other] = await writer.add(
        source(2, {
          html: jsonLdFixture({
            ...EMAIL_MARKUP_FIXTURES[2],
            provider: { "@type": "Organization", name: "Other Air" },
          }),
        }),
      );
      expect(other?.iri).not.toBe(one?.iri);
      const [accountTwo] = await createMailMarkupWriter(ctx, "two@example.test").add(
        source(2, { messageIri: `${ROOT}${messageSlug("two@example.test", "one")}#it` }),
      );
      expect(accountTwo?.iri).not.toBe(one?.iri);
      const html = jsonLdFixture([
        { "@type": "Order", name: "No number" },
        { "@type": "Order", name: "Second" },
      ]);
      const a = await writer.add(source(0, { html }));
      const b = await writer.add(source(0, { html }));
      const c = await writer.add(source(0, { html, messageIri: message("two") }));
      expect(a.map((item) => item.iri)).toEqual(b.map((item) => item.iri));
      expect(a[0]?.iri).not.toBe(a[1]?.iri);
      expect(a[0]?.iri).not.toBe(c[0]?.iri);
    });
    expect(markupUrls(pod)).toHaveLength(7);
  });
  it("marks stored receiver evidence verified and prevents an unverified change from replacing it", async () => {
    const { pod, run } = setup();
    await run(async (ctx) => {
      const writer = createMailMarkupWriter(ctx, account);
      const [verified] = await writer.add(source(2, { authentication: { dmarc: "pass" } }));
      expect(resource(pod, verified as StoredEmailMarkup).trust).toBe("verified");
      const [unverified] = await writer.add(
        source(2, { messageIri: message("spoof"), dateModified: new Date("2026-12-03T00:00:00Z") }),
      );
      expect(unverified?.iri).not.toBe(verified?.iri);
      expect(resource(pod, verified as StoredEmailMarkup).trust).toBe("verified");
      expect(resource(pod, unverified as StoredEmailMarkup).trust).toBe("unverified");
      const [repeat] = await writer.add(source(2, { messageIri: message("spoof") }));
      expect(repeat?.iri).toBe(unverified?.iri);
    });
  });
  it("stores strings as literals and finite numeric/boolean values through typed accessors", async () => {
    const { pod, run } = setup();
    await run(async (ctx) => {
      const [item] = await createMailMarkupWriter(ctx, account).add(
        source(0, {
          html: jsonLdFixture({
            "@type": "Order",
            name: 'a"; <https://evil.test/> <https://evil.test/> "x',
            url: "javascript:alert(1)",
            price: 12.5,
            orderQuantity: 2,
            description: false,
          }),
        }),
      );
      const stored = resource(pod, item as StoredEmailMarkup);
      expect([...stored.strings("name")][0]).toContain('a";');
      const terms = new Store(stored.dataset).getObjects(
        DataFactory.namedNode(item?.iri as string),
        DataFactory.namedNode(MARKUP_PREDICATES.price),
        null,
      );
      expect(terms[0]).toMatchObject({ termType: "Literal", value: "12.5" });
      expect(
        new Store(stored.dataset).getObjects(
          DataFactory.namedNode(item?.iri as string),
          DataFactory.namedNode(MARKUP_PREDICATES.url),
          null,
        )[0]?.termType,
      ).toBe("Literal");
    });
  });
  it("falls back to epoch for missing/invalid dates and accepts a valid markup modification time", async () => {
    const { pod, run } = setup();
    await run(async (ctx) => {
      const writer = createMailMarkupWriter(ctx, account);
      const [a] = await writer.add(source(0, { dateModified: new Date(NaN) }));
      expect(resource(pod, a as StoredEmailMarkup).dateModified).toEqual(new Date(0));
      const [b] = await writer.add(
        source(0, {
          dateModified: undefined,
          html: jsonLdFixture({
            ...EMAIL_MARKUP_FIXTURES[0],
            dateModified: "2026-12-01T10:00:00Z",
          }),
        }),
      );
      expect(resource(pod, b as StoredEmailMarkup).dateModified?.toISOString()).toBe(
        "2026-12-01T10:00:00.000Z",
      );
    });
  });
  it("rejects sources outside this account before any Pod I/O", async () => {
    const ctx = { resolve: (s: string) => `${ROOT}${s}`, read: vi.fn(), write: vi.fn() };
    await expect(
      createMailMarkupWriter(ctx, account).add(
        source(0, { messageIri: "https://evil.test/message#it" }),
      ),
    ).rejects.toThrow(TypeError);
    expect(ctx.read).not.toHaveBeenCalled();
    expect(ctx.write).not.toHaveBeenCalled();
  });
  it("checks abort after a pending read, immediately before starting a write", async () => {
    const controller = new AbortController();
    const ctx = {
      signal: controller.signal,
      resolve: (s: string) => `${ROOT}${s}`,
      read: vi.fn(async () => {
        controller.abort();
        return undefined;
      }),
      write: vi.fn(),
    };
    await expect(createMailMarkupWriter(ctx, account).add(source())).rejects.toThrow();
    expect(ctx.write).not.toHaveBeenCalled();
  });
  it("preserves conditional-write conflicts", async () => {
    const { pod, podWriter, run } = setup();
    await expect(
      run(async (ctx) => {
        const ports = {
          ...ctx,
          async read(slug: string) {
            const old = await ctx.read(slug);
            await podWriter.write(
              {
                slug,
                category: "mail",
                forClass: MARKUP_CLASSES.FlightReservation,
                dataset: new Store(),
              },
              { ifNoneMatch: "*" },
            );
            return old;
          },
        };
        await createMailMarkupWriter(ports, account).add(source());
      }),
    ).rejects.toThrow();
    expect(markupUrls(pod)).toHaveLength(1);
  });
});
describe("stored mail re-scan", () => {
  it("uses only stored HTML, the stored message timestamp, a bounded listing and optional stored auth", async () => {
    const { pod, run } = setup();
    const auth = vi.fn(async () => ({ dmarc: "pass" as const }));
    const save = async (ctx: ImportContext, id: string) => {
      const slug = messageSlug(account, id);
      const dataset = new Store();
      const mail = new MailMessage(message(id), dataset, DataFactory);
      mail.types.add(MAIL_CLASSES.EmailMessage);
      mail.bodyHtml = source().html;
      mail.dateReceived = date;
      await ctx.write({ slug, category: "mail", forClass: MAIL_CLASSES.EmailMessage, dataset });
    };
    await run(async (ctx) => {
      await save(ctx, "one");
      await save(ctx, "two");
    });
    await run(async (ctx) => {
      const result = await rescanMailMarkup(ctx, account, { maxMessages: 1, authentication: auth });
      expect(result).toEqual({ messages: 1, items: 1 });
    });
    expect(auth).toHaveBeenCalledTimes(1);
    const url = markupUrls(pod)[0] as string;
    const stored = new MailMarkupResource(`${url}#it`, pod.dataset(url), DataFactory);
    expect(stored.trust).toBe("verified");
    expect(stored.dateModified).toEqual(date);
  });
  it("returns an empty result for missing mail and maxMessages=0, and honors cancellation", async () => {
    const { run } = setup();
    await run(async (ctx) => {
      expect(await rescanMailMarkup(ctx, account)).toEqual({ messages: 0, items: 0 });
      expect(await rescanMailMarkup(ctx, account, { maxMessages: 0 })).toEqual({
        messages: 0,
        items: 0,
      });
    });
    const abort = new AbortController();
    abort.abort();
    await expect(
      rescanMailMarkup(
        { resolve: (s) => `${ROOT}${s}`, read: vi.fn(), write: vi.fn(), signal: abort.signal },
        account,
      ),
    ).rejects.toThrow();
  });
});

describe("markup update and re-scan boundaries", () => {
  it("updates by orderNumber, removes old nested fields and preserves case-sensitive provider identities", async () => {
    const { pod, run } = setup();
    await run(async (ctx) => {
      const writer = createMailMarkupWriter(ctx, account);
      const [first] = await writer.add(source(0));
      const [changed] = await writer.add(
        source(0, {
          messageIri: message("order-change"),
          dateModified: new Date("2026-12-03T00:00:00Z"),
          html: jsonLdFixture({
            "@type": "Order",
            orderNumber: "TEST-ORDER-42",
            seller: { "@type": "Organization", name: "  EXAMPLE   RETAIL " },
            orderStatus: "https://schema.org/OrderCancelled",
          }),
        }),
      );
      expect(changed?.iri).toBe(first?.iri);
      const stored = resource(pod, changed as StoredEmailMarkup);
      expect(stored.strings("orderStatus").has("https://schema.org/OrderCancelled")).toBe(true);
      expect(
        new Store(stored.dataset)
          .getQuads(null, null, null, null)
          .some((quad) => quad.predicate.value === MARKUP_PREDICATES.acceptedOffer),
      ).toBe(false);
      const [upper] = await writer.add(
        source(0, {
          html: jsonLdFixture({
            "@type": "Order",
            orderNumber: "42",
            seller: { "@type": "Organization", url: "https://shop.example.test/A" },
          }),
        }),
      );
      const [lower] = await writer.add(
        source(0, {
          html: jsonLdFixture({
            "@type": "Order",
            orderNumber: "42",
            seller: { "@type": "Organization", url: "https://shop.example.test/a" },
          }),
        }),
      );
      expect(upper?.iri).not.toBe(lower?.iri);
    });
  });
  it("uses a nested airline provider when the reservation has no top-level provider", async () => {
    const { run } = setup();
    await run(async (ctx) => {
      const writer = createMailMarkupWriter(ctx, account);
      const html = jsonLdFixture({
        "@type": "FlightReservation",
        reservationNumber: "42",
        reservationFor: { "@type": "Flight", airline: { "@type": "Airline", name: "Example Air" } },
      });
      const [one] = await writer.add(source(2, { html }));
      const [two] = await writer.add(source(2, { html, messageIri: message("changed") }));
      expect(one?.iri).toBe(two?.iri);
    });
  });
  it("skips foreign/nested listings, missing documents, other types and messages without HTML", async () => {
    const listing = new Store();
    const root = `mail/example~40example.test/messages/`;
    const base = `${ROOT}${root}`;
    const container = new Container(base, listing, DataFactory);
    for (const url of [
      "https://evil.test/evil.ttl",
      `${base}nested/doc.ttl`,
      `${base}missing.ttl`,
      `${base}other.ttl`,
      `${base}plain.ttl`,
    ])
      container.contains.add(new Resource(url, listing, DataFactory));
    const plain = new Store();
    new MailMessage(`${base}plain.ttl#it`, plain, DataFactory).types.add(MAIL_CLASSES.EmailMessage);
    const read = vi.fn(async (slug: string) =>
      slug === root
        ? listing
        : slug.endsWith("plain.ttl")
          ? plain
          : slug.endsWith("other.ttl")
            ? new Store()
            : undefined,
    );
    const ctx = { resolve: (s: string) => `${ROOT}${s}`, read, write: vi.fn() };
    expect(await rescanMailMarkup(ctx, account)).toEqual({ messages: 1, items: 0 });
    expect(read).toHaveBeenCalledTimes(4);
    expect(ctx.write).not.toHaveBeenCalled();
    await expect(rescanMailMarkup(ctx, account, { maxMessages: -1 })).rejects.toThrow(TypeError);
  });
  it("does not start the authentication lookup if cancellation arrives during a stored-mail read", async () => {
    const controller = new AbortController();
    const listing = new Store();
    const root = `mail/example~40example.test/messages/`;
    const base = `${ROOT}${root}`;
    new Container(base, listing, DataFactory).contains.add(
      new Resource(`${base}one.ttl`, listing, DataFactory),
    );
    const mail = new Store();
    const stored = new MailMessage(`${base}one.ttl#it`, mail, DataFactory);
    stored.types.add(MAIL_CLASSES.EmailMessage);
    stored.bodyHtml = source().html;
    const auth = vi.fn();
    const read = vi.fn(async (slug: string) => {
      if (slug === root) return listing;
      controller.abort();
      return mail;
    });
    const ctx = {
      resolve: (s: string) => `${ROOT}${s}`,
      read,
      write: vi.fn(),
      signal: controller.signal,
    };
    await expect(rescanMailMarkup(ctx, account, { authentication: auth })).rejects.toThrow();
    expect(auth).not.toHaveBeenCalled();
    expect(ctx.write).not.toHaveBeenCalled();
  });
});

it("identifies a hotel or restaurant as the provider when no booking agent is given", async () => {
  const { run } = setup();
  await run(async (ctx) => {
    const writer = createMailMarkupWriter(ctx, account);
    for (const [type, service] of [
      ["LodgingReservation", "Hotel"],
      ["FoodEstablishmentReservation", "Restaurant"],
    ]) {
      const html = jsonLdFixture({
        "@type": type,
        reservationNumber: "TEST-42",
        reservationFor: { "@type": service, name: "Example venue" },
      });
      const [one] = await writer.add(source(5, { html }));
      const [two] = await writer.add(source(5, { html, messageIri: message("changed") }));
      expect(one?.iri).toBe(two?.iri);
    }
  });
});

it("promotes verified evidence despite an unverified future timestamp", async () => {
  const { pod, run } = setup();
  await run(async (ctx) => {
    const writer = createMailMarkupWriter(ctx, account);
    const [unverified] = await writer.add(
      source(2, { messageIri: message("future"), dateModified: new Date("2099-01-01T00:00:00Z") }),
    );
    const [verified] = await writer.add(source(2, { authentication: { dmarc: "pass" } }));
    expect(verified?.iri).toBe(unverified?.iri);
    expect(verified?.updated).toBe(true);
    expect(resource(pod, verified as StoredEmailMarkup).trust).toBe("verified");
    expect(resource(pod, verified as StoredEmailMarkup).dateModified).toEqual(date);
  });
});

it("releases source reads and skipped markup reads without dropping write preconditions", async () => {
  const { run } = setup();
  await run(async (ctx) => {
    const releaseRead = vi.fn(ctx.releaseRead);
    const ports = { ...ctx, releaseRead };
    const writer = createMailMarkupWriter(ports, account);
    const [first] = await writer.add(source(2, { authentication: { dmarc: "pass" } }));
    expect(releaseRead).not.toHaveBeenCalled();
    await writer.add(
      source(2, {
        messageIri: message("old"),
        dateModified: new Date("2020-01-01T00:00:00Z"),
        authentication: { dmarc: "pass" },
      }),
    );
    expect(releaseRead).toHaveBeenCalledWith(first?.slug);
    const messageDataset = new Store();
    const mail = new MailMessage(message("one"), messageDataset, DataFactory);
    mail.types.add(MAIL_CLASSES.EmailMessage);
    mail.bodyHtml = source().html;
    mail.dateReceived = date;
    await ctx.write({
      slug: messageSlug(account, "one"),
      category: "mail",
      forClass: MAIL_CLASSES.EmailMessage,
      dataset: messageDataset,
    });
    await rescanMailMarkup(ports, account);
    expect(releaseRead).toHaveBeenCalledWith("mail/example~40example.test/messages/");
    expect(releaseRead).toHaveBeenCalledWith(messageSlug(account, "one"));
  });
});

it("bounds root items across the entire re-scan, including within its final message", async () => {
  const { run } = setup();
  await run(async (ctx) => {
    for (const id of ["one", "two"]) {
      const dataset = new Store();
      const mail = new MailMessage(message(id), dataset, DataFactory);
      mail.types.add(MAIL_CLASSES.EmailMessage);
      mail.bodyHtml = jsonLdFixture([
        { "@type": "Order", name: "one" },
        { "@type": "Order", name: "two" },
      ]);
      await ctx.write({
        slug: messageSlug(account, id),
        category: "mail",
        forClass: MAIL_CLASSES.EmailMessage,
        dataset,
      });
    }
    expect(await rescanMailMarkup(ctx, account, { maxTotalItems: 3 })).toEqual({
      messages: 2,
      items: 3,
    });
    expect(await rescanMailMarkup(ctx, account, { maxTotalItems: 0 })).toEqual({
      messages: 0,
      items: 0,
    });
  });
});
