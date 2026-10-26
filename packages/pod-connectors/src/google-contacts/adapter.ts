// AUTHORED-BY Codex GPT-6.1-Sol
import type { DatasetCore } from "@rdfjs/types";
import { DataFactory, Store } from "n3";
import { createGoogleOAuthConfig, GOOGLE_SCOPES } from "../adapters/google/oauth.js";
import { IntegrationSyncError } from "../core/errors.js";
import { getJson } from "../core/fixture-fetch.js";
import type { ImportContext, ImportOutcome, IntegrationAdapter } from "../core/types.js";
import {
  GOOGLE_CONTACTS_FIXTURES,
  type GoogleConnectionsList,
  type GooglePerson,
  PEOPLE_API,
} from "./fixtures.js";
import { personDocument, personId, personSlug } from "./mapping.js";
import { AddressBook, Contact, VCARD, vocabMap } from "./vocab-map.js";

const ID = "google-contacts";
const INDEX = "contacts/index.ttl";
const PEOPLE = "contacts/people.ttl";
const PERSON_FIELDS =
  "names,emailAddresses,phoneNumbers,addresses,organizations,birthdays,metadata";
class ExpiredSyncToken extends IntegrationSyncError {}

/** People API → SolidOS vCard address book. Source pages are buffered before Pod mutations. */
export const googleContactsAdapter: IntegrationAdapter = {
  vocabMap,
  metadata: {
    id: ID,
    name: "Google Contacts",
    tier: "B",
    authKind: "oauth-pkce",
    scopes: GOOGLE_SCOPES.contacts,
    categories: ["contacts"],
    whatYouGet:
      "Your contacts, saved into an address book with names, email, phone and postal details.",
    requirements: [
      "Google OAuth verification: contacts.readonly is a sensitive scope; configure test users until the app is approved.",
      "Browser hosts inject a Web OAuth client id and token proxy URL (TOKEN_PROXY); register their OAuth callback URI.",
      "Node hosts inject a Desktop OAuth client configuration and use loopback PKCE.",
    ],
  },
  oauth: createGoogleOAuthConfig("contacts"),
  fixtures: () => GOOGLE_CONTACTS_FIXTURES,
  async import(ctx: ImportContext): Promise<ImportOutcome> {
    ctx.progress({ label: "Fetching your contacts…", done: 0 });
    const existing = await ctx.read(PEOPLE);
    const bookIri = `${ctx.resolve(INDEX)}#this`;
    const previous = members(ctx, existing, bookIri);
    let syncToken = existing ? ctx.cursor : undefined;
    let batch: Awaited<ReturnType<typeof connections>>;
    try {
      batch = await connections(ctx, syncToken);
    } catch (error) {
      if (
        !syncToken ||
        !(
          error instanceof ExpiredSyncToken ||
          (error instanceof IntegrationSyncError && error.status === 410)
        )
      )
        throw error;
      // No local mutations have happened: discard partial pages and retry a full snapshot once.
      syncToken = undefined;
      batch = await connections(ctx);
    }
    const current = syncToken ? new Map(previous) : new Map<string, string>();
    const changes = new Map<string, GooglePerson>();
    let skipped = 0;
    for (const person of batch.people) {
      const id = personId(person?.resourceName);
      if (id === undefined) {
        skipped++;
        continue;
      }
      changes.set(id, person);
    }
    const docs = [];
    const removed = new Set<string>();
    for (const [id, person] of changes) {
      const slug = personSlug(id);
      if (person.metadata?.deleted === true) {
        current.delete(slug);
        removed.add(slug);
      } else {
        const { doc, fn } = personDocument(person, id, (path) => ctx.resolve(path));
        docs.push(doc);
        current.set(slug, fn);
      }
    }
    // A full resync also removes contacts no longer present in the source snapshot.
    if (!syncToken) for (const slug of previous.keys()) if (!current.has(slug)) removed.add(slug);
    for (const slug of removed) {
      await ctx.read(slug); // retain its ETag for the delete port
      await ctx.remove(slug);
    }
    for (const doc of docs) await ctx.write(doc);

    const index = new Store();
    const book = new AddressBook(bookIri, index, DataFactory);
    book.types.add(`${VCARD}AddressBook`);
    book.title = "Google Contacts";
    book.nameEmailIndex = ctx.resolve(PEOPLE);
    await ctx.write({
      slug: INDEX,
      category: "contacts",
      forClass: `${VCARD}AddressBook`,
      dataset: index,
      registrationContainer: "contacts/",
    });
    const people = new Store();
    for (const [slug, fn] of current) {
      const contact = new Contact(`${ctx.resolve(slug)}#this`, people, DataFactory);
      contact.inAddressBook = bookIri;
      contact.fn = fn;
    }
    // Exactly one membership rewrite, including empty increments and full snapshots.
    await ctx.write({
      slug: PEOPLE,
      category: "contacts",
      forClass: `${VCARD}Individual`,
      dataset: people,
      skipRegistration: true,
    });
    ctx.progress({ label: "Done", done: current.size, total: current.size });
    return { cursor: batch.cursor, skipped: skipped || undefined };
  },
};

