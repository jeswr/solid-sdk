// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import {
  createNotify,
  type NotificationDraft,
  type NotifyOptions,
  type NotifyResult,
} from "@jeswr/pod-access/notify";
import { usePodAuth } from "@jeswr/pod-auth/react";
import { useLayoutEffect, useMemo, useRef } from "react";

export type {
  InboxNotification,
  InboxReaderOptions,
  NotificationDraft,
  NotifyActivity,
  NotifyOptions,
  NotifyResult,
} from "@jeswr/pod-access/notify";
export {
  assignmentAnnounce,
  mentionNotification,
  notificationKind,
  roomInvitation,
  shareNotification,
} from "@jeswr/pod-access/notify";
export type { UseInboxResult } from "./use-inbox.js";
export { useInbox } from "./use-inbox.js";

/** Deliver a template using the current actor, or a complete activity with an explicit actor. */
export type NotifyAction = (
  agentWebId: string,
  activity: NotificationDraft & { actor?: string },
) => Promise<NotifyResult>;

/**
 * Read the PodAuthProvider's fetch and actor. Reset the inbox cache whenever session identity
 * changes, including logout/login as the same account. Options describe recipients, not the sender.
 */
export function useNotify(options: Omit<NotifyOptions, "fetch"> = {}): NotifyAction {
  const { fetch, identity } = usePodAuth();
  const { clock, recipientProtocol, pinningFetch } = options;
  const active = useRef<object | null>(null);
  const state = useMemo(() => {
    const session = {};
    const scoped =
      (transport: typeof fetch): typeof fetch =>
      async (input, init) => {
        if (active.current !== session) throw new Error("Notification session changed");
        return transport(input, init);
      };
    const notify = createNotify({
      fetch: scoped(fetch),
      clock,
      recipientProtocol,
      pinningFetch: pinningFetch === undefined ? undefined : scoped(pinningFetch),
    });
    const action: NotifyAction = async (agentWebId, activity) => {
      const actor = activity.actor ?? identity?.webId;
      if (!actor) return { delivered: false, inbox: null, reason: "network" };
      return notify(agentWebId, { ...activity, actor });
    };
    return { session, action };
  }, [fetch, identity, clock, recipientProtocol, pinningFetch]);
  // Only committed renders may activate a session. Revoke it on replacement or unmount.
  useLayoutEffect(() => {
    active.current = state.session;
    return () => {
      active.current = null;
    };
  }, [state]);
  return state.action;
}
