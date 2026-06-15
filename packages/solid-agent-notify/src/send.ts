// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * send.ts — POST an ActivityStreams 2.0 notification to an LDN inbox.
 *
 * SECURITY. The POST target is an LDN inbox URL — either supplied directly
 * ({@link sendNotification}) or discovered from a recipient's profile
 * ({@link notifyAgent}). In BOTH cases the actual POST goes through the DNS-pinned
 * {@link guardedFetch} chokepoint, so the inbox host is resolved + classified +
 * pinned and a private/metadata/loopback target is refused. Critically, the
 * chokepoint REFUSES to follow ANY 3xx on a POST — so a validated-public inbox
 * that answers with a redirect to `169.254.169.254` / a private host cannot bounce
 * the authenticated POST (and any auth header an injected `fetchImpl` attaches) to
 * a blocked origin. This closes the rebinding + redirect gaps the Pod Manager's
 * original host-string validator left open.
 *
 * LDN: an inbox accepts `POST text/turtle`. The receipt (201/202/200) is not RDF
 * we parse, so the guard bounds its body but does not impose the RDF allowlist.
 */
import {
  type ActivityNotification,
  type ActivityType,
  buildActivity,
  serializeTurtle,
} from "./activity.js";
import { MAX_BYTES_RESPONSE } from "./config.js";
import { type NotifyOptions, discoverInbox } from "./discover.js";
import { NoInboxError, NotificationSendError } from "./errors.js";
import {
  type GuardedFetchOptions,
  type GuardedFetchResult,
  guardedFetch,
} from "./security/guardedFetch.js";

/** Result of a successful send: the inbox that accepted the notification + its status. */
export interface SendResult {
  /** The inbox URL that was posted to (its final, resolved form). */
  inbox: string;
  /** The 2xx status the inbox answered with. */
  status: number;
}

/**
 * POST a pre-built AS2.0 notification to a KNOWN LDN inbox URL.
 *
 * The inbox URL still goes through the DNS-pinned guard (it may be
 * attacker-influenced — e.g. discovered from a recipient profile elsewhere), so a
 * private/loopback/metadata target, a non-https scheme, a non-443 port, or a POST
 * redirect is refused. Throws {@link NotificationSendError} on a non-2xx (or a
 * refused redirect / network error surfaced through the guard).
 *
 * @param inbox    the recipient's LDN inbox URL.
 * @param activity the notification to send (`type` defaults to `Announce`,
 *                 `published` to now).
 */
export async function sendNotification(
  inbox: string,
  activity: ActivityNotification,
  opts: NotifyOptions = {}
): Promise<SendResult> {
  const store = buildActivity({
    ...activity,
    type: (activity.type ?? "Announce") as ActivityType,
  });
  // ADVANCED: let a caller augment the dataset (e.g. embed a wf:Task) before
  // serialise — the single place the on-the-wire body is built. AWAITED so an
  // async extend's mutations are complete before we serialise + POST.
  await opts.extend?.(store);
  const body = await serializeTurtle(store);

  const fetcher = opts.fetchImpl ?? guardedFetch;
  let res: GuardedFetchResult;
  try {
    const init: GuardedFetchOptions = {
      method: "POST",
      body,
      headers: { "content-type": "text/turtle" },
      maxBytes: MAX_BYTES_RESPONSE,
      skipContentTypeAllowlist: true,
      maxRedirects: 0,
      ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
      ...(opts.allowLoopback !== undefined
        ? { allowLoopback: opts.allowLoopback }
        : {}),
      ...(opts.dnsLookup !== undefined ? { dnsLookup: opts.dnsLookup } : {}),
    };
    res = await fetcher(inbox, init);
  } catch (error: unknown) {
    // A guard refusal (SSRF / scheme / port / refused redirect / network) means the
    // delivery did not happen — surface it as a send failure carrying the inbox.
    throw new NotificationSendError(inbox, 0, { cause: error });
  }

  if (res.status < 200 || res.status >= 300) {
    throw new NotificationSendError(res.finalUrl || inbox, res.status);
  }
  return { inbox: res.finalUrl || inbox, status: res.status };
}

/** Arguments for {@link notifyAgent}. */
export interface NotifyAgentArgs {
  /** The recipient agent's WebID — its inbox is DISCOVERED from the profile. */
  recipientWebId: string;
  /** The sender's WebID — written as `as:actor`. */
  actorWebId: string;
  /** Activity verb; defaults to `Announce`. */
  type?: ActivityType;
  object?: string;
  target?: string;
  summary?: string;
  content?: string;
  published?: Date;
}

/**
 * Discover a recipient's inbox from their WebID profile, then deliver an AS2.0
 * notification to it — the end-to-end convenience over {@link discoverInbox} +
 * {@link sendNotification}.
 *
 * Order matters: discovery runs FIRST and a missing inbox throws
 * {@link NoInboxError} before any body is built or POST issued.
 *
 * @throws NoInboxError          the recipient advertises no (or an ambiguous) inbox.
 * @throws NotificationSendError the inbox refused the POST (non-2xx / guard refusal).
 */
export async function notifyAgent(
  args: NotifyAgentArgs,
  opts: NotifyOptions = {}
): Promise<SendResult> {
  const inbox = await discoverInbox(args.recipientWebId, opts);
  if (!inbox) throw new NoInboxError(args.recipientWebId);

  const activity: ActivityNotification = {
    type: args.type ?? "Announce",
    actor: args.actorWebId,
    ...(args.object !== undefined ? { object: args.object } : {}),
    ...(args.target !== undefined ? { target: args.target } : {}),
    ...(args.summary !== undefined ? { summary: args.summary } : {}),
    ...(args.content !== undefined ? { content: args.content } : {}),
    ...(args.published !== undefined ? { published: args.published } : {}),
  };
  return sendNotification(inbox, activity, opts);
}
