// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// Ported from Pod Manager's type-index(-write) typed registration/bootstrap pattern.
import { canonicalize, termsEqual } from "@jeswr/suite-vocab";
import { DatasetWrapper } from "@rdfjs/wrapper";
import { ModelError } from "./errors";
import type { RdfIO, Resource } from "./io";
import { DataFactory, documentUrl, Node, NS, node, Store } from "./rdf";
/**
 * Establish or verify effective owner-only ACL/ACP access, including inherited
 * policy. Return true only when access is confirmed; unsupported or unreadable
 * policy must fail closed. The callback uses the caller's scoped access client.
 */
export type PrivateIndexAccess = (url: string, owner: string) => Promise<boolean>;

export interface Registration {
  forClass: string;
  location: string;
  kind: "instance" | "instanceContainer";
}
class Index extends DatasetWrapper {
  get registrations(): Node[] {
    return [...this.instancesOf(`${NS.SOLID}TypeRegistration`, Node)];
  }
}
export class TypeIndex {
  constructor(
    private readonly io: RdfIO,
    private readonly storage: string,
    private readonly webId: string,
    private readonly ensurePrivateAccess?: PrivateIndexAccess,
  ) {}
  async locations(forClass: string): Promise<Registration[]> {
    const profile = await this.io.read(documentUrl(this.webId));
    const anchor = node(this.webId, profile.dataset);
    const urls = new Set([
      anchor.iri(`${NS.SOLID}privateTypeIndex`),
      anchor.iri(`${NS.SOLID}publicTypeIndex`),
    ]);
    const result: Registration[] = [];
    for (const url of urls) {
      if (!url) continue;
      const resource = await this.io.optional(url);
      if (!resource) continue;
      for (const reg of new Index(resource.dataset, DataFactory).registrations) {
        if (!termsEqual(reg.iri(`${NS.SOLID}forClass`) ?? "", forClass)) continue;
        for (const kind of ["instance", "instanceContainer"] as const) {
          for (const location of reg.iris(`${NS.SOLID}${kind}`))
            result.push({ forClass, kind, location });
        }
      }
    }
    return result;
  }
  private async privateIndex(): Promise<Resource> {
    if (!this.ensurePrivateAccess)
      throw new TypeError("A private Type Index ACL/ACP access verifier is required.");
    const profile = await this.io.read(documentUrl(this.webId));
    const anchor = node(this.webId, profile.dataset);
    const existing = anchor.iri(`${NS.SOLID}privateTypeIndex`);
    if (existing) {
      const resource = await this.io.read(existing);
      if (!(await this.ensurePrivateAccess(resource.url, this.webId)))
        throw new ModelError(403, resource.url);
      return this.io.read(resource.url);
    }
    const settings = new URL("settings/", this.storage).href;
    const url = new URL("privateTypeIndex.ttl", settings).href;
    await this.io.container(settings);
    const dataset = new Store();
    const value = node(url, dataset);
    value.types.add(`${NS.SOLID}TypeIndex`);
    value.types.add(`${NS.SOLID}UnlistedDocument`);
    try {
      await this.io.write(url, dataset, { create: true });
    } catch (error) {
      if (!(error instanceof ModelError && error.status === 412)) throw error;
    }
    const resource = await this.io.read(url);
    if (!(await this.ensurePrivateAccess(resource.url, this.webId)))
      throw new ModelError(403, resource.url);
    anchor.setIri(`${NS.SOLID}privateTypeIndex`, resource.url);
    await this.io.write(profile.url, profile.dataset, { etag: profile.etag });
    return this.io.read(resource.url);
  }
  /** Idempotent by (class, predicate, location). Re-read and merge on bounded 412 conflicts. */
  async register(registrations: readonly Registration[]): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try {
        const resource = await this.privateIndex();
        const index = new Index(resource.dataset, DataFactory);
        let changed = false;
        for (const desired of registrations) {
          if (
            index.registrations.some(
              (reg) =>
                termsEqual(reg.iri(`${NS.SOLID}forClass`) ?? "", desired.forClass) &&
                reg.iris(`${NS.SOLID}${desired.kind}`).has(desired.location),
            )
          )
            continue;
          // Full encoded tuple avoids hash collisions while leaving foreign subjects untouched.
          const id = `${resource.url}#tasks-${encodeURIComponent(`${desired.forClass}|${desired.kind}|${desired.location}`)}`;
          const reg = node(id, resource.dataset);
          reg.types.add(`${NS.SOLID}TypeRegistration`);
          reg.setIri(`${NS.SOLID}forClass`, canonicalize(desired.forClass));
          reg.setIri(`${NS.SOLID}${desired.kind}`, desired.location);
          changed = true;
        }
        if (changed) await this.io.write(resource.url, resource.dataset, { etag: resource.etag });
        return;
      } catch (error) {
        if (!(error instanceof ModelError && error.status === 412 && attempt < 2)) throw error;
      }
    }
  }
}
