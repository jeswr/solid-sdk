// AUTHORED-BY Codex GPT-6
// Only loaded by Vite's explicit --mode screens development server.
import type { SolidAuth } from "@jeswr/solid-auth-core";
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
    const auth = {
      webId: signedOut ? null : webId,
      issuer: side === "target" ? "https://login.inrupt.com/" : "https://identity.example",
      publicFetch,
      authenticatedFetch: publicFetch,
      restore: async () =>
        auth.webId
          ? { outcome: "restored" as const, webId: auth.webId }
          : { outcome: "login" as const },
      handleRedirect: async () => ({ outcome: "none" as const }),
      beginRedirectLogin: async () => ({ authorizationUrl: "https://identity.example/authorize" }),
      logout: async () => {
        auth.webId = null;
      },
      reArmAllowedOrigins: () => true,
    };
    return new PodConnection(side, auth as unknown as SolidAuth);
  };
  return [make("source"), make("target")];
}
