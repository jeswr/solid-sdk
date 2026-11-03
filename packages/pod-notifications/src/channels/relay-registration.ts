// AUTHORED-BY Codex GPT-6.1-Sol
import type { NotificationsDependencies } from "../types.js";
import { validateChannelUrl } from "./channel-url.js";

/** Register only at the explicitly configured relay; never send pod access tokens there. */
export async function registerRelay(
  options: NotificationsDependencies,
  storage: string,
  signal: AbortSignal,
  forbidden: () => void,
): Promise<{ inbox: string; stream: string }> {
  const relay = options.relay;
  if (!relay?.getIdToken) throw new TypeError("Webhook relay requires an ID token callback");
  const base = new URL(
    validateChannelUrl(
      relay.url,
      options.storage.root,
      undefined,
      false,
      options.allowInsecureLoopback === true,
    ),
  );
  if (base.pathname !== "/" || base.search) throw new TypeError("Relay URL must be an origin");
  const token = await relay.getIdToken(signal);
  signal.throwIfAborted();
  if (!token || /\s/u.test(token)) throw new TypeError("Invalid relay ID token");
  const response = await (relay.fetch ?? globalThis.fetch)(`${base.origin}/register`, {
    method: "POST",
    redirect: "error",
    credentials: "omit",
    cache: "no-store",
    signal,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ storage }),
  });
  if (response.status === 403) forbidden();
  if (!response.ok || response.redirected) throw new Error("Relay registration failed");
  const registration: unknown = await response.json();
  signal.throwIfAborted();
  if (
    typeof registration !== "object" ||
    registration === null ||
    Array.isArray(registration) ||
    !("id" in registration) ||
    typeof registration.id !== "string" ||
    !/^[a-f0-9]{32}$/u.test(registration.id) ||
    !("streamToken" in registration) ||
    typeof registration.streamToken !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/u.test(registration.streamToken) ||
    !("inbox" in registration) ||
    registration.inbox !== `${base.origin}/inbox/${registration.id}`
  )
    throw new Error("Invalid relay registration");
  return {
    inbox: registration.inbox as string,
    stream: `${base.origin}/stream/${registration.id}?token=${registration.streamToken}`,
  };
}
