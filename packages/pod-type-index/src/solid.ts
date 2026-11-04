// AUTHORED-BY Codex GPT-6.1-Sol
import type { RdfReadResult, StorageClient } from "@jeswr/storage-client";
import { StorageError } from "@jeswr/storage-client";
import { canonicalize, NS } from "@jeswr/suite-vocab";
import { DataFactory } from "n3";
import { documentUrl, error, requireScoped, scoped } from "./common.js";
import type { Resource } from "./rdf.js";
import {
  CLASS,
  CONTAINER,
  emptyDocument,
  INDEX,
  INSTANCE,
  indexDataset,
  PREFS,
  PRIVATE,
  PUBLIC,
  REGISTRATION,
  resource,
  serialize,
  TYPE,
} from "./rdf.js";

const MAX_DOCUMENTS = 64;
const MAX_RESULTS = 10_000;

function missing(cause: unknown): boolean {
  return cause instanceof StorageError && cause.code === "not-found" && cause.status === 404;
}

/** Request-local memoisation: shared pointers and multiple requested classes never re-fetch. */
function reader(storage: StorageClient, signal: AbortSignal) {
  const cache = new Map<string, Promise<RdfReadResult | undefined>>();
  return (url: string) => {
    const key = documentUrl(requireScoped(storage, url));
    let pending = cache.get(key);
    if (!pending) {
      if (cache.size >= MAX_DOCUMENTS) throw error("invalid-response", storage.root);
      pending = storage.readRdf(key, { signal }).catch((cause) => {
        if (missing(cause)) return undefined;
        throw cause;
      });
      cache.set(key, pending);
    }
    return pending;
  };
}

function rawCount(subject: Resource, predicate: string): number {
  return subject.dataset.match(
    subject.node,
    DataFactory.namedNode(predicate),
    undefined,
    DataFactory.defaultGraph(),
  ).size;
}

