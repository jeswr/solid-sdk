// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Sonnet 5.5
import { type AccessClient, checkOwnerOnly, createAccessClient } from "@jeswr/pod-access";
import {
  ensurePrivateContainerAccess,
  type PrivateAccessSession,
  setGrants,
} from "@jeswr/pod-access/roles";
import type { StorageClient } from "@jeswr/storage-client";
import { EVENT_STATUS, type EventData, guestListAvailable, type InviteeData } from "./model.js";

/** Seal (when the caller just created it) or verify owner-only access, through pod-access.
 * This package never writes an access document itself: pod-access owns the dialect, which it
 * takes from the client's session, never from pod data. A container the caller did not create
 * is verified and never rewritten, so access another application configured is not replaced.
 * A document the caller just created gets its own owner-only policy (so it can later be shared
 * on its own); any other document is only verified. */
export async function sealNewResource(
  storage: StorageClient,
  session: PrivateAccessSession,
  target: string,
  options: { created: boolean },
): Promise<void> {
  if (
    storage.features.accessControl.state !== "available" ||
    storage.features.accessControl.detail.model !== "wac"
  )
    throw new Error("This first cut needs WAC sharing on your pod");
  const owner = session.webId;
  if (!target.endsWith("/") && options.created) {
    const sealed = await setGrants(
      [target],
      [{ agent: { type: "webid", id: owner }, role: "manager", inherited: false, source: target }],
      {
        fetch: session.fetch,
        root: session.storageUrl,
        webId: owner,
        kind: "resource",
        ownOnly: true,
      },
    );
    if (sealed.failed.length) throw new Error("Couldn't protect the invitation storage");
  }
  const verdict = target.endsWith("/")
    ? await ensurePrivateContainerAccess(session, target, { ...options, storage })
    : await checkOwnerOnly({ storage, url: target, ownerWebId: owner });
  if (!verdict.private) throw new Error("The invitation storage isn't owner-only");
}

type Agent = { public: true } | string;

/** Who an invitation is shared with: the public for link invitations, else the named WebIDs. */
function audienceOf(event: EventData, invitees: readonly InviteeData[]): Agent[] {
  return event.visibility === "link"
    ? [{ public: true }]
    : invitees.flatMap((i) => (i.webId && i.webId !== event.organizer ? [i.webId] : []));
}
const isPublic = (agent: unknown) =>
  typeof agent === "object" && agent !== null && ("public" in agent || "authenticated" in agent);

/** Fail closed unless the reply container is exactly what the invitation promises: nobody but
 * the organiser has more than Append, and only named invitees may Read, only for a visible list.
 * The public (or anyone holding the link) never reads a raw RSVP. */
async function assertReplyAccess(
  access: AccessClient,
  replies: string,
  event: EventData,
  audience: readonly Agent[],
): Promise<void> {
  const readers = new Set(
    guestListAvailable(event) ? audience.filter((a): a is string => typeof a === "string") : [],
  );
  for (const grant of await access.grants(replies)) {
    if (grant.agent === event.organizer) continue;
    const extra = grant.modes.filter((mode) => mode !== "append");
    if (!extra.length) continue;
    if (
      isPublic(grant.agent) ||
      typeof grant.agent !== "string" ||
      !readers.has(grant.agent) ||
      extra.some((mode) => mode !== "read")
    )
      throw new Error("The reply container would be readable beyond its intended audience");
  }
}

/** Grant Read on the invitation and Append on the reply container only.
 * The public (a link invitation) never gets Read on the reply container or its replies, and a
 * guest list is never served from raw replies to link holders. Named invitees get inherited
 * Read for a visible guest list; Append is never inherited by replies.
 * Callers must have committed the published state first and revoke on failure. */
