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

/**
 * Which document or service asserted a registration. This is provenance only, never authorization.
 * - `"private"`: a Solid index linked by `solid:privateTypeIndex` (from the preferences document, or
 *   directly from the profile by older clients). Unlisted, NOT access-controlled by this package.
 * - `"public"`: a Solid index linked by `solid:publicTypeIndex` from the profile.
 * - `"lws-search"`: the LWS TypeSearchService. The server asserts the resource's types; it makes no
 *   private/public distinction, so this value says nothing about visibility.
 */
export type TypeSource = "private" | "public" | "lws-search";

/** Restrict discovery. Excluded documents and services are never requested. */
export interface FindOptions {
  /** Default: every source. `[]` returns nothing without any request. Unknown values throw. */
  sources?: readonly TypeSource[];
}

/** One registration location and the source that asserted it. */
export interface FoundRegistration {
  /** Instance or instance-container URL, validated to lie inside the selected storage. */
  location: string;
  source: TypeSource;
}

/** Discovery hints do not grant access to the returned resources. */
export interface TypeIndex {
  /**
   * Both instances and instance containers, de-duplicated by location across sources (use
   * {@link TypeIndex.findRegistrations} when the source matters). Order: private, then public,
   * each in document and registration order; LWS results in server order.
   */
  find(classIri: string, options?: FindOptions): Promise<string[]>;
  /** One read of each Solid document, or one batched LWS query plus its pages. */
  findAll(classes: string[], options?: FindOptions): Promise<Map<string, string[]>>;
  /**
   * Like `find`, but one entry per (source, location): the same location asserted by both indexes
   * is returned twice, never merged. Ordering is as for `find`.
   */
  findRegistrations(classIri: string, options?: FindOptions): Promise<FoundRegistration[]>;
  /** Like `findAll`, with sources; one entry per (source, location) for each class. */
  findAllRegistrations(
    classes: string[],
    options?: FindOptions,
  ): Promise<Map<string, FoundRegistration[]>>;
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
