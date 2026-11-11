// AUTHORED-BY Codex GPT-6.1-Sol
import { createNotify } from "@jeswr/pod-access/notify";
import { type ChipRef, createMentionNotifier, textChips } from "@jeswr/suite-sdk/chips";
import type { PodSession } from "./session/pod-session";

const notifiers = new WeakMap<typeof fetch, ReturnType<typeof createMentionNotifier>>();

/** Call only with acknowledged saved content, using the active session's transport. */
export async function notifySavedChips(
  session: Pick<PodSession, "fetch" | "webId">,
  resource: string,
  refs: readonly ChipRef[],
  excerpt: string,
) {
  let notify = notifiers.get(session.fetch);
  if (!notify) {
    notify = createMentionNotifier({
      actor: session.webId,
      notify: createNotify({ fetch: session.fetch }),
      receipts: localStorage,
    });
    notifiers.set(session.fetch, notify);
  }
  await notify(resource, refs, excerpt);
}

export function htmlChipRefs(html: string): ChipRef[] {
  const document = new window.DOMParser().parseFromString(html, "text/html");
  return [
    ...document.querySelectorAll<HTMLAnchorElement>('a[data-chip][data-chip-kind="person"]'),
  ].map((anchor) => ({
    iri: anchor.href,
    kind: "person",
    label: anchor.getAttribute("data-chip-label") ?? anchor.textContent ?? "",
  }));
}

export async function notifySavedHtml(
  session: Pick<PodSession, "fetch" | "webId">,
  resource: string,
  html: string,
) {
  return notifySavedChips(
    session,
    resource,
    htmlChipRefs(html),
    new window.DOMParser().parseFromString(html, "text/html").body.textContent ?? "",
  );
}
export async function notifySavedText(
  session: Pick<PodSession, "fetch" | "webId">,
  resource: string,
  text: string,
) {
  return notifySavedChips(
    session,
    resource,
    textChips(text).map((entry) => entry.ref),
    text,
  );
}
