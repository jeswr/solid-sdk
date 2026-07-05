// AUTHORED-BY Claude Fable 5
/**
 * LDN inbox WRITES (#75 / 5u9) — POST an ActivityStreams 2.0 `as:Announce`
 * notification into a COLLABORATOR's Linked Data Notifications inbox
 * (https://www.w3.org/TR/ldn/) when this app assigns them an issue, or when a
 * collaborator is @mentioned in a comment. This is the WRITE complement of the
 * read-only inbox reader in `inbox.ts`.
 *
 * The target inbox is on a FOREIGN pod (a collaborator's, a DIFFERENT origin from
 * the acting user's own pod), so — unlike the OWN-pod inbox reader, which pins to
 * the user's own `pim:storage` (`own-pod.ts`) — the write path is guarded by the
 * suite SSRF policy (`@jeswr/guarded-fetch`) instead:
 *
 *   1. INBOX DISCOVERY. The collaborator's `ldp:inbox` is read off THEIR OWN WebID
 *      profile (via `@jeswr/fetch-rdf` `fetchRdf` + `@rdfjs/wrapper` typed
 *      accessors — never a bespoke parser). The inbox URL therefore comes from the
 *      target's own self-description, not from attacker-supplied input; fail-closed
 *      when the profile advertises no inbox.
 *   2. SSRF GATE. Both the WebID we dereference AND the inbox URL we POST to are
 *      validated with `assertSafeUrl` — the browser-safe policy that refuses a
 *      non-http(s) scheme, a loopback / link-local / private / cloud-metadata
 *      target (e.g. `169.254.169.254`, `localhost`), userinfo, and (in production)
 *      a non-443 port. So a poisoned profile can never point the authenticated
 *      POST at an internal service.
 *   3. REDIRECT REFUSAL. The credentialed POST is issued through
 *      `refuseRedirects(fetch)`, which forces `redirect:"manual"` and REFUSES any
 *      3xx — the acting user's DPoP credential can only ever reach the ONE inbox
 *      host, never a `Location` the target's server chose.
 *
 * The user's OWN DPoP-authed `fetch` (the `@solid/reactive-authentication`-patched
 * global) carries the write: the acting user appends the notification AS THEMSELVES
 * (`as:actor` = the acting user's WebID; `as:target` = the collaborator). The
 * notification is built with `n3.Writer` (never hand-concatenated) and carries
 * PROV-O provenance asserting this app/user as the source (own-origin provenance).
 *
 * Non-blocking: {@link Announcer} fires each announce fire-and-forget (an
 * assignment/comment succeeds even if the notify fails — surfaced via `onError`)
 * and skips self-notification. An ASSIGNMENT is announced only when it actually
 * CHANGED to a new WebID, and is de-duped per (issue, assignee) so the same
 * assignment is never announced twice in a session; a MENTION is a per-comment
 * event (duplicate targets within one comment collapse, but a later comment
 * mentioning the same person notifies again).
 */

import { TermWrapper, OptionalFrom, NamedNodeAs } from "@rdfjs/wrapper";
import { DataFactory, Writer } from "n3";
import { fetchRdf } from "@jeswr/fetch-rdf";
import {
  assertSafeUrl,
  createGuardedFetch,
  refuseRedirects,
  type GuardOptions,
} from "@jeswr/guarded-fetch";
import { AS, LDP, PROV, RDF, RDFS, XSD } from "./vocab";

const { namedNode, literal, blankNode, quad } = DataFactory;

/** Whether an announce is an assignment or an @mention. */
export type AnnounceKind = "assignment" | "mention";

/** The content of one AS2 `as:Announce` notification. */
export interface AnnounceContent {
  /** Which kind of activity this notification is about. */
  kind: AnnounceKind;
  /** The acting user's WebID — `as:actor` (who triggered it). */
  actorWebId: string;
  /** The issue/task resource IRI — `as:object` (what it is about). */
  objectIri: string;
  /** The collaborator being notified — `as:target` (and the inbox owner). */
  targetWebId: string;
  /** Human-readable one-liner — `as:summary`. */
  summary: string;
  /** ISO-8601 timestamp — `as:published`. Defaults to now. */
  published?: string;
}

/** Raised when the POST to a collaborator's inbox returns a non-2xx status. */
export class AnnounceError extends Error {
  readonly inboxUrl: string;
  readonly status: number;
  constructor(message: string, inboxUrl: string, status: number) {
    super(message);
    this.name = "AnnounceError";
    this.inboxUrl = inboxUrl;
    this.status = status;
  }
}