/** Accept only this adapter's managed person paths, even if local RDF was edited externally. */
function members(
  ctx: ImportContext,
  dataset: DatasetCore | undefined,
  book: string,
): Map<string, string> {
  const result = new Map<string, string>();
  if (!dataset) return result;
  const root = ctx.resolve("contacts/Person/");
  const suffix = "/index.ttl#this";
  for (const quad of dataset.match(
    null,
    DataFactory.namedNode(`${VCARD}inAddressBook`),
    DataFactory.namedNode(book),
  )) {
    const subject = quad.subject;
    if (
      subject.termType !== "NamedNode" ||
      !subject.value.startsWith(root) ||
      !subject.value.endsWith(suffix)
    )
      continue;
    const part = subject.value.slice(root.length, -suffix.length);
    if (!/^(?:[A-Za-z0-9_!.'()*-]|~[0-9A-F]{2})+$/.test(part) || part === "." || part === "..")
      continue;
    const slug = `contacts/Person/${part}/index.ttl`;
    const contact = new Contact(subject.value, dataset, DataFactory);
    result.set(slug, contact.fn ?? "(unnamed contact)");
  }
  return result;
}

async function connections(
  ctx: ImportContext,
  syncToken?: string,
): Promise<{ people: GooglePerson[]; cursor: string }> {
  const people: GooglePerson[] = [];
  const seen = new Set<string>();
  let pageToken: string | undefined;
  while (true) {
    const params = new URLSearchParams({
      personFields: PERSON_FIELDS,
      pageSize: "1000",
      requestSyncToken: "true",
    });
    if (syncToken) params.set("syncToken", syncToken);
    if (pageToken) params.set("pageToken", pageToken);
    // getJson preserves the framework's 401/403/429/5xx errors. Inspect only the 400
    // body for Google's documented google.rpc.ErrorInfo reason; never match error text.
    const page = await getJson<GoogleConnectionsList>(
      ID,
      async (input, init) => {
        const response = await ctx.api(input, init);
        if (response.status === 400) {
          const body = (await response
            .clone()
            .json()
            .catch(() => undefined)) as { error?: { details?: { reason?: string }[] } } | undefined;
          const details = body?.error?.details;
          if (
            Array.isArray(details) &&
            details.some((detail) => detail?.reason === "EXPIRED_SYNC_TOKEN")
          )
            throw new ExpiredSyncToken(ID, "Google Contacts sync token expired.", {
              status: 400,
              url: PEOPLE_API,
            });
        }
        return response;
      },
      `${PEOPLE_API}?${params}`,
    );
    if (
      !page ||
      typeof page !== "object" ||
      Array.isArray(page) ||
      (page.connections !== undefined && !Array.isArray(page.connections)) ||
      (page.nextPageToken !== undefined && typeof page.nextPageToken !== "string")
    )
      throw new IntegrationSyncError(ID, "Google Contacts returned an invalid connections page.");
    people.push(...(page.connections ?? []));
    if (!page.nextPageToken) {
      if (typeof page.nextSyncToken !== "string" || !page.nextSyncToken.trim())
        throw new IntegrationSyncError(ID, "Google Contacts did not return a final sync token.");
      return { people, cursor: page.nextSyncToken };
    }
    if (seen.has(page.nextPageToken))
      throw new IntegrationSyncError(ID, "Google Contacts repeated a page token.");
    seen.add(page.nextPageToken);
    pageToken = page.nextPageToken;
  }
}
