// AUTHORED-BY Codex (GPT-6.1 Sol)
import { fetchRdf, RdfFetchError } from "@jeswr/fetch-rdf";
import { assertWithinPodScope } from "@jeswr/guarded-fetch";
import { createAccessClient, type EffectivePolicy, readWac, writeWac } from "@jeswr/pod-access";
import type { StorageClient } from "@jeswr/storage-client";
import type { EventData, InviteeData } from "./model.js";

/** Bootstrap only a missing own WAC document, at the server's advertised URL.
 * Existing policy is inspected and never replaced. ACP/unknown access fails closed. */
export async function sealNewResource(
  storage: StorageClient,
  fetch: typeof globalThis.fetch,
  target: string,
  owner: string,
): Promise<void> {
  if (
    storage.features.accessControl.state !== "available" ||
    storage.features.accessControl.detail.model !== "wac"
  )
    throw new Error("This first cut needs WAC sharing on your pod");
  const head = await storage.head(target);
  if (head.allow !== null && !head.allow.control) throw new Error("Control access is required");
  const links = head.links.get("acl");
  if (links?.length !== 1 || head.links.has("http://www.w3.org/ns/solid/acp#accessControl"))
    throw new Error("No unambiguous WAC document was advertised");
  const acl = assertWithinPodScope(storage.root, links[0]?.target ?? "");
  try {
    const existing = await fetchRdf(acl, { fetch });
    const policy = readWac(existing.dataset, target, acl, "css");
    // Never silently replace access configured by another application.
    if (
      !policy.grants.length ||
      policy.denials.length ||
      policy.grants.some((g) =>
        g.who.some((c) => c.length !== 1 || c[0]?.kind !== "agent" || c[0].webId !== owner),
      )
    )
      throw new Error("The existing access policy is not owner-only");
    return;
  } catch (error) {
    if (!(error instanceof RdfFetchError) || error.status !== 404) throw error;
  }
  const policy: EffectivePolicy = {
    denials: [],
    grants: [
      {
        modes: new Set(["read", "write", "control"]),
        who: [[{ kind: "agent", webId: owner }]],
        except: [],
        appliesTo: target.endsWith("/") ? "both" : "resource",
        source: { url: acl, node: `${acl}#owner` },
      },
    ],
  };
  const body = await writeWac(policy, target, acl);
  const response = await fetch(acl, {
    method: "PUT",
    redirect: "error",
    headers: { "content-type": "text/turtle", "if-none-match": "*" },
    body,
  });
  if (!response.ok) throw new Error("Couldn't protect the invitation storage");
}

/** Grant Read on the invitation, Append on the reply container only.
 * Visible lists add inherited Read separately; Append is never inherited by replies. */
export async function publishAccess(
  storage: StorageClient,
  eventUrl: string,
  event: EventData,
  invitees: readonly InviteeData[],
): Promise<void> {
  const access = createAccessClient({ storage });
  if (access.model() !== "wac") throw new Error("WAC sharing is required");
  const audience =
    event.visibility === "link"
      ? [{ public: true } as const]
      : invitees.flatMap((i) => (i.webId ? [i.webId] : []));
  const replies = new URL("rsvps/", eventUrl).href;
  for (const agent of audience) {
    // Configure reply access before exposing the invitation.
    await access.share(replies, { agent, modes: ["append"] }, {});
    if (event.guestListVisible)
      await access.share(replies, { agent, modes: ["read"] }, { inherit: true });
    await access.share(eventUrl, { agent, modes: ["read"] }, {});
  }
}
