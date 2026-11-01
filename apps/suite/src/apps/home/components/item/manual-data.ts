// AUTHORED-BY Codex GPT-6
import { RdfFetchError } from "@jeswr/fetch-rdf";
import { assertWithinPodScope } from "@jeswr/guarded-fetch";
import { NS } from "@jeswr/suite-vocab";
import { NamedNodeAs, NamedNodeFrom, OptionalAs, SetFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import type { FieldSpec } from "../../lib/forms/field-types";
import { applyFieldEdits } from "../../lib/forms/subject-edit";
import type { DataType } from "../../lib/model/domains";
import { inStorage, readResource, serializeTurtle, subjectOf } from "../../lib/model/rdf";
import { registrationsFrom } from "../../lib/model/type-index";
import { discardEmptyDocument, preparePrivateDocument, verifyPrivateDocument } from "./private-acl";

export interface ManualSession {
  storageUrl: string;
  webId: string;
  fetch: typeof fetch;
  /** Credential-free transport for a public profile hosted outside storage. */
  publicFetch?: typeof fetch;
}
class WritableNode extends TermWrapper {
  setIri(predicate: string, value: string) {
    OptionalAs.object(this, predicate, value, NamedNodeFrom.string);
  }
  type(value: string) {
    SetFrom.subjectPredicate(this, `${NS.RDF}type`, NamedNodeAs.string, NamedNodeFrom.string).add(
      value,
    );
  }
}
export function manualUrl(
  storage: string,
  type: DataType,
  title: string,
  id = crypto.randomUUID().slice(0, 8),
): string {
  if (!type.manualForm || !type.container)
    throw new Error("This data type can't be added manually");
  if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new Error("Invalid item identifier");
  const slug =
    title
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 64) || type.id;
  return assertWithinPodScope(storage, new URL(`${type.container}${slug}-${id}.ttl`, storage).href);
}

/**
 * Re-read and reapply a small graph change on 412, preserving all unrelated statements.
 * A private document that does not exist yet gets a verified owner-only ACL before its
 * content is written (ACL-first, or the empty-document fallback); if that or the
 * post-write check fails, nothing is left behind to link.
 */
async function update(
  session: ManualSession,
  url: string,
  edit: (dataset: Store) => boolean,
  privateDocument = false,
): Promise<void> {
  const target = assertWithinPodScope(session.storageUrl, url);
  for (let attempt = 0; attempt < 3; attempt++) {
    let dataset: Store;
    let etag: string | null = null;
    let missing = false;
    try {
      const read = await readResource(session.fetch, target);
      dataset = new Store([...read.dataset]);
      etag = read.etag;
    } catch (error) {
      if (!(error instanceof RdfFetchError && error.status === 404)) throw error;
      dataset = new Store();
      missing = true;
    }
    if (!edit(dataset)) return;
    if (!missing && !etag) throw new Error("Reload and try saving again");
    const prepared =
      privateDocument && missing ? await preparePrivateDocument(session, target) : undefined;
    // After the empty-document fallback, content replaces exactly that empty document.
    const condition = prepared?.etag
      ? { "if-match": prepared.etag }
      : missing
        ? { "if-none-match": "*" }
        : { "if-match": etag as string };
    const response = await session.fetch(target, {
      method: "PUT",
      redirect: "error",
      headers: { "content-type": "text/turtle", ...condition },
      body: await serializeTurtle(dataset),
    });
    if (response.ok) {
      if (prepared === undefined) return;
      try {
        await verifyPrivateDocument(session, target, prepared.acl);
        return;
      } catch (error) {
        await discardEmptyDocument(session, target, response.headers.get("etag"));
        throw error;
      }
    }
    // A failed first write leaves no empty placeholder behind. On 412 another writer
    // replaced it; the retry then reads and edits their version.
    if (prepared?.etag && response.status !== 412)
      await discardEmptyDocument(session, target, prepared.etag);
    if (response.status !== 412) throw new Error("Couldn't finish saving. Please try again.");
  }
  throw new Error("This item keeps changing. Please try again.");
}

/** Settings advertised by a profile must live in this storage before any authenticated I/O. */
function settingsInStorage(session: ManualSession, urls: readonly string[]): void {
  for (const url of urls)
    if (!inStorage(url, session.storageUrl))
      throw new Error(
        "Your profile keeps its settings somewhere else, so Home can't register this here. Skip registration to keep the item.",
      );
}

