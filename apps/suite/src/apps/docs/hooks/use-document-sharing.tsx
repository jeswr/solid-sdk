// AUTHORED-BY Codex GPT-6.1
"use client";

import { isRoleError } from "@jeswr/pod-access/roles";
import { Button } from "@jeswr/suite-ui";
import { Share2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { encodeRef } from "@/lib/refs";
import { ShareDialog } from "../../drive/components/share-dialog";
import { loadSharing, type SharingSession } from "../../drive/lib/sharing/adapter";
import { Hint } from "../components/common";

const COMPANION_NOTICE =
  'Sharing currently changes only this document\'s main resource. Its update log, assets and comments keep their existing permissions. Collaborators may not be able to open the document or see its images and comments, and their edits may not save. This also applies to "Anyone with the link".';
const OWNER_REASON = "Only the owner can change sharing.";

function permissionFailureReason(error: unknown): string | undefined {
  if (error instanceof Error && error.cause !== undefined)
    return permissionFailureReason(error.cause);
  if (isRoleError(error)) {
    if (error.code === "scope") return OWNER_REASON;
    // The SDK's RoleError exposes HTTP status only in this message, not as a field.
    const status = /^Access request failed \((\d{3})\):/.exec(error.message)?.[1];
    if (status === "401" || status === "403") return OWNER_REASON;
    if (status?.startsWith("5")) return undefined;
  } else if (error instanceof TypeError) return undefined; // Fetch network failures.
  return "Sharing is unavailable for this document.";
}

/** Both editor entry points share one dialog and the Drive adapter's permission decision. */
export function useDocumentSharing(
  session: SharingSession,
  resource: string | undefined,
  title: string,
  online: boolean,
  readOnly: boolean,
) {
  const [access, setAccess] = useState<{
    session: SharingSession;
    resource: string;
    reason: string | undefined;
  }>();
  const [shown, setShown] = useState(false);
  const origin = useRef<HTMLElement | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: document and account changes dismiss the previous resource's dialog
  useEffect(() => {
    setShown(false);
  }, [session, resource]);
  useEffect(() => {
    let live = true;
    setAccess(undefined);
    if (resource && online && !readOnly) {
      const resolved = (reason: string | undefined) => {
        if (live) setAccess({ session, resource, reason });
      };
      void loadSharing(session, resource).then(
        (snapshot) =>
          resolved(snapshot.canManage ? undefined : (snapshot.readOnly ?? OWNER_REASON)),
        (error: unknown) => resolved(permissionFailureReason(error)),
      );
    }
    return () => {
      live = false;
    };
  }, [session, resource, online, readOnly]);
  const disabledReason = !resource
    ? "Save this document to your pod before sharing."
    : readOnly
      ? "Read-only documents cannot be shared."
      : !online
        ? "Reconnect to manage sharing."
        : access?.session !== session || access.resource !== resource
          ? "Checking sharing permissions…"
          : access.reason;
  const open = () => {
    if (disabledReason) return;
    origin.current = document.activeElement as HTMLElement | null;
    setShown(true);
  };
  const reasonId = useId();
  const button = (
    <Button
      className="docs-share aria-disabled:opacity-50"
      aria-label="Share"
      aria-haspopup="dialog"
      aria-disabled={!!disabledReason}
      aria-describedby={disabledReason ? reasonId : undefined}
      onClick={open}
    >
      <Share2 aria-hidden="true" />
      <span>Share</span>
    </Button>
  );
  return {
    open,
    disabledReason,
    // The tooltip shows the reason on hover and focus; the description gives it to
    // screen readers on the focused button too.
    button: (
      <>
        <Hint text={disabledReason}>{button}</Hint>
        {disabledReason && (
          <span id={reasonId} className="su-sr-only">
            {disabledReason}
          </span>
        )}
      </>
    ),
    dialog:
      shown && resource ? (
        <ShareDialog
          item={{ url: resource, name: title || "Untitled document" }}
          session={session}
          link={`/docs/d/${encodeRef(resource)}`}
          notice={COMPANION_NOTICE}
          disabledReason={disabledReason}
          onClose={() => setShown(false)}
          onSaved={() => {}}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            origin.current?.focus();
          }}
        />
      ) : null,
  };
}
