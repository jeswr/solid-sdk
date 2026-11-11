// AUTHORED-BY Codex GPT-6.1-Sol
import { DataFactory } from "@jeswr/rdf-engine";
import {
  type RdfReadResult,
  type StorageClient,
  StorageError,
  type WriteResult,
} from "@jeswr/storage-client";
import { ensureOwnerOnly } from "./access.js";
import { PreferencesError } from "./value.js";

export const CONFIGURATION = "http://www.w3.org/ns/pim/space#ConfigurationFile";
const PREFS = "http://www.w3.org/ns/pim/space#preferencesFile";
const SUITE = "https://jeswr.org/ns/suite/preferences";
const keyType = (key: string) => `${SUITE}/${encodeURIComponent(key)}`;

/** Structural subset of pod-type-index's public interface; no new runtime dependency. */
export interface PreferencesTypeIndex {
  find(iri: string): Promise<string[]>;
  register(
    iri: string,
    location: { container: string },
  ): Promise<{ links: readonly { rel: string; target: string }[] } | undefined>;
}
export interface PreferencesOptions {
  storage: StorageClient;
  typeIndex: PreferencesTypeIndex;
  webId: string;
  /** Already parsed owner profile, useful when the WebID is outside this storage. */
  profile?: RdfReadResult;
  /** Idempotent owner-only provisioning/verification for ACP or LWS. WAC has a local default. */
  ensureOwnerOnly?: (url: string, signal: AbortSignal) => Promise<void>;
}

export function createRemote(options: PreferencesOptions, signal: AbortSignal) {
  const { storage, typeIndex, webId } = options;
  let location: Promise<string> | undefined;
  const files = new Map<string, { url: string; etag: string | null }>();
  function active() {
    if (signal.aborted) throw new PreferencesError("session-changed");
  }
  function scoped(url: string): string {
    const parsed = new URL(url);
    if (
      !storage.isWithinStorage(url) ||
      parsed.search ||
      parsed.hash ||
      parsed.username ||
      parsed.password
    )
      throw new PreferencesError("unsafe-location");
    return url;
  }
  const is = (error: unknown, code: string) => error instanceof StorageError && error.code === code;
  async function find(parent: string, name: string, kind: "container" | "resource", type: string) {
    active();
    if (storage.protocol === "solid") {
      const url = scoped(
        new URL(`${encodeURIComponent(name)}${kind === "container" ? "/" : ""}`, parent).href,
      );
      try {
        const result = await storage.head(url, { signal });
        if (result.kind !== kind) throw new PreferencesError("unsafe-location");
        return url;
      } catch (error) {
        if (!is(error, "not-found")) throw error;
        return undefined;
      }
    }
    const found: string[] = [];
    for await (const item of storage.listAll(parent, { signal })) {
      if (item.kind === kind && item.types.includes(type)) found.push(scoped(item.url));
    }
    if (found.length > 1) throw new PreferencesError("unsafe-location");
    return found[0];
  }
  async function container(
    parent: string,
    name: string,
    type: string,
    links: readonly { rel: string; target: string }[] = [],
  ) {
    const existing = await find(parent, name, "container", type);
    active();
    if (existing) return existing;
    try {
      const result = await storage.create(parent, null, {
        kind: "container",
        name,
        links: [{ rel: "type", target: type }, ...links],
        signal,
      });
      active();
      return scoped(result.url);
    } catch (error) {
      if (!is(error, "conflict")) throw error;
      return (await find(parent, name, "container", type)) ?? Promise.reject(error);
    }
  }
  async function readProfile() {
    if (options.profile) return options.profile;
    try {
      return await storage.readRdf(webId.split("#")[0] as string, { signal });
    } catch (error) {
      if (storage.protocol === "lws" && (is(error, "not-rdf") || is(error, "not-found")))
        return undefined;
      throw error;
    }
  }
  async function resolve() {
    active();
    let prefs: string | undefined;
    const profile = await readProfile();
    active();
    if (profile) {
      // Small read-only pointer accessor: no public profile reader is exposed by capabilities.
      const pointers = [
        ...profile.dataset.match(DataFactory.namedNode(webId), DataFactory.namedNode(PREFS)),
      ];
      const [pointer] = pointers;
      if (pointers.length > 1 || (pointer && pointer.object.termType !== "NamedNode"))
        throw new PreferencesError("unsafe-location");
      if (pointer) prefs = scoped(new URL(".", scoped(pointer.object.value)).href);
    }
    if (!prefs) {
      const registered = await typeIndex.find(CONFIGURATION);
      active();
      if (registered.length > 1) throw new PreferencesError("unsafe-location");
      prefs = registered[0] && scoped(registered[0]);
      if (!prefs) {
        const hint =
          storage.protocol === "lws"
            ? await typeIndex.register(CONFIGURATION, { container: storage.root })
            : undefined;
        active();
        prefs = await container(storage.root, "settings", CONFIGURATION, hint?.links);
        active();
        await typeIndex.register(CONFIGURATION, { container: prefs });
      }
    }
    active();
    const suite = await container(prefs, "suite", SUITE);
    active();
    await (options.ensureOwnerOnly
      ? options.ensureOwnerOnly(suite, signal)
      : ensureOwnerOnly(storage, suite, webId, signal));
    active();
    return suite;
  }
  function suite() {
    active();
    location ??= resolve().catch((error) => {
      location = undefined;
      throw error;
    });
    return location;
  }
  async function read(key: string): Promise<string | undefined> {
    const parent = await suite();
    const url = await find(parent, `${key}.json`, "resource", keyType(key));
    active();
    if (!url) {
      files.delete(key);
      return undefined;
    }
    const result = await storage.read(url, { accept: "application/json", signal });
    active();
    files.set(key, { url, etag: result.etag });
    return result.text();
  }
  async function put(key: string, json: string): Promise<void> {
    const parent = await suite();
    for (let attempt = 0; ; attempt++) {
      active();
      if (!files.get(key)?.etag) await read(key);
      active();
      const file = files.get(key);
      if (file && !file.etag) throw new PreferencesError("missing-etag");
      try {
        const result: WriteResult = file
          ? await storage.write(file.url, json, {
              ifMatch: file.etag as string,
              contentType: "application/json",
              signal,
            })
          : await storage.create(parent, json, {
              name: `${key}.json`,
              contentType: "application/json",
              links: [{ rel: "type", target: keyType(key) }],
              signal,
            });
        active();
        files.set(key, { url: scoped(result.url), etag: result.etag });
        return;
      } catch (error) {
        if (attempt !== 0 || (!is(error, "precondition-failed") && !is(error, "conflict")))
          throw error;
        await read(key); // Whole-value LWW: retain the local JSON, replace only the validator.
      }
    }
  }
  return { read, put, invalidate: (key: string) => files.delete(key) };
}
