// AUTHORED-BY Codex GPT-6.1-Sol
import {
  createNotify,
  mentionNotification as mentionDraft,
  type NotificationDraft,
  type Notify,
} from "@jeswr/pod-access/notify";
import { type ChipRef, chipIri, mentionKey, textChips } from "./core.js";

/** Only titles belong in inboxes; the body may contain private information. */
export function mentionNotification(
  resource: string,
  mentionedWebId: string,
  title: string,
): NotificationDraft {
  if (!chipIri(resource) || !chipIri(mentionedWebId)) throw new TypeError("Invalid mention IRI");
  return { ...mentionDraft(resource, resource), summary: `Mentioned you: ${title.slice(0, 120)}` };
}

/** Exact person identities newly present in a local edit, independent of labels/order. */
export function addedChipRefs(before: readonly ChipRef[], after: readonly ChipRef[]): ChipRef[] {
  const seen = new Set(before.filter((ref) => ref.kind === "person").map((ref) => ref.iri));
  return after.filter((ref) => {
    if (ref.kind !== "person" || !chipIri(ref.iri) || seen.has(ref.iri)) return false;
    seen.add(ref.iri);
    return true;
  });
}

/** getAttribute deliberately avoids resolving missing/relative hrefs against the application. */
export function htmlChipRefs(html: string): ChipRef[] {
  const document = new window.DOMParser().parseFromString(html, "text/html");
  return [...document.querySelectorAll('a[data-chip][data-chip-kind="person"]')].flatMap(
    (anchor) => {
      const iri = anchor.getAttribute("href");
      return iri && chipIri(iri)
        ? [
            {
              iri,
              kind: "person" as const,
              label: anchor.getAttribute("data-chip-label") ?? anchor.textContent,
            },
          ]
        : [];
    },
  );
}

/** Validate before claiming; isolate bad refs, receipt failures and ambiguous transport results. */
export function createMentionNotifier(options: {
  actor: string;
  notify: Notify;
  receipts: Pick<Storage, "getItem" | "setItem">;
}) {
  const claimed = new Set<string>();
  return async (resource: string, refs: readonly ChipRef[], title: string): Promise<void> => {
    for (const ref of refs) {
      try {
        if (ref.kind !== "person" || ref.iri === options.actor) continue;
        const draft = { ...mentionNotification(resource, ref.iri, title), actor: options.actor };
        if (!chipIri(options.actor)) continue;
        const key = `${options.actor}:${mentionKey(resource, ref.iri)}`;
        if (claimed.has(key) || options.receipts.getItem(key)) continue;
        options.receipts.setItem(key, "attempted");
        claimed.add(key);
        await options.notify(ref.iri, draft);
      } catch {
        // No retry after an ambiguous send; one failure must not suppress later people.
      }
    }
  };
}

export interface MentionSession {
  fetch: typeof fetch;
  webId: string;
}
const notifiers = new WeakMap<
  typeof fetch,
  Map<string, ReturnType<typeof createMentionNotifier>>
>();

/** Call only after an acknowledged local save. Pass the content as loaded/last saved. */
export async function notifySavedChips(
  session: MentionSession,
  resource: string,
  before: readonly ChipRef[],
  after: readonly ChipRef[],
  title: string,
): Promise<void> {
  const added = addedChipRefs(before, after);
  if (!added.length) return;
  let actors = notifiers.get(session.fetch);
  if (!actors) {
    actors = new Map();
    notifiers.set(session.fetch, actors);
  }
  let notify = actors.get(session.webId);
  if (!notify) {
    notify = createMentionNotifier({
      actor: session.webId,
      notify: createNotify({ fetch: session.fetch }),
      receipts: localStorage,
    });
    actors.set(session.webId, notify);
  }
  await notify(resource, added, title);
}
export function notifySavedHtml(
  session: MentionSession,
  resource: string,
  before: string,
  after: string,
  title: string,
): Promise<void> {
  return notifySavedChips(session, resource, htmlChipRefs(before), htmlChipRefs(after), title);
}
export function notifySavedText(
  session: MentionSession,
  resource: string,
  before: string,
  after: string,
  title: string,
): Promise<void> {
  return notifySavedChips(
    session,
    resource,
    textChips(before).map((entry) => entry.ref),
    textChips(after).map((entry) => entry.ref),
    title,
  );
}
