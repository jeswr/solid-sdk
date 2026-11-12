// AUTHORED-BY Codex GPT-6.1-Sol
import { RdfFetchError } from "@jeswr/fetch-rdf";
import { assertWithinPodScope, createPodScopedFetch } from "@jeswr/guarded-fetch";
import { NS } from "@jeswr/suite-vocab";
import { LiteralAs, NamedNodeAs, NamedNodeFrom, OptionalFrom, SetFrom } from "@rdfjs/wrapper";
import { Authorization, Container, Resource } from "@solid/object";
import { DataFactory, Store } from "n3";
import { freshRdf } from "../../pod/rdf-read.js";
import { writeResource } from "../../pod/resource.js";
import { abortableFetch } from "../abort.js";
import { createFetchPodWriter, type FetchPodWriterOptions } from "../pod-writer.js";
import { datasetBytes } from "./hash.js";
import type { SyncPodWriter } from "./types.js";

class OwnerAuthorization extends Authorization {
  get agents(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      `${NS.ACL}agent`,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }
}
class ListedResource extends Resource {
  get etag(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${NS.SOLID}etag`, LiteralAs.string);
  }
}

/** Fetch implementation of the sync host ports. Refuses absent/ambiguous WAC discovery. */
export function createFetchSyncPodWriter(options: FetchPodWriterOptions): SyncPodWriter {
  const base = createFetchPodWriter(options);
  const root = new URL(".", base.resolve("_provenance.ttl")).href;
  const transport = options.signal ? abortableFetch(options.fetch, options.signal) : options.fetch;
  const scoped = createPodScopedFetch(root, { fetch: transport, allowRoot: false });
  return {
    ...base,
    async ensureOwnerOnly(slug) {
      const url = base.resolve(slug);
      const head = await scoped(url, { method: "HEAD", redirect: "error" });
      if (!head.ok && head.status !== 404) throw new Error("Cannot discover sync ACL.");
      const header = head.headers.get("link") ?? "";
      if (header.length > 8192) throw new Error("Sync ACL discovery cap exceeded.");
      const links = [...header.matchAll(/<([^<>]+)>([^,]*)/g)].filter((link) => {
        const rel = /;\s*rel\s*=\s*(?:"([^"]*)"|([^;\s]*))/.exec(link[2] as string);
        return (rel?.[1] ?? rel?.[2] ?? "").split(/\s+/).includes("acl");
      });
      if (links.length !== 1)
        throw new Error("Sync requires an advertised owner-controlled WAC ACL.");
      const aclUrl = assertWithinPodScope(root, new URL(links[0]?.[1] as string, url).href, {
        allowRoot: false,
      });
      const parsed = new URL(aclUrl);
      // Auxiliary must belong to this exact resource; never let an advertised link rewrite
      // another item's ACL or an ordinary data document. Unsupported layouts fail closed.
      if (parsed.search || parsed.hash || aclUrl !== `${url}.acl`)
        throw new Error("Invalid sync ACL target.");
      const dataset = new Store();
      const rule = new OwnerAuthorization(
        DataFactory.namedNode(`${aclUrl}#owner`),
        dataset,
        DataFactory,
      );
      rule.type.add(`${NS.ACL}Authorization`);
      rule.accessTo = url;
      rule.agents.add(options.webId);
      rule.canRead = true;
      rule.canWrite = true;
      rule.canReadWriteAcl = true;
      await writeResource(aclUrl, dataset, { fetchImpl: scoped });
    },
    async *list(container) {
      const url = base.resolve(container);
      if (!url.endsWith("/")) throw new Error("Sync listing requires a container.");
      let dataset: Store;
      try {
        const fetched = await freshRdf(url, scoped);
        dataset = fetched.dataset;
        datasetBytes(dataset);
        const link = fetched.headers.get("link") ?? "";
        // This port promises a complete direct-child scan. Pagination requires a
        // separate bounded implementation; never silently accept just one page.
        if (
          fetched.response.status !== 200 ||
          fetched.headers.has("content-range") ||
          link.length > 8192 ||
          [...link.matchAll(/;\s*rel\s*=\s*(?:"([^"]*)"|([^;\s,]*))/gi)].some((match) =>
            (match[1] ?? match[2] ?? "")
              .toLowerCase()
              .split(/\s+/)
              .some((rel) => ["first", "last", "prev", "next"].includes(rel)),
          ) ||
          new Resource(url, dataset, DataFactory).type.has(`${NS.LDP}Page`)
        )
          throw new Error("Sync requires a complete container listing.");
      } catch (error) {
        if (error instanceof RdfFetchError && error.status === 404) return;
        throw error;
      }
      for (const member of new Container(url, dataset, DataFactory).contains) {
        const resource = new ListedResource(member.id, dataset, DataFactory);
        yield { url: resource.id, etag: resource.etag };
      }
    },
  };
}
