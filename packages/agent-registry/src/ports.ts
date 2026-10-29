// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import type { Store } from "n3";

/** Production supplies a persistent random salt from the daemon's private store. */
export interface SaltProvider {
  getSalt(): Promise<Uint8Array>;
}
/** Local-file seam: only the configured path is read. Must enforce the supplied byte bound. */
export interface RegistryReader {
  read(path: string, maxBytes: number): Promise<string>;
}
/** Access setter must replace grants, cover this resource only, and await persistence. */
export interface OwnerOnlyAcl {
  owner: string;
  public: false;
  modes: readonly ["Read", "Write", "Control"];
}
/** Minimal ADR-003 shaped storage seam until the SDK storage client lands. */
export interface StorageClient {
  /** Undefined means absent; permission/transport errors must reject, never masquerade as absent. */
  read(url: string): Promise<{ body: string; etag: string } | undefined>;
  /** Resolve only after an explicit owner-only ACL is persisted, before any content write. */
  setAcl(url: string, acl: OwnerOnlyAcl): Promise<void>;
  /** Conditional replacement, not append; a failed precondition must reject. */
  writeRdf(
    url: string,
    dataset: Store,
    options: { ifMatch?: string; ifNoneMatch?: "*" },
  ): Promise<void>;
}
