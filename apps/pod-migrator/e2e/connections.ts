// AUTHORED-BY GPT-6.1 Sol
// AUTHORED-BY Codex GPT-6
// Only loaded by Vite's explicit --mode screens development server.
import type { AuthEvent, AuthEventType, Identity, PodAuth } from "@jeswr/pod-auth";
import { PodConnection } from "../src/auth/connections.js";

export function createConnections(): [PodConnection, PodConnection] {
  const signedOut = new URLSearchParams(location.search).has("signed-out");
  const make = (side: "source" | "target"): PodConnection => {
    const webId =
      side === "source"
        ? "https://alice.solidcommunity.net/profile/card#me"
        : "https://id.example/alice#me";
    const turtle =
      side === "source"
        ? "<https://alice.solidcommunity.net/profile/card#me> <http://www.w3.org/ns/pim/space#storage> <https://alice.solidcommunity.net/>."
        : "<https://id.example/alice#me> <http://www.w3.org/ns/pim/space#storage> <https://storage.example/pods/alice/>.";
    const publicFetch: typeof fetch = async () =>
      new Response(turtle, {
        headers: {
          "content-type": "text/turtle",
          ...(side === "source" ? { "x-powered-by": "Community Solid Server" } : {}),
        },
      });
    let identity: Identity | null = signedOut
      ? null
      : {
          webId,
          subject: webId,
          issuer: side === "target" ? "https://login.inrupt.com/" : "https://identity.example/",
          clientId: "https://app.example/clientid.jsonld",
          protocol: "solid-oidc",
          storages: [
            side === "source"
              ? "https://alice.solidcommunity.net/"
              : "https://storage.example/pods/alice/",
          ],
        };
    const listeners = new Map<AuthEventType, Set<(event: AuthEvent) => void>>();
    const auth: PodAuth = {
      fetch: publicFetch,
      restore: async () => identity,
      remembered: async () => [],
      identity: async () => identity,
      login: async () => {
        throw new Error("Screenshot accounts do not sign in");
      },
      logout: async () => {
        identity = null;
        for (const handler of listeners.get("logout") ?? [])
          handler({ type: "logout", identity: null, timestamp: Date.now() });
      },
      on: (type, handler) => {
        const handlers = listeners.get(type) ?? new Set();
        listeners.set(type, handlers);
        handlers.add(handler);
        return () => {
          handlers.delete(handler);
        };
      },
    };
    return new PodConnection(side, async () => auth, publicFetch);
  };
  return [make("source"), make("target")];
}
