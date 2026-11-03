// AUTHORED-BY Codex GPT-6.1-Sol
import { type StorageClient, StorageError, type StorageErrorCode } from "@jeswr/storage-client";
import { canonicalize, LEGACY_NAMESPACES } from "@jeswr/suite-vocab";
import type { RegistrationOptions, TypeLocation } from "./types.js";

export function error(code: StorageErrorCode, url: string, method = "GET"): StorageError {
  return new StorageError(code, { url, method, feature: "typeIndex" });
}

export function classIri(value: string): string {
  if (!/^[a-z][a-z0-9+.-]*:[^\s\p{Cc}<>"{}|^`\\]+$/iu.test(value)) {
    throw new TypeError("Expected an absolute class IRI");
  }
  return canonicalize(value);
}

export function aliases(value: string): string[] {
  const canonical = classIri(value);
  return [
    ...new Set([
      canonical,
      ...Object.entries(LEGACY_NAMESPACES)
        .filter(([, base]) => canonical.startsWith(base))
        .map(([legacy, base]) => legacy + canonical.slice(base.length)),
    ]),
  ];
}

/** Validate independently of backend test doubles; never retain unsafe URLs in errors. */
export function scoped(storage: StorageClient, value: string): string | undefined {
  try {
    const url = new URL(value);
    if (
      !/^https?:$/.test(url.protocol) ||
      url.username ||
      url.password ||
      !/^https?:\/\//i.test(value) ||
      /[\s\p{Cc}\\]/u.test(value) ||
      !storage.isWithinStorage(value)
    )
      return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

export function requireScoped(storage: StorageClient, value: string): string {
  const url = scoped(storage, value);
  if (!url) throw error("scope", storage.root);
  return url;
}

export function documentUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  return url.href;
}

export function registration(
  storage: StorageClient,
  iri: string,
  location: TypeLocation,
  options: RegistrationOptions,
) {
  const canonical = classIri(iri);
  const index = options.index ?? "private";
  if (index !== "public" && index !== "private")
    throw new TypeError("Invalid type index visibility");
  if ((location.instance === undefined) === (location.container === undefined)) {
    throw new TypeError("Provide exactly one instance or container");
  }
  const target = requireScoped(storage, (location.instance ?? location.container) as string);
  if (
    location.container !== undefined &&
    storage.protocol === "solid" &&
    (!target.endsWith("/") || new URL(target).search || new URL(target).hash)
  ) {
    throw new TypeError("A Solid instance container must end in '/'");
  }
  return { canonical, index, target, container: location.container !== undefined };
}
