// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
"use client";
import { checkOwnerOnly, createOwnerOnlyDestinationVerifier } from "@jeswr/pod-access";
import { createPodClient } from "@jeswr/storage-client";
import {
  Button,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  toast,
} from "@jeswr/suite-ui";
import { MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, type Ref, useRef, useState } from "react";
import { encodeRef } from "@/lib/refs";
import { sessionCapabilitiesCache } from "@/lib/session/capabilities-cache";
import {
  CopyToDocsPrivacyError,
  createNoteDocsConverter,
  type NoteDocsMode,
} from "../lib/copy-to-docs";
import type { StoredNote } from "../lib/model/store";
import { useNotesContext } from "../state/notes-context";
import { ConfirmDialog } from "./controls";

export function NoteDocsActions({
  disabled,
  run,
  onCopied,
  children,
  open,
  onOpenChange,
  triggerRef,
  onCloseAutoFocus,
}: {
  disabled: boolean;
  run: (work: (saved: StoredNote) => Promise<void>) => unknown;
  onCopied?: () => void;
  children?: ReactNode;
  /** Let the host own the single "More note actions" menu's open state, trigger and focus return. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  triggerRef?: Ref<HTMLButtonElement>;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const { session, store, move } = useNotesContext();
  const converter = useRef(createNoteDocsConverter());
  const storage = useRef<ReturnType<typeof openStorage>>(undefined);
  const openStorage = () =>
    sessionCapabilitiesCache(session)
      .then((capabilities) =>
        createPodClient({ fetch: session.fetch, storage: session.storageUrl, capabilities }),
      )
      .then((opened) => opened.storage);
  const privacy = () => {
    storage.current ??= openStorage();
    const open = () => storage.current as ReturnType<typeof openStorage>;
    return {
      destinationIsOwnerOnly: createOwnerOnlyDestinationVerifier({
        podRoot: session.storageUrl,
        ownerWebId: session.webId,
        openStorage: open,
      }),
      // Only a note proven shared (every reason a non-owner grant) may go to a looser Docs.
      noteTreatedAsPrivate: async (url: string) => {
        const result = await checkOwnerOnly({
          storage: await open(),
          url,
          ownerWebId: session.webId,
        });
        return result.private || result.reasons.some((reason) => reason.reason !== "non-owner");
      },
    };
  };
  const [ownOpen, setOwnOpen] = useState(false);
  const menuOpen = open ?? ownOpen;
  const setMenuOpen = (value: boolean) => {
    setOwnOpen(value);
    onOpenChange?.(value);
  };
  const [confirmMove, setConfirmMove] = useState(false);
  const router = useRouter();
  const convert = (mode: NoteDocsMode) =>
    Promise.resolve(
      run(async (saved) => {
        let document: Awaited<ReturnType<typeof converter.current>>;
        try {
          document = await converter.current(saved, mode, {
            fetchImpl: session.fetch,
            podRoot: session.storageUrl,
            webId: session.webId,
            assertMovable: (note) => store.assertMovable(note),
            trash: (note) => move(note, "trash"),
            ...privacy(),
          });
        } catch (error) {
          if (!(error instanceof CopyToDocsPrivacyError)) throw error;
          // Nothing was written. Say why, and release the editor lock the caller holds.
          toast.error(error.message);
          onCopied?.();
          return;
        }
        const href = `/docs/d/${encodeRef(document.url)}`;
        if (mode === "copy") {
          toast.success("Copied to Docs", { action: <Link href={href}>Open document</Link> });
          onCopied?.();
        } else router.push(href);
      }),
    );
  return (
    <>
      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverTrigger asChild>
          <IconButton
            ref={triggerRef}
            label="More note actions"
            variant="ghost"
            disabled={disabled}
          >
            <MoreHorizontal size={17} aria-hidden="true" />
          </IconButton>
        </PopoverTrigger>
        <PopoverContent
          className="notes-popover notes-more-menu"
          aria-label="More note actions"
          {...(onCloseAutoFocus && { onCloseAutoFocus })}
        >
          <Button
            variant="ghost"
            disabled={disabled}
            onClick={() => {
              setMenuOpen(false);
              void convert("copy");
            }}
          >
            Copy to Docs
          </Button>
          <Button
            variant="ghost"
            disabled={disabled}
            onClick={() => {
              setMenuOpen(false);
              setConfirmMove(true);
            }}
          >
            Move to Docs
          </Button>
          {children}
        </PopoverContent>
      </Popover>
      {confirmMove && (
        <ConfirmDialog
          title="Move to Docs?"
          description="This note moves to Trash in Notes, and you can restore it from there."
          close={() => setConfirmMove(false)}
          confirm={() => convert("move")}
        />
      )}
    </>
  );
}
