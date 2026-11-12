// AUTHORED-BY Codex GPT-6.1-Sol
import { serialize } from "@jeswr/rdf-serialize";
import { Container } from "@solid/object";
import { DataFactory, Store } from "n3";
import type { ImportContext } from "../core/types.js";
import {
  extractEmailMarkupResult,
  MAX_MARKUP_ITEMS,
  MAX_MARKUP_STRING,
  markupLimit,
} from "./markup.js";
import { asciiLower } from "./markup-html.js";
import type {
  EmailMarkupItem,
  EmailMarkupOptions,
  MailMarkupAuthentication,
  MailMarkupTrust,
  MarkupNode,
  MarkupProperty,
} from "./markup-types.js";
import { MARKUP_CLASSES, MailMarkupResource } from "./markup-vocab.js";
import { accountRoot, folderSlug } from "./paths.js";
import { markupSender, receiverTime } from "./receiver.js";
import { MAIL_CLASSES, MailMessage } from "./vocab.js";

export type MailMarkupPorts = Pick<
  ImportContext,
  "resolve" | "read" | "write" | "signal" | "releaseRead"
> &
  Partial<Pick<ImportContext, "remove">>;
export interface MailMarkupSource {
  readonly messageIri: string;
  readonly html: string;
  /** Receiver-controlled timestamp only; unknown when absent. */
  readonly dateModified?: Date;
  readonly authentication?: MailMarkupAuthentication;
  readonly sender?: string;
}
export interface StoredEmailMarkup {
  readonly iri: string;
  readonly slug: string;
  readonly type: EmailMarkupItem["type"];
  readonly sourceMessage: string;
  readonly trust: MailMarkupTrust;
  readonly updated: boolean;
}
export const MAX_MARKUP_ITEM_BYTES = 64 * 1024;
export type MailMarkupErrorCode =
  | "markup-extraction-failed"
  | "markup-write-failed"
  | "markup-truncated"
  | "markup-item-too-large"
  | "markup-item-budget-exceeded"
  | "markup-write-budget-exceeded";
