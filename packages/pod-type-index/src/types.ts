// AUTHORED-BY Codex GPT-6.1-Sol
import type { Features } from "@jeswr/storage-capabilities";
import type { CreateOptions, StorageClient } from "@jeswr/storage-client";

/** Exactly one location is required for registration and unregistration. */
export interface TypeLocation {
  container?: string;
  instance?: string;
}

/** Solid defaults to the private index. */
export interface RegistrationOptions {
  index?: "private" | "public";
}

/** Spread into storage.create options to declare an LWS resource's class. */
export interface TypeHint {
  links: NonNullable<CreateOptions["links"]>;
}

/** Inputs belong to one selected storage/account. */
export interface TypeIndexOptions {
  storage: StorageClient;
  features: Features;
  profile: string;
  /**
   * The same guarded authenticated transport used by storage. Required only for LWS QUERY,
   * which StorageClient does not expose. There is no global-fetch fallback.
   */
  fetch?: typeof fetch;
}

/** Discovery hints do not grant access to the returned resources. */
export interface TypeIndex {
  /** Both instances and instance containers, de-duplicated. */
  find(classIri: string): Promise<string[]>;
  /** One read of each Solid document, or one batched LWS query plus its pages. */
  findAll(classes: string[]): Promise<Map<string, string[]>>;
  /** Idempotent Solid registration; LWS returns a creation hint without I/O. */
  register(
    classIri: string,
    location: TypeLocation,
    options?: RegistrationOptions,
  ): Promise<TypeHint | undefined>;
  /** Remove this exact registration on Solid; no-op on server-managed LWS. */
  unregister(
    classIri: string,
    location: TypeLocation,
    options?: RegistrationOptions,
  ): Promise<void>;
  /** Enumerate server-advertised types through LWS TypeIndexService. */
  listClasses(): Promise<string[]>;
}