export async function publishAccess(
  storage: StorageClient,
  eventUrl: string,
  event: EventData,
  invitees: readonly InviteeData[],
): Promise<void> {
  const access = createAccessClient({ storage });
  if (access.model() !== "wac") throw new Error("WAC sharing is required");
  const audience = audienceOf(event, invitees);
  const replies = new URL("rsvps/", eventUrl).href;
  for (const agent of audience) {
    // Configure reply access before exposing the invitation.
    if (event.eventStatus === EVENT_STATUS.scheduled)
      await access.share(replies, { agent, modes: ["append"] }, {});
    if (guestListAvailable(event) && !isPublic(agent))
      await access.share(replies, { agent, modes: ["read"] }, { inherit: true });
    await access.share(eventUrl, { agent, modes: ["read"] }, {});
  }
  await assertReplyAccess(access, replies, event, audience);
}

/** Undo `publishAccess`, then re-read both documents to confirm nothing remains for the audience.
 * Throws when it cannot confirm; the caller then reports that sharing must be checked. */
export async function revokeAccess(
  storage: StorageClient,
  eventUrl: string,
  event: EventData,
  invitees: readonly InviteeData[],
): Promise<void> {
  const access = createAccessClient({ storage });
  if (access.model() !== "wac") throw new Error("WAC sharing is required");
  const replies = new URL("rsvps/", eventUrl).href;
  const audience = audienceOf(event, invitees);
  // A missing rule is not an error here; the re-read below is the authority.
  for (const url of [eventUrl, replies])
    for (const agent of audience) await access.revoke(url, agent).catch(() => undefined);
  const remaining = (agent: unknown) =>
    audience.some((a) => (typeof a === "string" ? a === agent : isPublic(agent)));
  for (const url of [eventUrl, replies])
    if ((await access.grants(url)).some((grant) => remaining(grant.agent)))
      throw new Error("Couldn't confirm that sharing was withdrawn");
}

/** Remove any non-owner Read from the reply container, as an older version may have granted
 * the public a visible guest list. Append rules keep their own rule; mixed rules are re-issued
 * as Append only. Used to repair link invitations and on edit. */
export async function withdrawReplyRead(
  storage: StorageClient,
  eventUrl: string,
  event: Pick<EventData, "organizer" | "eventStatus" | "visibility" | "guestListVisible">,
): Promise<void> {
  const access = createAccessClient({ storage });
  if (access.model() !== "wac") throw new Error("WAC sharing is required");
  const replies = new URL("rsvps/", eventUrl).href;
  const allowed = guestListAvailable(event);
  const rules = (await access.grants(replies)).filter(
    (grant) =>
      grant.agent !== event.organizer &&
      grant.modes.includes("read") &&
      !(allowed && typeof grant.agent === "string"),
  );
  if (rules.some((grant) => !grant.id)) throw new Error("Cannot safely identify reply grants");
  for (const grant of rules) {
    await access.revoke(replies, grant.id as string);
    if (grant.modes.includes("append") && event.eventStatus === EVENT_STATUS.scheduled)
      await access.share(replies, { agent: grant.agent, modes: ["append"] }, {});
  }
  if (
    (await access.grants(replies)).some(
      (grant) =>
        grant.agent !== event.organizer &&
        grant.modes.includes("read") &&
        !(allowed && typeof grant.agent === "string"),
    )
  )
    throw new Error("Couldn't confirm that reply Read access was withdrawn");
}

/** Revoke each Append rule by id, retaining separate owner and guest Read rules. */
export async function closeReplies(
  storage: StorageClient,
  eventUrl: string,
  owner: string,
): Promise<void> {
  const access = createAccessClient({ storage });
  if (access.model() !== "wac") throw new Error("WAC sharing is required");
  const replies = new URL("rsvps/", eventUrl).href;
  const rules = await access.grants(replies);
  const ownerRules = new Set(
    rules.filter((grant) => grant.agent === owner).map((grant) => grant.id),
  );
  const grants = rules.filter((grant) => grant.agent !== owner && grant.modes.includes("append"));
  if (grants.some((grant) => grant.modes.length !== 1))
    throw new Error("Cannot safely revoke mixed reply grants");
  if (grants.some((grant) => grant.id && ownerRules.has(grant.id)))
    throw new Error("Cannot safely revoke reply grants shared with the owner");
  if (grants.some((grant) => !grant.id)) throw new Error("Cannot safely identify reply grants");
  for (const grant of grants) await access.revoke(replies, grant.id as string);
}
