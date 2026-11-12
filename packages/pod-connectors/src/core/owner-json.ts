// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { assertWithinPodScope, refuseRedirects } from "@jeswr/guarded-fetch";
import { NamedNodeAs, NamedNodeFrom, SetFrom } from "@rdfjs/wrapper";
import { Authorization } from "@solid/object";
import { DataFactory, Store } from "n3";
import { writeResource } from "../pod/resource.js";
import { readJson } from "./budget.js";
import { StateConflictError } from "./state.js";

const ACL = "http://www.w3.org/ns/auth/acl#";
class OwnerAuthorization extends Authorization {
  get agents(): Set<string> {
    return SetFrom.subjectPredicate(this, `${ACL}agent`, NamedNodeAs.string, NamedNodeFrom.string);
  }
}
export interface OwnerJsonOptions<T> {
  readonly root: string;
  readonly url: string;
  readonly webId: string;
  readonly fetch: typeof fetch;
  readonly parse: (value: unknown) => T;
  readonly maxBytes?: number;
  readonly signal?: AbortSignal;
}
function strongValidator(response: Response): string {
  const validator = response.headers.get("etag");
  if (!response.ok || !validator || validator.length > 1_024 || !/^"[^"\r\n]*"$/.test(validator))
    throw new Error("Cannot read private resource safely");
  return validator;
}
/**
 * WAC protection before content, scoped redirects refused, strong validators, bounded JSON.
 * The owner-only ACL is installed once per store instance (memoised after success) and again
 * before creating the resource; later reads never rewrite it. Reads are conditional on the
 * last validator and re-parse only when the resource changed. Per-call signals combine with
 * the store's signal. One instance serves one read→write sequence at a time.
 */
export function createOwnerJsonStore<T>(o: OwnerJsonOptions<T>) {
  if (typeof o.fetch !== "function") throw new Error("A private resource transport is required");
  const url = assertWithinPodScope(o.root, o.url, { allowRoot: false });
  const owner = new URL(o.webId);
  if (owner.protocol !== "https:" || owner.username || owner.password)
    throw new Error("Invalid owner");
  const maxBytes = o.maxBytes ?? 1_048_576;
  const safe = refuseRedirects(o.fetch);
  const io = (input: string, init: RequestInit, call?: AbortSignal) => {
    const signal = o.signal && call ? AbortSignal.any([o.signal, call]) : (call ?? o.signal);
    signal?.throwIfAborted();
    return safe(input, { ...init, signal });
  };
  let etag: string | undefined;
  let loaded = false;
  let exists = false;
  let aclUrl: string | undefined;
  let protectedOnce = false;
  let cached: { readonly etag: string; readonly value: T } | undefined;
  let revision = 0;
  async function discoverAcl(signal?: AbortSignal): Promise<string> {
    if (aclUrl) return aclUrl;
    const head = await io(url, { method: "HEAD" }, signal);
    await head.body?.cancel();
    if (!head.ok && head.status !== 404) throw new Error("Private resource discovery failed");
    const header = head.headers.get("link") ?? "";
    if (header.length > 16_384) throw new Error("ACL discovery exceeds bounds");
    const links = [...header.matchAll(/<([^<>]+)>([^,]*)/g)].filter((link) => {
      const rel = /;\s*rel\s*=\s*(?:"([^"]*)"|([^;\s]*))/.exec(link[2] as string);
      return (rel?.[1] ?? rel?.[2] ?? "").split(/\s+/).includes("acl");
    });
    if (links.length !== 1) throw new Error("No unambiguous WAC ACL link");
    const target = assertWithinPodScope(o.root, new URL(links[0]?.[1] as string, url).href, {
      allowRoot: false,
    });
    if (target === url || new URL(target).hash || new URL(target).search)
      throw new Error("Invalid ACL target");
    aclUrl = target;
    return target;
  }
  async function protect(signal?: AbortSignal): Promise<void> {
    const target = await discoverAcl(signal);
    const dataset = new Store();
    const rule = new OwnerAuthorization(
      DataFactory.namedNode(`${target}#owner`),
      dataset,
      DataFactory,
    );
    rule.type.add(`${ACL}Authorization`);
    rule.accessTo = url;
    rule.agents.add(owner.href);
    rule.canRead = true;
    rule.canWrite = true;
    rule.canReadWriteAcl = true;
    await writeResource(target, dataset, {
      fetchImpl: (input, init) => io(String(input), init ?? {}, signal),
    });
    protectedOnce = true;
  }
  return {
    url,
    /** Increments whenever a read observes new content or the resource's removal. */
    get revision(): number {
      return revision;
    },
    async read(signal?: AbortSignal): Promise<T | undefined> {
      loaded = false;
      if (!protectedOnce) await protect(signal);
      const headers = new Headers({ accept: "application/json" });
      if (cached) headers.set("if-none-match", cached.etag);
      const response = await io(url, { headers }, signal);
      if (response.status === 304 && cached) {
        await response.body?.cancel();
        etag = cached.etag;
        exists = true;
        loaded = true;
        return cached.value;
      }
      if (response.status === 404) {
        await response.body?.cancel();
        if (cached || exists) revision++;
        cached = undefined;
        exists = false;
        etag = undefined;
        loaded = true;
        return undefined;
      }
      let validator: string;
      try {
        validator = strongValidator(response);
      } catch (error) {
        await response.body?.cancel();
        throw error;
      }
      if (cached && cached.etag === validator) {
        // A server that ignores If-None-Match still returns the same strong validator.
        await response.body?.cancel();
        etag = validator;
        exists = true;
        loaded = true;
        return cached.value;
      }
      const result = o.parse(await readJson(response, "state", url, maxBytes));
      cached = { etag: validator, value: result };
      revision++;
      etag = validator;
      exists = true;
      loaded = true;
      return result;
    },
    /** Read-only: one bounded GET, no ACL, validator or cache side effects. */
    async peek(signal?: AbortSignal): Promise<T | undefined> {
      const response = await io(url, { headers: { accept: "application/json" } }, signal);
      if (response.status === 404) {
        await response.body?.cancel();
        return undefined;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error("Cannot read private resource safely");
      }
      return o.parse(await readJson(response, "state", url, maxBytes));
    },
    async write(value: T, signal?: AbortSignal): Promise<void> {
      if (!loaded) throw new Error("Read before writing private resource");
      const body = JSON.stringify(o.parse(value));
      if (new TextEncoder().encode(body).byteLength > maxBytes)
        throw new Error("Private resource exceeds bounds");
      const headers = new Headers({ "content-type": "application/json" });
      if (exists) headers.set("if-match", etag as string);
      else headers.set("if-none-match", "*");
      loaded = false;
      // Creation re-installs owner-only protection before any content exists.
      if (!exists) await protect(signal);
      cached = undefined;
      const response = await io(url, { method: "PUT", headers, body }, signal);
      await response.body?.cancel();
      if (response.status === 412) throw new StateConflictError();
      if (!response.ok) throw new Error("Private resource write failed");
    },
  };
}
