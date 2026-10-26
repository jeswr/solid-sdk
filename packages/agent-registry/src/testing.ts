// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { Store } from "n3";
import type { OwnerOnlyAcl, RegistryReader, SaltProvider, StorageClient } from "./ports.js";
import { accountTurtle } from "./rdf.js";

/** In-memory storage enforces ACL ordering and conditional writes; never contacts a pod. */
export class MemoryStorageClient implements StorageClient {
  readonly resources = new Map<string, { body: string; etag: string; dataset: Store }>();
  readonly acls = new Map<string, OwnerOnlyAcl>();
  readonly events: { operation: "acl" | "read" | "write"; url: string }[] = [];
  private revision = 0;
  async read(url: string) {
    this.events.push({ operation: "read", url });
    const item = this.resources.get(url);
    return item ? { body: item.body, etag: item.etag } : undefined;
  }
  async setAcl(url: string, acl: OwnerOnlyAcl): Promise<void> {
    if (acl.public !== false || acl.modes.join(",") !== "Read,Write,Control" || !acl.owner)
      throw new Error("Owner-only ACL required");
    this.events.push({ operation: "acl", url });
    this.acls.set(url, structuredClone(acl));
  }
  async writeRdf(
    url: string,
    dataset: Store,
    options: { ifMatch?: string; ifNoneMatch?: "*" },
  ): Promise<void> {
    if (!this.acls.has(url)) throw new Error("ACL required before content");
    const current = this.resources.get(url);
    if (current ? options.ifMatch !== current.etag : options.ifNoneMatch !== "*")
      throw new Error("Precondition failed");
    this.resources.set(url, {
      body: await accountTurtle(dataset),
      etag: `"${++this.revision}"`,
      dataset: new Store([...dataset]),
    });
    this.events.push({ operation: "write", url });
  }
}
/** Deterministic injected test salt; production must persist an independent random salt. */
export class FixedSaltProvider implements SaltProvider {
  constructor(private readonly value: Uint8Array = new Uint8Array(32).fill(7)) {}
  async getSalt(): Promise<Uint8Array> {
    return this.value.slice();
  }
}
/** Configured-path assertion prevents tests from accidentally reading a live registry. */
export class MemoryRegistryReader implements RegistryReader {
  constructor(
    private readonly path: string,
    private readonly content: string,
  ) {}
  async read(path: string, maxBytes: number): Promise<string> {
    if (path !== this.path || new TextEncoder().encode(this.content).byteLength > maxBytes)
      throw new Error("Fixture registry unavailable");
    return this.content;
  }
}
