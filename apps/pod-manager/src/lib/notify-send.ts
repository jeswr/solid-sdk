// AUTHORED-BY Codex GPT-6.1-Sol
/** Pod Manager's UI error adapter; discovery, serialization and delivery live in the SDK. */
import { createNotify, type NotificationDraft } from "@jeswr/pod-access/notify";
import { NoInboxError, NotificationSendError } from "./errors.js";

export type ActivityType = NotificationDraft["type"];
export interface SendNotificationArgs {
  recipientWebId: string;
  actorWebId: string;
  type?: ActivityType;
  object?: string;
  target?: string;
  summary?: string;
  content?: string;
}

export async function sendNotification(
  args: SendNotificationArgs,
  fetchImpl?: typeof fetch,
): Promise<{ inbox: string }> {
  const draft: NotificationDraft = {
    type: args.type ?? "Announce",
    object: args.object,
    target: args.target,
    summary: args.summary?.trim() || undefined,
    content: args.content?.trim() || undefined,
  };
  const result = await createNotify({ fetch: fetchImpl ?? globalThis.fetch })(args.recipientWebId, {
    ...draft,
    actor: args.actorWebId,
  });
  if (result.delivered && result.inbox) return { inbox: result.inbox };
  if (result.reason === "no-inbox" || result.reason === "lws-no-ldn") {
    throw new NoInboxError(args.recipientWebId);
  }
  throw new NotificationSendError(
    result.inbox ?? args.recipientWebId,
    result.reason === "forbidden" ? 403 : 0,
  );
}