export function solidIndex(storage: StorageClient, webId: string) {
  const profile = requireScoped(storage, webId);
  const profileUrl = documentUrl(profile);

  function links(subject: Resource, predicate: string, strict = false): string[] {
    const values = subject.iris(predicate);
    const urls = values.map((value) => scoped(storage, value));
    if (
      strict &&
      (urls.some((value) => !value) || values.length !== rawCount(subject, predicate))
    ) {
      throw error("scope", storage.root);
    }
    return [
      ...new Set(urls.filter((value): value is string => value !== undefined).map(documentUrl)),
    ];
  }

  async function discovery(read: ReturnType<typeof reader>) {
    const card = await read(profileUrl);
    if (!card) throw error("not-found", profileUrl);
    const owner = resource(card, profile);
    const indexes = new Set(links(owner, PRIVATE));
    for (const url of links(owner, PREFS)) {
      const preferences = await read(url);
      if (preferences)
        for (const index of links(resource(preferences, profile), PRIVATE)) indexes.add(index);
    }
    for (const index of links(owner, PUBLIC)) indexes.add(index);
    return { indexes };
  }

  async function findAll(classes: string[]): Promise<Map<string, string[]>> {
    const output = new Map(classes.map((iri) => [iri, [] as string[]]));
    if (output.size === 0) return output;
    const wanted = new Map<string, Set<string>>();
    for (const iri of classes) wanted.set(canonicalize(iri), new Set());
    const read = reader(storage, AbortSignal.timeout(30_000));
    const { indexes } = await discovery(read);
    let count = 0;
    for (const url of indexes) {
      const document = await read(url);
      if (!document) continue;
      for (const reg of indexDataset(document).registrations) {
        for (const iri of reg.iris(CLASS)) {
          const targets = wanted.get(canonicalize(iri));
          if (!targets) continue;
          for (const value of [...reg.iris(INSTANCE), ...reg.iris(CONTAINER)]) {
            const target = scoped(storage, value);
            if (target && !targets.has(target)) {
              if (++count > MAX_RESULTS) throw error("invalid-response", storage.root);
              targets.add(target);
            }
          }
        }
      }
    }
    for (const iri of output.keys())
      output.set(iri, [...(wanted.get(canonicalize(iri)) as Set<string>)]);
    return output;
  }

  async function save(document: RdfReadResult, fresh: boolean, signal: AbortSignal) {
    if (new URL(document.url).search) throw error("bad-request", storage.root, "PUT");
    if (!fresh) {
      if (!document.etag || !/^"[\x21\x23-\x7E\x80-\xFF]*"$/.test(document.etag)) {
        throw error("precondition-required", document.url, "PUT");
      }
      await storage.writeRdf(document.url, document.dataset, {
        ifMatch: document.etag,
        contentType: "text/turtle",
        signal,
      });
      return;
    }
    const access = (await storage.head(storage.root, { signal })).allow;
    if (!access?.write || !access.control) throw error("forbidden", storage.root, "PUT");
    const parent = new URL(".", document.url).href;
    try {
      await storage.head(parent, { signal });
    } catch (cause) {
      if (!missing(cause)) throw cause;
      // Only the conventional settings directory is bootstrapped; arbitrary linked parents
      // are never created implicitly.
      if (parent !== new URL("settings/", storage.root).href) throw cause;
      await storage.create(storage.root, null, { kind: "container", name: "settings", signal });
    }
    await storage.create(parent, await serialize(document), {
      name: decodeURIComponent(new URL(document.url).pathname.split("/").at(-1) as string),
      contentType: "text/turtle",
      signal,
    });
  }

  function single(urls: string[]): string | undefined {
    if (urls.length > 1) throw error("conflict", storage.root);
    return urls[0];
  }

  async function mutate(
    iri: string,
    target: string,
    container: boolean,
    visibility: "private" | "public",
    remove: boolean,
  ) {
    const signal = AbortSignal.timeout(30_000);
    for (let attempt = 0; ; attempt++) {
      try {
        const read = reader(storage, signal);
        const card = await read(profileUrl);
        if (!card) throw error("not-found", profileUrl);
        const owner = resource(card, profile);
        const predicate = visibility === "public" ? PUBLIC : PRIVATE;
        let host = card;
        let hostFresh = false;
        let preferencesUrl: string | undefined;
        // Read old private links on profiles for compatibility; new links live in preferences.
        let url = single(links(owner, predicate, true));
        if (remove && visibility === "private" && url) {
          const linkedPreferences = single(links(owner, PREFS, true));
          const preferences = linkedPreferences ? await read(linkedPreferences) : undefined;
          // Refuse to remove from only one of two distinct private destinations.
          if (preferences)
            single([...new Set([url, ...links(resource(preferences, profile), PRIVATE, true)])]);
        }
        if (!url && visibility === "private") {
          preferencesUrl = single(links(owner, PREFS, true));
          if (!preferencesUrl && remove) return;
          preferencesUrl ??= new URL("settings/prefs.ttl", storage.root).href;
          const preferences = await read(preferencesUrl);
          if (!preferences && remove) return;
          hostFresh = preferences === undefined;
          host = preferences ?? emptyDocument(preferencesUrl);
          url = single(links(resource(host, profile), PRIVATE, true));
        }
        if (!url && remove) return;
        const linked = url !== undefined;
        url ??= new URL(`settings/${visibility}TypeIndex.ttl`, storage.root).href;
        const existing = await read(url);
        if (!existing && remove) return;
        const document = existing ?? emptyDocument(url);
        const docSubject = resource(document, url);
        if (existing && !linked && !docSubject.iris(TYPE).includes(INDEX)) {
          throw error("conflict", url);
        }
        // Turtle writes must not collapse foreign named graphs into the default graph.
        for (const quad of document.dataset)
          if (quad.graph.termType !== "DefaultGraph") throw error("not-rdf", url);
        const locationPredicate = container ? CONTAINER : INSTANCE;
        const matching = [...indexDataset(document).registrations].filter(
          (reg) =>
            reg.iris(CLASS).some((value) => canonicalize(value) === iri) &&
            reg.iris(locationPredicate).some((value) => scoped(storage, value) === target),
        );
        let changed = false;
        if (remove) {
          for (const reg of matching) {
            if (
              rawCount(reg, CLASS) !== 1 ||
              rawCount(reg, INSTANCE) + rawCount(reg, CONTAINER) !== 1
            ) {
              throw error("conflict", url);
            }
            // Delete only the registration contract; preserve third-party annotations.
            reg.values(locationPredicate).delete(reg.iris(locationPredicate)[0] as string);
            reg.values(CLASS).delete(reg.iris(CLASS)[0] as string);
            reg.values(TYPE).delete(REGISTRATION);
            changed = true;
          }
        } else if (matching.length === 0) {
          let subject: string;
          do {
            subject = `${url}#registration-${crypto.randomUUID()}`;
          } while (document.dataset.match(DataFactory.namedNode(subject)).size > 0);
          const reg = resource(document, subject);
          reg.values(TYPE).add(REGISTRATION);
          reg.values(CLASS).add(iri);
          reg.values(locationPredicate).add(target);
          changed = true;
        }
        if (!existing) {
          docSubject.values(TYPE).add(INDEX);
          docSubject
            .values(TYPE)
            .add(`${NS.SOLID}${visibility === "public" ? "ListedDocument" : "UnlistedDocument"}`);
        }
        if (changed) await save(document, !existing, signal);
        if (remove) return;
        const hostOwner = resource(host, profile);
        if (!links(hostOwner, predicate, true).includes(url)) {
          hostOwner.values(predicate).add(url);
          await save(host, hostFresh, signal);
        }
        if (preferencesUrl && !links(owner, PREFS, true).includes(preferencesUrl)) {
          owner.values(PREFS).add(preferencesUrl);
          await save(card, false, signal);
        }
        return;
      } catch (cause) {
        const retry =
          cause instanceof StorageError &&
          (cause.code === "precondition-failed" || cause.code === "conflict");
        if (!retry || attempt >= 2) throw cause;
      }
    }
  }

  return { findAll, mutate };
}
