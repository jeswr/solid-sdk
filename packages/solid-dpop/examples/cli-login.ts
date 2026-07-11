/**
 * Example: user-delegated Solid login from a CLI, using the authorization-code + PKCE + DPoP flow.
 *
 * Run (after `npm run build`):
 *   node --experimental-strip-types examples/cli-login.ts https://solidcommunity.net/ https://pod.example/me/notes.ttl
 *
 * What it does:
 *   1. `cliLogin` discovers the issuer, anonymously registers a public native client (DCR),
 *      starts a loopback listener on 127.0.0.1:<ephemeral>, prints the authorization URL, and waits
 *      for you to log in + consent in a browser.
 *   2. The returned `AuthCodeSession` is DPoP-bound; `authedFetch` reads a protected resource with a
 *      fresh `ath`-bound proof per request.
 *   3. `refreshSession` rotates the access token using the refresh token (request `offline_access`,
 *      which the default scope does, and consent to it).
 *
 * The issuer guard permits `http://localhost:…` / `http://127.0.0.1:…` for local CSS dev but
 * rejects `http://` for real domains — the deliberate fix for the reactive-auth 0.1.3 bug class.
 */
import { authedFetch, cliLogin, refreshSession } from "../src/index.js";

async function main(): Promise<void> {
  const [issuer, resource] = process.argv.slice(2);
  if (!issuer || !resource) {
    process.stderr.write("usage: cli-login.ts <issuer> <resourceUrl>\n");
    process.exit(1);
    return;
  }

  // Static client (Client Identifier Document) instead of DCR: pass `clientId: "https://app/clientid.jsonld"`.
  const session = await cliLogin({
    issuer,
    clientName: "solid-dpop example CLI",
    // openBrowser: (url) => import("node:child_process").then((cp) => cp.spawn("open", [url])),
  });

  process.stdout.write(`\nLogged in. Access token bound to jkt ${session.keyPair.thumbprint}\n`);
  if (session.refreshToken) process.stdout.write("Refresh token acquired (offline_access).\n");

  const res = await authedFetch(session, undefined, "GET", resource);
  process.stdout.write(`\nGET ${resource} -> ${res.status}\n`);
  process.stdout.write((await res.text()).slice(0, 500) + "\n");

  if (session.refreshToken) {
    await refreshSession(session);
    process.stdout.write("\nRefreshed access token (DPoP binding preserved).\n");
  }
}

main().catch((e: unknown) => {
  process.stderr.write(`login failed: ${(e as Error).message}\n`);
  process.exit(1);
});
