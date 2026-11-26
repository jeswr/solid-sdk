// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6
"use client";
/**
 * Registers the offline worker from `/service-worker` in production builds only: a development server's
 * chunks change on every edit, and a cached shell would hide them.
 */
import { useEffect } from "react";
import { ACCOUNTS_KEY } from "../lib/accounts-store";
import { FORGET_PAGES, PAGES_CACHE_PREFIX, REMEMBER_PAGE } from "../lib/service-worker";
import { useOptionalAccounts } from "../session/accounts-context";

/** A salted hash of the owning account id, or "" when signed out; never the id itself. */
const PAGES_OWNER_KEY = "suite.sw.pages-owner";
const PAGES_SALT_KEY = "suite.sw.pages-salt";

const enabled = () =>
  process.env.NEXT_PUBLIC_SUITE_TARGET !== "native" &&
  process.env.NODE_ENV === "production" &&
  "serviceWorker" in navigator;

export function registerServiceWorker(): void {
  if (!enabled()) return;
  void navigator.serviceWorker
    .register("/service-worker", { scope: "/", updateViaCache: "none" })
    .catch(() => {
      /* Offline support is an enhancement; the app works without it. */
    });
}

/** Ask the worker to keep a copy of this page (its HTML and assets) for offline use. */
export function rememberPage(path: string): void {
  if (!enabled()) return;
  void navigator.serviceWorker.ready.then((registration) =>
    registration.active?.postMessage({ type: REMEMBER_PAGE, path }),
  );
}

/**
 * Forget every remembered page. Their keys are the visited paths of an account, so they must not
 * outlive that account on a shared device. The worker is told first (it discards writes still in
 * flight), then the caches are deleted here too. App-shell caches hold no account data.
 */
export async function clearRememberedPages(
  cacheStorage: Pick<CacheStorage, "keys" | "delete"> | undefined = globalThis.caches,
): Promise<void> {
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    for (const worker of [registration?.installing, registration?.waiting, registration?.active])
      worker?.postMessage({ type: FORGET_PAGES });
  } catch {
    /* No worker to tell; the caches are cleared below. */
  }
  if (!cacheStorage) return;
  try {
    const names = await cacheStorage.keys();
    await Promise.all(
      names
        .filter((name) => name.startsWith(PAGES_CACHE_PREFIX))
        .map((n) => cacheStorage.delete(n)),
    );
  } catch {
    /* Cache storage may be blocked; nothing was stored then either. */
  }
}

const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
const randomToken = () => {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return hex(bytes.buffer);
};

/**
 * What identifies the owner without revealing the account: "" when signed out, else a truncated
 * SHA-256 of a per-device random salt and the account id. A random value that never matches is
 * returned when hashing is unavailable, which clears on every check.
 */
async function ownerToken(
  activeId: string | null,
  storage: Pick<Storage, "getItem" | "setItem"> | undefined,
): Promise<string> {
  if (!activeId) return "";
  try {
    let salt = storage?.getItem(PAGES_SALT_KEY) ?? null;
    if (!salt) {
      salt = randomToken();
      storage?.setItem(PAGES_SALT_KEY, salt);
    }
    const digest = await globalThis.crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`${salt}\n${activeId}`),
    );
    return hex(digest).slice(0, 32);
  } catch {
    try {
      return randomToken();
    } catch {
      return `unknown-${Math.random()}`;
    }
  }
}

/**
 * Clear remembered pages when the active account differs from the one they were saved for
 * (signed out is its own owner). The caches are cleared before the new owner is recorded, so an
 * interrupted switch never leaves one account's paths attributed to another. Returns whether it
 * cleared.
 */
export async function reconcileRememberedPages(
  activeId: string | null,
  storage: Pick<Storage, "getItem" | "setItem"> | undefined,
  cacheStorage?: Pick<CacheStorage, "keys" | "delete">,
): Promise<boolean> {
  let previous: string | null = null;
  try {
    previous = storage?.getItem(PAGES_OWNER_KEY) ?? null;
  } catch {
    /* Treated as unknown owner: clear to be safe. */
  }
  const owner = await ownerToken(activeId, storage);
  if (previous === owner) return false;
  await clearRememberedPages(cacheStorage);
  try {
    storage?.setItem(PAGES_OWNER_KEY, owner);
  } catch {
    /* Blocked storage: cleared on every load, which is only slower. */
  }
  return true;
}

/** The active account id as persisted by the accounts store, read without React context. */
function persistedActiveId(): string | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(ACCOUNTS_KEY) ?? "null") as {
      activeId?: unknown;
    } | null;
    return typeof parsed?.activeId === "string" ? parsed.activeId : null;
  } catch {
    return null;
  }
}

function storageOrUndefined(): Storage | undefined {
  try {
    return localStorage;
  } catch {
    return undefined;
  }
}

/**
 * Mount inside `AccountsProvider` so signing out or switching account in a live tab clears the
 * remembered pages too (the root registration only sees the account persisted at load).
 */
export function RememberedPagesAccountGuard() {
  const accounts = useOptionalAccounts();
  const status = accounts?.status;
  const activeId = accounts?.active?.id ?? null;
  useEffect(() => {
    if (!status || status === "loading") return;
    void reconcileRememberedPages(activeId, storageOrUndefined());
  }, [status, activeId]);
  return null;
}

/** Mount once at the root. Dev fixtures are never registered. */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (location.pathname.startsWith("/dev/")) return;
    // An account signed out or switched since the last load must not leave its visited paths.
    if (enabled()) void reconcileRememberedPages(persistedActiveId(), storageOrUndefined());
    registerServiceWorker();
  }, []);
  return null;
}
