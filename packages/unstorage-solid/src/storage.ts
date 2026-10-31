// AUTHORED-BY Codex GPT-6.1-Sol
import {
  createPodClient,
  type StorageClient,
  StorageError,
  toStorageError,
} from "@jeswr/storage-client";
import { createSameOriginRedirectRefusingFetch, createScopedFetch } from "./scope.js";

/** SDK transport adapter: discovery stays same-origin, data stays under the mount. */
export async function storageFromFetch(
  base: string,
  fetchImpl: typeof fetch,
  headers?: Record<string, string>,
  txHeaders?: Record<string, string>,
  observe?: (url: string, headers: Headers) => void,
): Promise<StorageClient> {
  const discovery = createSameOriginRedirectRefusingFetch(new URL(base).origin, fetchImpl);
  const data = createScopedFetch(base, fetchImpl);
  let discovering = true;
  let initialRequest = true;
  let discoveryAbsence: StorageError | undefined;
  const transport: typeof fetch = async (input, init) => {
    const initialMountHead =
      discovering && initialRequest && init?.method === "HEAD" && String(input) === base;
    initialRequest = false;
    const merged = new Headers(headers);
    new Headers(init?.headers).forEach((value, key) => {
      // SDK resource reads default to */*; keep the driver's configured representation.
      // Discovery and listings still need the SDK's specific protocol media types.
      if (!discovering && key === "accept" && value === "*/*" && merged.has(key)) return;
      merged.set(key, value);
    });
    new Headers(txHeaders).forEach((value, key) => {
      merged.set(key, value);
    });
    const response = await (discovering ? discovery : data)(input, { ...init, headers: merged });
    if (initialMountHead && [404, 410].includes(response.status)) {
      // Preserve absence if discovery has no links, but let the SDK use advertised
      // storage metadata so a first PUT can create the missing mount and its path.
      discoveryAbsence = toStorageError(init?.method ?? "GET", base, response);
    }
    if (!discovering) observe?.(String(input), response.headers);
    return response;
  };
  const { storage } = await createPodClient({ storage: base, fetch: transport }).catch((error) => {
    if (
      discoveryAbsence &&
      error instanceof Error &&
      "code" in error &&
      error.code === "no-storage-link" &&
      "url" in error &&
      error.url === base
    )
      throw discoveryAbsence;
    throw error;
  });
  discovering = false;
  return storage;
}

export function isMissing(error: unknown): boolean {
  return error instanceof StorageError && (error.status === 404 || error.status === 410);
}

/** Preserve shared redirect error identity through the SDK network wrapper. */
export function transportCause(error: unknown): unknown {
  return error instanceof StorageError && error.code === "network" && error.cause
    ? error.cause
    : error;
}
