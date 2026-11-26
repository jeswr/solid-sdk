// AUTHORED-BY Claude Sonnet 5.5
"use client";
import { useEffect } from "react";
import { onBeforeSignOut } from "@/shell/session/sign-out-cleanup";
import { ownerOf, revokeDrafts } from "./draft";

/**
 * Mounted once in the shell: an account's feedback draft (transcript, name, email) must not
 * outlive its session, whichever page is open when it signs out, and a submit still running
 * must not write it back.
 */
export function FeedbackDraftCleanup() {
  useEffect(
    () =>
      onBeforeSignOut(async (account) => {
        let storage: Storage | undefined;
        try {
          storage = localStorage;
        } catch {
          /* Private browsing may block storage. */
        }
        revokeDrafts(storage, ownerOf(account.id));
      }),
    [],
  );
  return null;
}
