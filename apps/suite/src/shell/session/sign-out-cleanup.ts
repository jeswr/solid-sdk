// AUTHORED-BY Codex GPT-6
import { assertWithinPodScope, isWithinPodScope } from "@jeswr/guarded-fetch";
import { nativeNotificationPath } from "./solid-backend";
import type { SessionBackend, SuiteAccount } from "./types";

type CleanupHandler = (account: SuiteAccount, fetchPod: typeof fetch | undefined) => Promise<void>;
const handlers = new Set<CleanupHandler>();

/** Cleanup that needs the live session runs before credentials or the shell row disappear. */
export function onBeforeSignOut(handler: CleanupHandler): () => void {
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}

export function beforeSignOut(
  account: SuiteAccount,
  backend?: SessionBackend,
): Promise<void> | undefined {
  if (!handlers.size) return undefined;
  return (async () => {
    for (const handler of handlers) {
      let live = true;
      let transport: typeof fetch | undefined;
      const fetchPod: typeof fetch | undefined =
        account.kind === "solid" && backend
          ? async (input, init) => {
              if (!live) throw new Error("Sign-out cleanup has ended");
              const request = new Request(input, {
                ...init,
                credentials: "omit",
                redirect: "error",
              });
              const target = new URL(request.url);
              if (
                target.origin !== new URL(account.storageUrl).origin ||
                !["GET", "HEAD", "OPTIONS", "DELETE"].includes(request.method)
              )
                throw new Error("Request is outside pod cleanup scope");
              if (request.method === "DELETE") {
                const notifications = new URL(nativeNotificationPath, account.storageUrl).href;
                if (!isWithinPodScope(notifications, request.url, { allowRoot: false }))
                  assertWithinPodScope(account.storageUrl, request.url, { allowRoot: false });
              }
              request.signal.throwIfAborted();
              // Keep the backend's pod credential boundary, including its configured
              // notification endpoint for servers that host channels outside the pod folder.
              transport ??= backend.fetchFor(account);
              return transport(request);
            }
          : undefined;
      try {
        await handler(account, fetchPod);
      } finally {
        live = false;
        transport = undefined;
      }
    }
  })();
}
