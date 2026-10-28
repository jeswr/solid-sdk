// AUTHORED-BY Codex

import { fetchRdf, RdfFetchError } from "@jeswr/fetch-rdf";
import { assertWithinPodScope } from "@jeswr/guarded-fetch";
import { safeHttpIri, serialize } from "@jeswr/rdf-serialize";
import type { Term } from "@rdfjs/types";
import { DatasetWrapper, NamedNodeAs, NamedNodeFrom, SetFrom } from "@rdfjs/wrapper";
import { AccessControlResource, AclResource, Authorization } from "@solid/object";
import { DataFactory, Store } from "n3";
import { relocate, sameGraph } from "./rdf";

const ACL = "http://www.w3.org/ns/auth/acl#";
const ACP_NS = "http://www.w3.org/ns/solid/acp#";
const ACP = `${ACP_NS}accessControl`;
export class DriveAccessError extends Error {
  readonly kind = "private-access-unavailable";
  constructor(override readonly cause?: unknown) {
    super(
      "Private access could not be established or verified. Drive stopped the transfer. You can choose Delete forever instead.",
    );
  }
}
class WritableAuthorization extends Authorization {
  values(predicate: string) {
    return SetFrom.subjectPredicate(this, predicate, NamedNodeAs.string, NamedNodeFrom.string);
  }
}
class PolicyDocument extends DatasetWrapper {
  get isAcp(): boolean {
    return (
      [
        ...this.instancesOf(`${ACP_NS}AccessControlResource`, AccessControlResource),
        ...this.subjectsOf(`${ACP_NS}accessControl`, AccessControlResource),
        ...this.subjectsOf(`${ACP_NS}memberAccessControl`, AccessControlResource),
      ].length > 0
    );
  }
}
export function privateAcl(resource: string, webId: string): Store {
  const owner = safeHttpIri(webId);
  if (!owner) throw new DriveAccessError();
  const dataset = new Store();
  const rule = new WritableAuthorization(DataFactory.blankNode(), dataset, DataFactory);
  rule.type.add(`${ACL}Authorization`);
  rule.accessTo = resource;
  if (resource.endsWith("/")) rule.default = resource;
  rule.agent.add(owner);
  rule.canRead = true;
  rule.canWrite = true;
  rule.canReadWriteAcl = true;
  return dataset;
}
export interface OwnAccess {
  url: string;
  dataset: Store;
  etag: string;
}

export function accessControl(http: typeof globalThis.fetch, storageUrl: string) {
  function discover(resource: string, headers: Headers): string | undefined {
    // This explicit fixture capability never substitutes for discovery on a real pod.
    if (headers.get("x-solid-demo-access-control") === "none") return undefined;
    const links = headers.get("link") ?? "";
    let acl: string | undefined;
    for (const match of links.matchAll(/<([^>]*)>\s*((?:;\s*[^,]*)*)/g)) {
      const params = match[2] as string;
      if (/;\s*anchor\s*=/i.test(params)) continue;
      const rel = /;\s*rel\s*=\s*(?:"([^"]*)"|([^;\s]+))/i.exec(params);
      const relations = (rel?.[1] ?? rel?.[2] ?? "").split(/\s+/);
      if (relations.includes(ACP))
        throw new DriveAccessError("ACP privacy cannot be verified by this adapter");
      if (relations.includes("acl"))
        acl = assertWithinPodScope(storageUrl, new URL(match[1] as string, resource).href);
    }
    return acl;
  }
  const read = async (url: string): Promise<OwnAccess | undefined> => {
    try {
      const result = await fetchRdf(url, { fetch: http });
      if (!result.etag || result.etag.startsWith("W/"))
        throw new DriveAccessError("Missing policy validator");
      // Some ACP deployments advertise their ACR using the legacy rel="acl".
      // Never PUT a WAC document to an ACP endpoint just because it echoes RDF.
      if (new PolicyDocument(result.dataset, DataFactory).isAcp)
        throw new DriveAccessError("ACP privacy cannot be verified by this adapter");
      // Validate the known authorization model through its typed reader.
      for (const rule of new AclResource(result.dataset, DataFactory).authorizations) {
        const typed = new WritableAuthorization(rule as Term, result.dataset, DataFactory);
        for (const predicate of [
          "accessTo",
          "default",
          "defaultForNew",
          "agent",
          "agentClass",
          "mode",
          "origin",
        ])
          typed.values(`${ACL}${predicate}`);
      }
      return { url, dataset: result.dataset, etag: result.etag };
    } catch (error) {
      if (error instanceof RdfFetchError && error.status === 404) return undefined;
      throw new DriveAccessError(error);
    }
  };
  const store = async (url: string, dataset: Store): Promise<OwnAccess> => {
    const current = await read(url);
    const response = await http(url, {
      method: "PUT",
      headers: {
        "content-type": "text/turtle",
        ...(current ? { "if-match": current.etag } : { "if-none-match": "*" }),
      },
      body: await serialize([...dataset]),
    });
    if (!response.ok) throw new DriveAccessError(response.status);
    const saved = await read(url);
    if (!saved || !sameGraph(dataset, saved.dataset))
      throw new DriveAccessError("Policy verification failed");
    return saved;
  };
  return {
    discover,
    read,
    store,
    async snapshot(resource: string, headers: Headers): Promise<OwnAccess | undefined> {
      const url = discover(resource, headers);
      return url ? read(url) : undefined;
    },
    async install(source: OwnAccess, from: string, to: string): Promise<OwnAccess> {
      const response = await http(to, { method: "HEAD" });
      const url = discover(to, response.headers);
      if (!url) throw new DriveAccessError("Destination has no ACL support");
      return store(
        url,
        relocate(source.dataset, [
          [source.url, url],
          [from, to],
        ]),
      );
    },
    async privateFolder(url: string, webId?: string): Promise<void> {
      try {
        const response = await http(url, { method: "HEAD" });
        if (!response.ok) throw new DriveAccessError(response.status);
        if (response.headers.get("x-solid-demo-access-control") === "none") return;
        const acl = discover(url, response.headers);
        if (!acl || !webId) throw new DriveAccessError();
        await store(acl, privateAcl(url, webId));
      } catch (error) {
        throw new DriveAccessError(error);
      }
    },
  };
}