/** Reads the `ldp:inbox` link off a WebID subject (typed accessor, never regex). */
class ProfileInbox extends TermWrapper {
  get inbox(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${LDP}inbox`, NamedNodeAs.string);
  }
}

/**
 * Serialise an AS2 `as:Announce` notification to Turtle via `n3.Writer` (never
 * hand-concatenated). The activity subject is the EMPTY relative IRI `<>`, which
 * the receiving server resolves to the minted notification resource's own URL — so
 * when the notification is later read back (inbox.ts `parseNotification`), the AS2
 * activity sits AT the resource URL exactly as the reader expects. PROV-O
 * provenance (`prov:wasGeneratedBy` an activity `prov:wasAssociatedWith` the acting
 * user) records this app/user as the source (own-origin provenance).
 */
export function buildAnnounceTurtle(content: AnnounceContent): Promise<string> {
  const subject = namedNode(""); // the posted resource's own URL (LDN convention)
  const activity = blankNode();
  const published = content.published ?? new Date().toISOString();
  const dateTime = namedNode(`${XSD}dateTime`);

  const quads = [
    quad(subject, namedNode(`${RDF}type`), namedNode(`${AS}Announce`)),
    quad(subject, namedNode(`${AS}actor`), namedNode(content.actorWebId)),
    quad(subject, namedNode(`${AS}object`), namedNode(content.objectIri)),
    quad(subject, namedNode(`${AS}target`), namedNode(content.targetWebId)),
    quad(subject, namedNode(`${AS}summary`), literal(content.summary)),
    quad(subject, namedNode(`${AS}published`), literal(published, dateTime)),
    // Own-origin provenance: THIS app/user generated the notification.
    quad(subject, namedNode(`${PROV}wasGeneratedBy`), activity),
    quad(activity, namedNode(`${RDF}type`), namedNode(`${PROV}Activity`)),
    quad(activity, namedNode(`${PROV}wasAssociatedWith`), namedNode(content.actorWebId)),
    quad(activity, namedNode(`${PROV}startedAtTime`), literal(published, dateTime)),
    quad(activity, namedNode(`${RDFS}label`), literal("solid-issues assignment/mention notification")),
  ];

  const writer = new Writer({
    format: "text/turtle",
    prefixes: { as: AS, prov: PROV, rdf: RDF, rdfs: RDFS },
  });
  for (const q of quads) writer.addQuad(q);
  return new Promise((resolve, reject) =>
    writer.end((err, result) => (err ? reject(err) : resolve(result))),
  );
}

/** Options threaded into the SSRF gate + the profile / inbox fetches. */
export interface AnnounceNetworkOptions {
  /**
   * The fetch to carry BOTH the profile read and the credentialed inbox POST.
   * Defaults to the (auth-patched) global `fetch` so the POST is DPoP-authed as
   * the acting user. Injected in tests.
   */
  fetch?: typeof fetch;
  /**
   * SSRF-policy options for `assertSafeUrl` on the WebID + inbox URL. Production
   * uses the strict browser-safe default (`{}`); tests inject `dnsLookup` to drive
   * the classification deterministically without real DNS.
   */
  guardOptions?: GuardOptions;
}

/**
 * Resolve a collaborator's `ldp:inbox` from their WebID profile, SSRF-validated
 * both ways (the WebID we dereference AND the inbox URL we would POST to). Returns
 * `undefined` when the profile advertises no inbox (fail-closed — the caller does
 * not notify). THROWS ({@link SsrfError}/{@link GuardError} from
 * `@jeswr/guarded-fetch`, or an {@link RdfFetchError}) when the WebID/inbox is
 * SSRF-unsafe or the profile can't be read — the caller treats that as a failed
 * (not skipped) notify.
 */
export async function resolveCollaboratorInbox(
  collaboratorWebId: string,
  options: AnnounceNetworkOptions = {},
): Promise<string | undefined> {
  // The discovery read is CREDENTIAL-BEARING (the auth-patched fetch) and the WebID
  // is foreign/untrusted data, so it goes through a guarded fetch that validates
  // the WebID host AND re-validates EVERY redirect hop (stripping credentials on a
  // cross-origin redirect). A poisoned assignee value (e.g. a WebID that resolves
  // or 30x-redirects to `169.254.169.254` / `localhost`) can therefore never drive
  // the authenticated profile fetch at an internal target — closing the discovery
  // redirect-SSRF that a bare `assertSafeUrl` on only the initial URL would leave.
  const discoveryFetch = createGuardedFetch({
    ...options.guardOptions,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  // NB: no custom request headers here. The WebID is CROSS-ORIGIN, so adding a
  // `Cache-Control` request header (as the own-pod reader does for same-origin
  // reads) would make this a non-simple CORS request, forcing an OPTIONS preflight
  // that many public profile servers reject — breaking discovery even for a
  // perfectly readable profile. A plain GET keeps it a simple CORS request; a
  // slightly-cached inbox URL is harmless (the `ldp:inbox` link rarely changes).
  const { dataset } = await fetchRdf(collaboratorWebId, { fetch: discoveryFetch });
  const inbox = new ProfileInbox(collaboratorWebId, dataset, DataFactory).inbox;
  if (!inbox) return undefined; // no inbox advertised → fail-closed, silent

  // The POST target host must itself be SSRF-safe (the inbox is server-controlled
  // data read off the profile). Refuses non-http(s), loopback/link-local/private,
  // cloud-metadata, userinfo, non-standard port. The credentialed POST
  // (`postToInbox`) refuses ALL redirects, so validating the target host here is
  // the POST's host gate.
  await assertSafeUrl(inbox, options.guardOptions);
  return inbox;
}

/**
 * POST a pre-serialised notification body to a collaborator's inbox. Self-guarding
 * (does NOT trust the caller): the target host is SSRF-validated with
 * `assertSafeUrl` at the POST site, and the write is issued through `refuseRedirects`
 * so the credentialed POST refuses ANY redirect (the DPoP credential never follows a
 * `Location` the target's server chose). Throws {@link SsrfError}/{@link GuardError}
 * for an unsafe target, {@link AnnounceError} on a non-2xx, and
 * {@link RedirectRefusedError} on a refused redirect.
 */
export async function postToInbox(
  inboxUrl: string,
  body: string,
  options: AnnounceNetworkOptions = {},
): Promise<void> {
  // Validate the credentialed-POST target host HERE (not only at discovery) so this
  // exported function can never be pointed at an internal / metadata target.
  await assertSafeUrl(inboxUrl, options.guardOptions);
  const post = refuseRedirects(options.fetch ?? fetch);
  const res = await post(inboxUrl, {
    method: "POST",
    headers: { "content-type": "text/turtle" },
    body,
  });
  if (!res.ok && res.status !== 205) {
    throw new AnnounceError(`Inbox POST failed (HTTP ${res.status}).`, inboxUrl, res.status);
  }
}

/** The outcome of one {@link sendAnnounce} attempt. */
export type SendResult =
  | { status: "sent"; inbox: string }
  | { status: "no-inbox" }
  | { status: "error"; stage: "resolve" | "post"; error: unknown };

/**
 * End-to-end: discover the target's inbox (SSRF-validated), build the AS2 Announce
 * body, and POST it (redirect-refusing). Never throws — returns a discriminated
 * {@link SendResult} so the (fire-and-forget) caller can distinguish a silent
 * `no-inbox` from a surfaced `error`.
 */
export async function sendAnnounce(
  content: AnnounceContent,
  options: AnnounceNetworkOptions = {},
): Promise<SendResult> {
  let inbox: string | undefined;
  try {
    inbox = await resolveCollaboratorInbox(content.targetWebId, options);
  } catch (error) {
    return { status: "error", stage: "resolve", error };
  }
  if (!inbox) return { status: "no-inbox" };

  try {
    const body = await buildAnnounceTurtle(content);
    await postToInbox(inbox, body, options);
    return { status: "sent", inbox };
  } catch (error) {
    return { status: "error", stage: "post", error };
  }
}

/** A concise human summary for an announce, given the (optional) issue title. */
export function defaultSummary(kind: AnnounceKind, issueTitle?: string): string {
  const t = issueTitle?.trim();
  if (kind === "assignment") {
    return t ? `You were assigned to "${t}"` : "You were assigned to an issue";
  }
  return t ? `You were mentioned in "${t}"` : "You were mentioned in a comment";
}

/** Construction options for {@link Announcer}. */
export interface AnnouncerOptions extends AnnounceNetworkOptions {
  /** The acting user's WebID (`as:actor`; also used to skip self-notification). */
  actorWebId: string;
  /**
   * Called when a notify genuinely FAILS (SSRF refusal, refused redirect, non-2xx,
   * unreadable profile) — NOT for the normal `no-inbox` case. The assignment /
   * comment itself already succeeded; this only surfaces the best-effort notify
   * failure (a non-intrusive toast in the app).
   */
  onError?: (message: string, detail: unknown) => void;
  /** Called after a notification is successfully delivered (telemetry / tests). */
  onSent?: (targetWebId: string, inbox: string) => void;
  /**
   * The ASSIGNMENT de-dupe set (keyed per `issue`+`assignee`). Injectable for
   * tests; defaults to a fresh per-instance Set so the SAME assignment is never
   * announced twice within a session. Mentions are per-comment events and do NOT
   * consult this set.
   */
  dedupe?: Set<string>;
}

/**
 * Session-scoped announcer: fire-and-forget, self-skipping, transition-gated, and
 * idempotent. Wired into the mutation hook so an assignment / @mention triggers a
 * notification without blocking (or ever failing) the underlying pod write.
 */
export class Announcer {
  private readonly dedupe: Set<string>;

  constructor(private readonly opts: AnnouncerOptions) {
    this.dedupe = opts.dedupe ?? new Set<string>();
  }

  /**
   * Announce an assignment — but ONLY when the assignee actually CHANGED to a new,
   * non-empty, non-self WebID (so re-saving an unchanged issue, clearing the
   * assignee, or self-assignment never notifies). Fire-and-forget.
   */
  announceAssignment(input: {
    issueUrl: string;
    issueTitle?: string;
    assignee?: string;
    previousAssignee?: string;
  }): void {
    const { assignee, previousAssignee } = input;
    if (!assignee) return; // cleared — nothing to announce
    if (assignee === previousAssignee) return; // unchanged — idempotent by transition
    if (this.isSelf(assignee)) return; // never notify yourself
    // Key the dedupe on the exact TRANSITION (prev -> new), NOT just the new
    // assignee: re-firing the SAME transition (a double-click / re-render) is a
    // no-op, but a genuine re-assignment BACK to a prior assignee (A -> B -> A) is
    // a DIFFERENT transition and is announced. `previousAssignee` must therefore be
    // the assignee value the write actually replaced (the update/inline paths pass
    // the exact pre-write value; create passes none, so the key is `-> new`).
    void this.dispatch("assignment", input.issueUrl, assignee, input.issueTitle, {
      dedupeKey: `assignment ${input.issueUrl} ${previousAssignee ?? ""} -> ${assignee}`,
    });
  }

  /**
   * Announce to each newly-@mentioned collaborator (self skipped; duplicate
   * targets WITHIN this comment collapsed). Each COMMENT is a distinct event, so
   * there is NO session-level de-dupe — a collaborator mentioned AGAIN in a later
   * comment on the same issue is notified again (unlike assignment, which is a
   * durable per-(issue,assignee) state). Fire-and-forget.
   */
  announceMentions(input: {
    issueUrl: string;
    issueTitle?: string;
    mentions: readonly string[];
  }): void {
    const seen = new Set<string>();
    for (const target of input.mentions) {
      if (!target || seen.has(target) || this.isSelf(target)) continue;
      seen.add(target); // collapse duplicates within THIS comment only
      void this.dispatch("mention", input.issueUrl, target, input.issueTitle, {});
    }
  }

  private isSelf(webId: string): boolean {
    return webId === this.opts.actorWebId;
  }

  /**
   * Resolve, build and post ONE notification, never throwing. With a `dedupeKey`
   * (assignment) the send is de-duped for the session; without one (mention) every
   * call sends (the caller has already collapsed intra-call duplicates).
   */
  private async dispatch(
    kind: AnnounceKind,
    issueUrl: string,
    targetWebId: string,
    issueTitle: string | undefined,
    options: { dedupeKey?: string },
  ): Promise<void> {
    const key = options.dedupeKey;
    if (key !== undefined) {
      if (this.dedupe.has(key)) return;
      // Reserve the key BEFORE awaiting so a concurrent identical fire can't
      // double-post. A genuine failure releases it (a later retry is allowed); a
      // successful send or a silent no-inbox keeps it (never re-announced).
      this.dedupe.add(key);
    }

    const result = await sendAnnounce(
      {
        kind,
        actorWebId: this.opts.actorWebId,
        objectIri: issueUrl,
        targetWebId,
        summary: defaultSummary(kind, issueTitle),
      },
      { fetch: this.opts.fetch, guardOptions: this.opts.guardOptions },
    );

    if (result.status === "sent") {
      this.opts.onSent?.(targetWebId, result.inbox);
    } else if (result.status === "error") {
      if (key !== undefined) this.dedupe.delete(key);
      const verb = kind === "assignment" ? "assignee" : "mentioned collaborator";
      this.opts.onError?.(`Couldn't notify the ${verb}.`, result.error);
    }
    // "no-inbox": the collaborator advertises no inbox — silent, key kept.
  }
}
