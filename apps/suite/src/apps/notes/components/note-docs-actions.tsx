// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
"use client";
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
import { type ReactNode, useRef, useState } from "react";
import { encodeRef } from "@/lib/refs";
import { createNoteDocsConverter, type NoteDocsMode } from "../lib/copy-to-docs";
import type { StoredNote } from "../lib/model/store";
import { useNotesContext } from "../state/notes-context";
import { ConfirmDialog } from "./controls";

export function NoteDocsActions({
  disabled,
  run,
  onCopied,
  children,
}: {
  disabled: boolean;
  run: (work: (saved: StoredNote) => Promise<void>) => unknown;
  onCopied?: () => void;
  children?: ReactNode;
}) {
  const { session, store, move } = useNotesContext();
  const converter = useRef(createNoteDocsConverter());
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmMove, setConfirmMove] = useState(false);
  const router = useRouter();
  const convert = (mode: NoteDocsMode) =>
    Promise.resolve(
      run(async (saved) => {
        const document = await converter.current(saved, mode, {
          fetchImpl: session.fetch,
          podRoot: session.storageUrl,
          webId: session.webId,
          assertMovable: (note) => store.assertMovable(note),
          trash: (note) => move(note, "trash"),
        });
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
          <IconButton label="More note actions" variant="ghost" disabled={disabled}>
            <MoreHorizontal size={17} aria-hidden="true" />
          </IconButton>
        </PopoverTrigger>
        <PopoverContent className="notes-popover notes-more-menu" aria-label="More note actions">
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
