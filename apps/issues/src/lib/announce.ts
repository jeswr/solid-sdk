// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Fable 5
/** Issues notification policy: transition dedupe, self skipping and best-effort feedback. */
import {
  createNotify,
  issueAnnounce,
  type NotificationDraft,
  type NotifyOptions,
} from "@jeswr/pod-access/notify";

export type AnnounceKind = "assignment" | "mention";
export interface AnnounceContent {
  kind: AnnounceKind;
  actorWebId: string;
  objectIri: string;
  targetWebId: string;
  summary: string;
}
export type AnnounceNetworkOptions = Partial<Pick<NotifyOptions, "fetch" | "pinningFetch">>;
export type SendResult =
  | { status: "sent"; inbox: string }
  | { status: "no-inbox" }
  | { status: "error"; stage: "resolve" | "post"; error: unknown };

/** Delivery and its recipient cache belong to the SDK's authenticated transport. */
export async function sendAnnounce(
  content: AnnounceContent,
  options: AnnounceNetworkOptions = {},
): Promise<SendResult> {
  const draft: NotificationDraft = issueAnnounce(
    content.objectIri,
    content.targetWebId,
    content.summary,
  );
  const result = await createNotify({ ...options, fetch: options.fetch ?? globalThis.fetch })(
    content.targetWebId,
    { ...draft, actor: content.actorWebId },
  );
  if (result.delivered && result.inbox) return { status: "sent", inbox: result.inbox };
  if (result.reason === "no-inbox" || result.reason === "lws-no-ldn") return { status: "no-inbox" };
  return { status: "error", stage: result.inbox ? "post" : "resolve", error: result };
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
      { fetch: this.opts.fetch, pinningFetch: this.opts.pinningFetch },
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