export async function registerManualType(
  session: ManualSession,
  classIri: string,
  container: string,
): Promise<void> {
  assertWithinPodScope(session.storageUrl, container);
  const profileUrl = session.webId.split("#")[0] as string;
  const internalProfile = inStorage(profileUrl, session.storageUrl);
  // A WebID hosted elsewhere is public: read it without credentials or redirects so
  // the storage's authenticated transport never reaches another host.
  const profileFetch: typeof fetch = internalProfile
    ? session.fetch
    : (input, init) =>
        (session.publicFetch ?? globalThis.fetch)(input, {
          ...init,
          credentials: "omit",
          redirect: "error",
        });
  const profile = (await readResource(profileFetch, profileUrl)).dataset;
  const person = subjectOf(profile, session.webId);
  const indexes = person.iris(`${NS.SOLID}privateTypeIndex`);
  const preferenceFiles = person.iris("http://www.w3.org/ns/pim/space#preferencesFile");
  settingsInStorage(session, [...indexes, ...preferenceFiles]);
  let index = indexes[0];
  const preferences = preferenceFiles[0];
  if (!index && preferences) {
    try {
      const prefs = await readResource(session.fetch, preferences);
      const linked = subjectOf(prefs.dataset, session.webId).iris(`${NS.SOLID}privateTypeIndex`);
      settingsInStorage(session, linked);
      index = linked[0];
    } catch (error) {
      if (!(error instanceof RdfFetchError && error.status === 404)) throw error;
    }
  }
  // Updating an external profile needs its own host's editor, never this storage's transport.
  if (!index && !preferences && !internalProfile)
    throw new Error(
      "Your profile doesn't link any settings in this storage yet. Skip registration to keep the item.",
    );
  const indexUrl = assertWithinPodScope(
    session.storageUrl,
    index ?? new URL("settings/privateTypeIndex.ttl", session.storageUrl).href,
  );
  await update(
    session,
    indexUrl,
    (dataset) => {
      if (
        registrationsFrom(dataset).some(
          (reg) => reg.forClass === classIri && reg.container === container,
        )
      )
        return false;
      const document = new WritableNode(indexUrl, dataset, DataFactory);
      document.type(`${NS.SOLID}TypeIndex`);
      document.type(`${NS.SOLID}UnlistedDocument`);
      const node = new WritableNode(
        `${indexUrl}#manual-${crypto.randomUUID()}`,
        dataset,
        DataFactory,
      );
      node.type(`${NS.SOLID}TypeRegistration`);
      node.setIri(`${NS.SOLID}forClass`, classIri);
      node.setIri(`${NS.SOLID}instanceContainer`, container);
      return true;
    },
    true,
  );
  if (!index) {
    const prefsUrl = preferences ?? new URL("settings/prefs.ttl", session.storageUrl).href;
    await update(
      session,
      prefsUrl,
      (dataset) => {
        const node = new WritableNode(session.webId, dataset, DataFactory);
        const existing = subjectOf(dataset, session.webId).iris(`${NS.SOLID}privateTypeIndex`);
        if (existing.includes(indexUrl)) return false;
        if (existing.length) throw new Error("Your settings changed. Try saving again.");
        node.setIri(`${NS.SOLID}privateTypeIndex`, indexUrl);
        return true;
      },
      true,
    );
    if (!preferences)
      await update(session, profileUrl, (dataset) => {
        const existing = subjectOf(dataset, session.webId).iris(
          "http://www.w3.org/ns/pim/space#preferencesFile",
        );
        if (existing.includes(prefsUrl)) return false;
        if (existing.length) throw new Error("Your settings changed. Try saving again.");
        new WritableNode(session.webId, dataset, DataFactory).setIri(
          "http://www.w3.org/ns/pim/space#preferencesFile",
          prefsUrl,
        );
        return true;
      });
  }
}

export async function createManualItem(
  session: ManualSession,
  type: DataType,
  url: string,
  template: import("@rdfjs/types").DatasetCore,
  fields: readonly FieldSpec[],
  values: Readonly<Record<string, string>>,
) {
  if (!type.manualForm || !type.container)
    throw new Error("This data type can't be added manually");
  const target = assertWithinPodScope(new URL(type.container, session.storageUrl).href, url);
  const dataset = applyFieldEdits(template, `${target}#it`, fields, values);
  const response = await session.fetch(target, {
    method: "PUT",
    redirect: "error",
    headers: { "content-type": "text/turtle", "if-none-match": "*" },
    body: await serializeTurtle(dataset),
  });
  if (!response.ok) throw new Error("Couldn't save this item. Please try again.");
  try {
    await registerManualType(
      session,
      type.manualForm,
      new URL(type.container, session.storageUrl).href,
    );
  } catch (error) {
    // A retry reuses this form's resource URL instead of silently making duplicates.
    throw new ManualRegistrationError(target, error);
  }
  return target;
}
export class ManualRegistrationError extends Error {
  constructor(
    readonly url: string,
    cause: unknown,
  ) {
    super("Your item was saved. Try again to finish adding it to Home.", { cause });
  }
}
