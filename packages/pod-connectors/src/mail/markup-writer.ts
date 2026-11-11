// AUTHORED-BY Codex GPT-6.1-Sol
import { Container } from "@solid/object";
import { DataFactory, Store } from "n3";
import type { ImportContext } from "../core/types.js";
import { extractEmailMarkup, MAX_MARKUP_ITEMS, markupLimit } from "./markup.js";
import { asciiLower } from "./markup-html.js";
import {
  type EmailMarkupItem,
  type EmailMarkupOptions,
  emailMarkupTrust,
  type MailMarkupAuthentication,
  type MailMarkupTrust,
  type MarkupNode,
  type MarkupProperty,
} from "./markup-types.js";
import { MARKUP_CLASSES, MailMarkupResource } from "./markup-vocab.js";
import { accountRoot } from "./paths.js";
import { MAIL_CLASSES, MailMessage } from "./vocab.js";

export type MailMarkupPorts = Pick<
  ImportContext,
  "resolve" | "read" | "write" | "signal" | "releaseRead"
>;
export interface MailMarkupSource {
  readonly messageIri: string;
  readonly html: string;
  /** Receiver timestamp preferred; otherwise the stored message's sent timestamp. */
  readonly dateModified?: Date;
  readonly authentication?: MailMarkupAuthentication;
}
export interface StoredEmailMarkup {
  readonly iri: string;
  readonly slug: string;
  readonly type: EmailMarkupItem["type"];
  readonly sourceMessage: string;
  readonly trust: MailMarkupTrust;
  readonly updated: boolean;
}
export interface MailMarkupWriter {
  add(source: MailMarkupSource): Promise<readonly StoredEmailMarkup[]>;
}
function first(node: MarkupNode, prop: MarkupProperty): string | undefined {
  const value = node.properties[prop]?.[0];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function providerIdentity(value: string | MarkupNode): string | undefined {
  if (typeof value === "string")
    return value.trim() ? `name:${asciiLower(value.trim()).replace(/\s+/g, " ")}` : undefined;
  const url = first(value, "url");
  if (url) {
    try {
      return `url:${new URL(url).href}`;
    } catch {
      /* Invalid URLs remain inert metadata. */
    }
  }
  const id = first(value, "identifier");
  if (id) return `identifier:${id}`;
  const name = first(value, "name");
  return name ? `name:${asciiLower(name).replace(/\s+/g, " ")}` : undefined;
}
function provider(node: MarkupNode): string | undefined {
  for (const prop of [
    "provider",
    "seller",
    "merchant",
    "broker",
    "bookingAgent",
    "carrier",
    "airline",
    "rentalCompany",
    "organizer",
  ] as const) {
    const value = node.properties[prop]?.[0];
    if (typeof value === "string" || (value && typeof value === "object")) {
      const identity = providerIdentity(value);
      if (identity) return identity;
    }
  }
  if (
    node.type &&
    ["Hotel", "LodgingBusiness", "Restaurant", "FoodEstablishment", "AutoRental"].includes(
      node.type,
    )
  )
    return providerIdentity(node);
  const reservation = node.properties.reservationFor?.[0];
  return reservation && typeof reservation === "object" ? provider(reservation) : undefined;
}
async function hash(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
function validDate(value: Date | undefined): Date | undefined {
  return value && Number.isFinite(value.getTime()) ? value : undefined;
}
function modified(item: EmailMarkupItem, source: MailMarkupSource): Date {
  const stored = validDate(source.dateModified);
  if (stored) return stored;
  const value = first(item, "dateModified") ?? first(item, "modifiedTime");
  const date =
    value && /^\d{4}-\d\d-\d\d(?:T.*(?:Z|[+-]\d\d:\d\d))?$/.test(value)
      ? new Date(value)
      : undefined;
  return validDate(date) ?? new Date(0);
}
/** Uses import-session ports, so reads retain ETags and writes participate in run provenance. */
export function createMailMarkupWriter(
  ctx: MailMarkupPorts,
  account: string,
  options: EmailMarkupOptions = {},
): MailMarkupWriter {
  const root = accountRoot(account);
  const messages = ctx.resolve(`${root}messages/`);
  const abort = () => ctx.signal?.throwIfAborted();
  return {
    async add(source) {
      abort();
      // Source IRIs must name actual MAI-01 message subjects within this account.
      const rest = source.messageIri.slice(messages.length);
      if (!source.messageIri.startsWith(messages) || !/^[^/?#]+\.ttl#it$/.test(rest))
        throw new TypeError("Email markup source is outside the mail account");
      const items = extractEmailMarkup(source.html, options);
      const trust = emailMarkupTrust(source.authentication);
      const results: StoredEmailMarkup[] = [];
      for (const [index, item] of items.entries()) {
        abort();
        const number =
          first(item, "reservationNumber") ??
          first(item, "reservationId") ??
          first(item, "orderNumber") ??
          first(item, "trackingNumber");
        const issuer = provider(item);
        const identity =
          number && issuer ? [item.type, issuer, number] : [source.messageIri, index];
        const family =
          item.type === "Order" || item.type === "ParcelDelivery" ? "purchases" : "trips";
        let slug = `${root}${family}/${await hash(JSON.stringify(identity))}.ttl`;
        abort();
        let previous = await ctx.read(slug);
        let iri = `${ctx.resolve(slug)}#it`;
        let old = previous && new MailMarkupResource(iri, previous, DataFactory);
        // Unverified mail cannot replace a verified assertion with a guessed booking number.
        if (old?.trust === "verified" && trust === "unverified") {
          ctx.releaseRead?.(slug);
          slug = `${root}${family}/${await hash(JSON.stringify([source.messageIri, index, "unverified"]))}.ttl`;
          abort();
          previous = await ctx.read(slug);
          iri = `${ctx.resolve(slug)}#it`;
          old = previous && new MailMarkupResource(iri, previous, DataFactory);
        }
        const date = modified(item, source);
        const oldDate = validDate(old?.dateModified);
        // A sender's unverified future timestamp cannot prevent a later verified assertion.
        const update =
          !oldDate ||
          date.getTime() >= oldDate.getTime() ||
          (trust === "verified" && old?.trust !== "verified");
        if (update) {
          const dataset = new Store();
          let child = 0;
          function writeNode(node: MarkupNode, subject: string): void {
            const resource = new MailMarkupResource(subject, dataset, DataFactory);
            if (node.type) resource.types.add(MARKUP_CLASSES[node.type]);
            resource.trust = trust;
            resource.derivedFrom.add(source.messageIri);
            for (const [key, values] of Object.entries(node.properties)) {
              const prop = key as MarkupProperty;
              if (subject === iri && prop === "dateModified") continue;
              for (const value of values ?? []) {
                if (typeof value !== "object") resource.addLiteral(prop, value);
                else {
                  const linked = `${ctx.resolve(slug)}#node-${child++}`;
                  resource.links(prop).add(linked);
                  writeNode(value, linked);
                }
              }
            }
          }
          writeNode(item, iri);
          const resource = new MailMarkupResource(iri, dataset, DataFactory);
          resource.dateModified = date;
          // Each replacement describes the current assertion and its source message.
          // Older email resources remain stored; do not accumulate an unbounded history here.
          abort();
          await ctx.write({
            slug,
            category: "mail",
            forClass: MARKUP_CLASSES[item.type],
            dataset,
            sourceUrl: source.messageIri,
            registrationContainer: `${root}${family}/`,
          });
        }
        if (!update) ctx.releaseRead?.(slug);
        results.push({
          iri,
          slug,
          type: item.type,
          sourceMessage: source.messageIri,
          trust,
          updated: update,
        });
      }
      return results;
    },
  };
}
export interface RescanMailMarkupOptions extends EmailMarkupOptions {
  /** Maximum stored messages visited; default 10,000, hard cap 100,000. */
  readonly maxMessages?: number;
  /** Root items across the re-scan; default 10,000, hard cap 100,000. */
  readonly maxTotalItems?: number;
  /** Trusted host lookup of receiver authentication already stored outside the current mail model. */
  readonly authentication?: (messageIri: string) => Promise<MailMarkupAuthentication | undefined>;
}
/** Re-scan a bounded messages listing; never reads .eml bytes or contacts the source provider.
 * Run within the host's serialized import session to preserve ETags, aborts and run provenance. */
export async function rescanMailMarkup(
  ctx: MailMarkupPorts,
  account: string,
  options: RescanMailMarkupOptions = {},
): Promise<{ messages: number; items: number }> {
  const cap = markupLimit(options.maxMessages, 10_000, 100_000);
  const total = markupLimit(options.maxTotalItems, 10_000, 100_000);
  const perMessage = markupLimit(options.maxItems, 100, MAX_MARKUP_ITEMS);
  const root = `${accountRoot(account)}messages/`;
  const base = ctx.resolve(root);
  const counts = { messages: 0, items: 0 };
  ctx.signal?.throwIfAborted();
  if (!cap || !total || !perMessage) return counts;
  const listing = await ctx.read(root);
  ctx.releaseRead?.(root);
  ctx.signal?.throwIfAborted();
  if (!listing) return counts;
  // Bound listing entries visited as well as messages processed.
  let visited = 0;
  for (const child of new Container(base, listing, DataFactory).contains) {
    ctx.signal?.throwIfAborted();
    if (++visited > cap || counts.items >= total) break;
    const name = child.value.slice(base.length);
    if (!child.value.startsWith(base) || !/^[^/?#]+\.ttl$/.test(name)) continue;
    const iri = `${child.value}#it`;
    const dataset = await ctx.read(`${root}${name}`);
    ctx.releaseRead?.(`${root}${name}`);
    ctx.signal?.throwIfAborted();
    if (!dataset) continue;
    const message = new MailMessage(iri, dataset, DataFactory);
    if (!message.types.has(MAIL_CLASSES.EmailMessage)) continue;
    counts.messages++;
    if (message.bodyHtml === undefined) continue;
    const authentication = await options.authentication?.(iri);
    counts.items += (
      await createMailMarkupWriter(ctx, account, {
        ...options,
        maxItems: Math.min(perMessage, total - counts.items),
      }).add({
        messageIri: iri,
        html: message.bodyHtml,
        dateModified: message.dateReceived ?? message.dateSent,
        authentication,
      })
    ).length;
  }
  return counts;
}
