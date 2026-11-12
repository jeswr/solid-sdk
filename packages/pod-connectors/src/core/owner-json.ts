// AUTHORED-BY Codex GPT-6.1-Sol
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
/** WAC protection before content, scoped redirects refused, strong validators, bounded JSON. */
export function createOwnerJsonStore<T>(o: OwnerJsonOptions<T>) {
  if (typeof o.fetch !== "function") throw new Error("A private resource transport is required");
  const url = assertWithinPodScope(o.root, o.url, { allowRoot: false });
  const owner = new URL(o.webId);
  if (owner.protocol !== "https:" || owner.username || owner.password)
    throw new Error("Invalid owner");
  const safe = refuseRedirects(o.fetch);
  const io: typeof fetch = (input, init) => {
    o.signal?.throwIfAborted();
    return safe(input, { ...init, signal: o.signal });
  };
  let etag: string | undefined;
  let loaded = false;
  let exists = false;
  return {
    url,
    async read(): Promise<T | undefined> {
      loaded = false;
      const head = await io(url, { method: "HEAD" });
      if (!head.ok && head.status !== 404) throw new Error("Private resource discovery failed");
      const header = head.headers.get("link") ?? "";
      if (header.length > 16_384) throw new Error("ACL discovery exceeds bounds");
      const links = [...header.matchAll(/<([^<>]+)>([^,]*)/g)].filter((link) => {
        const rel = /;\s*rel\s*=\s*(?:"([^"]*)"|([^;\s]*))/.exec(link[2] as string);
        return (rel?.[1] ?? rel?.[2] ?? "").split(/\s+/).includes("acl");
      });
      if (links.length !== 1) throw new Error("No unambiguous WAC ACL link");
      const aclUrl = assertWithinPodScope(o.root, new URL(links[0]?.[1] as string, url).href, {
        allowRoot: false,
      });
      if (aclUrl === url || new URL(aclUrl).hash || new URL(aclUrl).search)
        throw new Error("Invalid ACL target");
      const dataset = new Store();
      const rule = new OwnerAuthorization(
        DataFactory.namedNode(`${aclUrl}#owner`),
        dataset,
        DataFactory,
      );
      rule.type.add(`${ACL}Authorization`);
      rule.accessTo = url;
      rule.agents.add(owner.href);
      rule.canRead = true;
      rule.canWrite = true;
      rule.canReadWriteAcl = true;
      await writeResource(aclUrl, dataset, { fetchImpl: io });
      const response = await io(url, { headers: { accept: "application/json" } });
      if (response.status === 404) {
        exists = false;
        etag = undefined;
        loaded = true;
        return undefined;
      }
      const validator = response.headers.get("etag");
      if (
        !response.ok ||
        !validator ||
        validator.length > 1_024 ||
        !/^"[^"\r\n]*"$/.test(validator)
      )
        throw new Error("Cannot read private resource safely");
      const result = o.parse(await readJson(response, "state", url, o.maxBytes ?? 1_048_576));
      etag = validator;
      exists = true;
      loaded = true;
      return result;
    },
    async write(value: T): Promise<void> {
      if (!loaded) throw new Error("Read before writing private resource");
      const body = JSON.stringify(o.parse(value));
      if (new TextEncoder().encode(body).byteLength > (o.maxBytes ?? 1_048_576))
        throw new Error("Private resource exceeds bounds");
      const headers = new Headers({ "content-type": "application/json" });
      if (exists) headers.set("if-match", etag as string);
      else headers.set("if-none-match", "*");
      loaded = false;
      const response = await io(url, { method: "PUT", headers, body });
      if (response.status === 412) throw new StateConflictError();
      if (!response.ok) throw new Error("Private resource write failed");
    },
  };
}
