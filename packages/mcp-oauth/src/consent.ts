// AUTHORED-BY Codex GPT-6.1-Sol
import type { ConsentContext } from "./types.js";

// Isolate untrusted values without changing exact protocol identifiers.
const isolated = (value: string) =>
  `<bdi>${value.replace(
    /[&<>"']/gu,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ] as string,
  )}</bdi>`;

/** Escaped HTML fragment for a validated consent context; append only trusted UI markup. */
export function consentDisplay(context: ConsentContext): string {
  const { client, authorization, session } = context;
  // Registration rejects these; also sanitize names from legacy/custom client stores.
  const name = client.client_name?.replace(/[\p{Cc}\p{Cf}]/gu, "");
  const identity = client.client_id.startsWith("https://")
    ? `<p>Client: <strong>${isolated(new URL(client.client_id).host)}</strong></p><p>Client name (self-declared): ${isolated(name ?? "")}</p>`
    : `<p>Client: ${isolated(name ?? client.client_id)} (unverified (self-declared))</p>`;
  return `${identity}<p>Redirect host: <strong>${isolated(new URL(authorization.redirectUri).host)}</strong></p><p>Redirect URI: ${isolated(authorization.redirectUri)}</p><p>Client ID: ${isolated(client.client_id)}</p><p>Pod owner: ${isolated(session.webId)}</p><p>Scope: ${isolated(authorization.scope)}</p>`;
}