export interface MailMarkupWriterOptions extends EmailMarkupOptions {
  /** Root items attempted across all messages. Default 2,000; hard cap 100,000. */
  readonly maxTotalItems?: number;
  /** Markup and source-inventory PUT attempts (including failures). Default 2,000; hard cap 100,000. */
  readonly maxTotalWrites?: number;
}
export interface MailMarkupWriter {
  readonly errors: readonly MailMarkupErrorCode[];
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
/** Uses import-session ports, so reads retain ETags and writes participate in run provenance. */
export function createMailMarkupWriter(
  ctx: MailMarkupPorts,
  account: string,
  options: MailMarkupWriterOptions = {},
): MailMarkupWriter {
  const root = accountRoot(account);
  const importedAt = new Date();
  const messages = ctx.resolve(`${root}messages/`);
  const abort = () => ctx.signal?.throwIfAborted();
  const errors = new Set<MailMarkupErrorCode>();
  const maxTotal = markupLimit(options.maxTotalItems, 2000, 100_000);
  const maxWrites = markupLimit(options.maxTotalWrites, 2000, 100_000);
  let attempted = 0;
  let writes = 0;
  return {
    get errors() {
      return [...errors];
    },
    async add(source) {
      abort();
      // Provenance repeats this IRI on every nested node; bound it before RDF allocation.
      if (source.messageIri.length > MAX_MARKUP_STRING) {
        errors.add("markup-extraction-failed");
        return [];
      }
      // Source IRIs must name actual MAI-01 message subjects within this account.
      const rest = source.messageIri.slice(messages.length);
      if (!source.messageIri.startsWith(messages) || !/^[^/?#]+\.ttl#it$/.test(rest))
        throw new TypeError("Email markup source is outside the mail account");
      const results: StoredEmailMarkup[] = [];
      let pendingRead: string | undefined;
      let phase: MailMarkupErrorCode = "markup-extraction-failed";
      try {
        if (attempted >= maxTotal) {
          errors.add("markup-item-budget-exceeded");
          return results;
        }
        if (writes >= maxWrites) {
          errors.add("markup-write-budget-exceeded");
          return results;
        }
        const extraction = extractEmailMarkupResult(source.html, {
          ...options,
          maxItems: Math.min(
            markupLimit(options.maxItems, 100, MAX_MARKUP_ITEMS),
            maxTotal - attempted,
          ),
        });
        if (extraction.truncated) errors.add("markup-truncated");
        const items = extraction.items;
        attempted += items.length;
        const sender = markupSender(source.sender, source.authentication);
        const { trust } = sender;
        // Missing/malformed From never shares a booking identity across messages.
        const senderKey = sender.senderKey ?? source.messageIri;
        phase = "markup-write-failed";
        const plans: { item: EmailMarkupItem; slug: string; family: string }[] = [];
        for (const [index, item] of items.entries()) {
          const number =
            first(item, "reservationNumber") ??
            first(item, "reservationId") ??
            first(item, "orderNumber") ??
            first(item, "trackingNumber");
          const issuer = provider(item);
          const identity =
            number && issuer ? [item.type, senderKey, issuer, number] : [source.messageIri, index];
          const family =
            item.type === "Order" || item.type === "ParcelDelivery" ? "purchases" : "trips";
          const slug = `${root}${family}/${await hash(JSON.stringify(identity))}.ttl`;
          abort();
          plans.push({ item, slug, family });
        }
        // One inventory commit per email, before any item PUT, so failed writes are removable
        // without repeatedly serializing the (potentially large) source message.
        if (plans.length) {
          const messageSlug = `${root}messages/${rest.slice(0, -3)}`;
          pendingRead = messageSlug;
          const storedMessage = await ctx.read(messageSlug);
          abort();
          if (storedMessage) {
            const messageDataset = new Store([...storedMessage]);
            const inventory = new MailMarkupResource(
              source.messageIri,
              messageDataset,
              DataFactory,
            );
            let changed = false;
            for (const plan of plans) {
              if (inventory.markupSlugs.has(plan.slug)) continue;
              if (inventory.markupSlugs.size >= MAX_MARKUP_ITEMS) {
                errors.add("markup-item-budget-exceeded");
                ctx.releaseRead?.(messageSlug);
                return results;
              }
              inventory.markupSlugs.add(plan.slug);
              changed = true;
            }
            if (changed) {
              writes++;
              await ctx.write({
                slug: messageSlug,
                category: "mail",
                forClass: MAIL_CLASSES.EmailMessage,
                dataset: messageDataset,
                skipRegistration: true,
                // Retain counts from a source imported in this run, without counting
                // older source/attachment subjects as newly imported during re-scan.
                writeMode: "merge",
                carriedForward: [
                  ...new Set(
                    [...storedMessage]
                      .filter((quad) => quad.subject.termType === "NamedNode")
                      .map((quad) => quad.subject.value),
                  ),
                ],
              });
            } else ctx.releaseRead?.(messageSlug);
          } else ctx.releaseRead?.(messageSlug);
        }
        pendingRead = undefined;
        for (const { item, slug, family } of plans) {
          abort();
          pendingRead = slug;
          const previous = await ctx.read(slug);
          abort();
          const iri = `${ctx.resolve(slug)}#it`;
          const old = previous && new MailMarkupResource(iri, previous, DataFactory);
          // Unverified mail cannot replace a verified assertion with a guessed booking number.
          if (old?.trust === "verified" && trust === "unverified") {
            ctx.releaseRead?.(slug);
            continue;
          }
          const date = receiverTime(source.dateModified, importedAt);
          const oldDate = validDate(old?.dateModified);
          // A sender's unverified future timestamp cannot prevent a later verified assertion.
          const update =
            !oldDate ||
            (date?.getTime() ?? 0) >= oldDate.getTime() ||
            (trust === "verified" && old?.trust !== "verified");
          if (update) {
            const dataset = new Store();
            let child = 0;
            function writeNode(node: MarkupNode, subject: string): void {
              const resource = new MailMarkupResource(subject, dataset, DataFactory);
              if (node.type) resource.types.add(MARKUP_CLASSES[node.type]);
              resource.trust = trust;
              resource.senderKey = senderKey;
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
            if (
              new TextEncoder().encode(await serialize([...dataset])).length > MAX_MARKUP_ITEM_BYTES
            ) {
              errors.add("markup-item-too-large");
              ctx.releaseRead?.(slug);
              continue;
            }
            if (writes >= maxWrites) {
              errors.add("markup-write-budget-exceeded");
              ctx.releaseRead?.(slug);
              break;
            }
            writes++;
            abort();
            try {
              await ctx.write({
                slug,
                maxSerializedBytes: MAX_MARKUP_ITEM_BYTES,
                category: "mail",
                forClass: MARKUP_CLASSES[item.type],
                dataset,
                sourceUrl: source.messageIri,
                registrationContainer: `${root}${family}/`,
              });
              pendingRead = undefined;
              abort();
            } catch (error) {
              abort();
              if (error instanceof Error && error.name === "DocumentTooLargeError") {
                errors.add("markup-item-too-large");
                ctx.releaseRead?.(slug);
                continue;
              }
              throw error;
            }
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
      } catch {
        if (pendingRead) ctx.releaseRead?.(pendingRead);
        abort();
        errors.add(phase);
      }
      return results;
    },
  };
}
export interface RescanMailMarkupOptions extends MailMarkupWriterOptions {
  /** Maximum stored messages visited; default 10,000, hard cap 100,000. */
  readonly maxMessages?: number;
  /** Also remove assertions whose source message is missing. Requires ctx.remove. */
  readonly prune?: boolean;
  /** Trusted host lookup of receiver authentication already stored outside the current mail model. */
  readonly authentication?: (messageIri: string) => Promise<MailMarkupAuthentication | undefined>;
}
/** Re-scan a bounded messages listing; never reads .eml bytes or contacts the source provider.
 * Run within the host's serialized import session to preserve ETags, aborts and run provenance. */
export async function rescanMailMarkup(
  ctx: MailMarkupPorts,
  account: string,
  options: RescanMailMarkupOptions = {},
): Promise<{
  messages: number;
  items: number;
  pruned?: number;
  errors?: readonly MailMarkupErrorCode[];
}> {
  const cap = markupLimit(options.maxMessages, 10_000, 100_000);
  const total = markupLimit(options.maxTotalItems, 2000, 100_000);
  const perMessage = markupLimit(options.maxItems, 100, MAX_MARKUP_ITEMS);
  const writer = createMailMarkupWriter(ctx, account, options);
  const root = `${accountRoot(account)}messages/`;
  const base = ctx.resolve(root);
  const counts = { messages: 0, items: 0 };
  ctx.signal?.throwIfAborted();
  if (!cap || !total || !perMessage) return counts;
  const listing = await ctx.read(root);
  ctx.releaseRead?.(root);
  ctx.signal?.throwIfAborted();
  if (options.prune) {
    if (!ctx.remove) throw new TypeError("Markup pruning requires ctx.remove");
    let pruned = 0;
    let visits = 0;
    for (const family of ["purchases", "trips"]) {
      const dir = `${accountRoot(account)}${family}/`;
      const url = ctx.resolve(dir);
      ctx.signal?.throwIfAborted();
      const entries = await ctx.read(dir);
      ctx.releaseRead?.(dir);
      ctx.signal?.throwIfAborted();
      if (!entries) continue;
      for (const child of new Container(url, entries, DataFactory).contains) {
        if (++visits > total) break;
        ctx.signal?.throwIfAborted();
        const name = child.value.slice(url.length);
        if (!child.value.startsWith(url) || !/^[a-f0-9]{64}\.ttl$/.test(name)) continue;
        const slug = `${dir}${name}`;
        const dataset = await ctx.read(slug);
        ctx.signal?.throwIfAborted();
        if (!dataset) {
          ctx.releaseRead?.(slug);
          continue;
        }
        const sources = new MailMarkupResource(`${child.value}#it`, dataset, DataFactory)
          .derivedFrom;
        const source = sources.size === 1 ? [...sources][0] : undefined;
        const rest = source?.slice(base.length);
        if (source?.startsWith(base) && rest && /^[^/?#]+\.ttl#it$/.test(rest)) {
          const messageSlug = `${root}${rest.slice(0, -3)}`;
          const message = await ctx.read(messageSlug);
          ctx.releaseRead?.(messageSlug);
          ctx.signal?.throwIfAborted();
          if (!message) {
            await ctx.remove(slug);
            pruned++;
          }
        }
        ctx.releaseRead?.(slug);
      }
    }
    Object.assign(counts, { pruned });
  }
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
    if (
      message.bodyHtml === undefined ||
      message.folderIris.has(`${ctx.resolve(folderSlug(account, "Trash"))}#it`)
    )
      continue;
    const metadata = new MailMarkupResource(iri, dataset, DataFactory);
    const authentication =
      (await options.authentication?.(iri)) ??
      (metadata.trust === "verified"
        ? { dmarc: "pass" as const, alignedDomain: metadata.senderKey }
        : undefined);
    counts.items += (
      await writer.add({
        messageIri: iri,
        html: message.bodyHtml,
        sender: message.sender,
        dateModified: metadata.dateModified,
        authentication,
      })
    ).length;
  }
  return { ...counts, ...(writer.errors.length ? { errors: writer.errors } : {}) };
}

/** Delete only resources still owned by this message; newer assertions survive cleanup. */
export async function removeMailMarkupResources(
  ctx: MailMarkupPorts,
  account: string,
  messageIri: string,
  slugs: Iterable<string>,
): Promise<void> {
  if (!ctx.remove) throw new TypeError("Markup removal requires ctx.remove");
  const root = accountRoot(account);
  let count = 0;
  for (const slug of slugs) {
    if (++count > MAX_MARKUP_ITEMS) break;
    if (
      !slug.startsWith(root) ||
      !/^(?:purchases|trips)\/[a-f0-9]{64}\.ttl$/.test(slug.slice(root.length))
    )
      continue;
    ctx.signal?.throwIfAborted();
    const dataset = await ctx.read(slug);
    ctx.signal?.throwIfAborted();
    if (
      dataset &&
      new MailMarkupResource(`${ctx.resolve(slug)}#it`, dataset, DataFactory).derivedFrom.has(
        messageIri,
      )
    )
      await ctx.remove(slug);
    else ctx.releaseRead?.(slug);
  }
}
