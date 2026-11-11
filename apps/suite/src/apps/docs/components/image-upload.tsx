// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex
"use client";
import { Button, Input, Popover, PopoverAnchor } from "@jeswr/suite-ui";
import type { Editor } from "@tiptap/react";
import { useEffect, useId, useRef, useState } from "react";
import type { RichImageTransfer } from "../editor/image-transfer";
import type { DocumentPersistence } from "../editor/persistence";
import { uploadPodImage } from "../lib/editor/image-upload";
import { insertionAnchor } from "../lib/editor/insertion-anchor";
import { docContainerUrls } from "../lib/model";
import { EditorPopoverContent } from "./editor-popover-content";
export function ImageUpload({
  editor,
  runtime,
  uploadFile,
  className,
  file: initialFile,
  transfer,
  close,
}: {
  editor: Editor;
  className?: string;
  file: File | null;
  transfer?: RichImageTransfer | undefined;
  close: () => void;
} & (
  | { runtime: DocumentPersistence; uploadFile?: undefined }
  | { runtime?: undefined; uploadFile: (file: File) => Promise<string> }
)) {
  const id = useId();
  const [index, setIndex] = useState(0);
  const file = transfer?.images[index]?.file ?? initialFile;
  const [alt, setAlt] = useState(
    transfer?.images[0]?.alt ?? (file ? "" : String(editor.getAttributes("image").alt ?? "")),
  );
  const [decorative, setDecorative] = useState(false);
  const [state, setState] = useState<"idle" | "uploading" | "error">("idle");
  const selectionAnchor = useRef<ReturnType<typeof insertionAnchor> | undefined>(undefined);
  const insertFragment = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {
    // Plain and rich pastes retain the same selection through alt entry,
    // asynchronous saves/uploads, and retries, until the dialog is dismissed.
    const anchor = insertionAnchor(editor);
    selectionAnchor.current = anchor;
    insertFragment.current = () => {
      if (!transfer || editor.isDestroyed) return;
      // Run the usual paste normalization and URL filters on the retained fragment.
      anchor.insert(() => editor.view.pasteHTML(transfer.fragment.innerHTML));
    };
    return () => {
      anchor.release();
      selectionAnchor.current = undefined;
      insertFragment.current = undefined;
    };
  }, [editor, transfer]);
  const cancel = () => {
    // Keep the rich text and completed uploads if the user declines the remaining images.
    for (const image of transfer?.images.slice(index) ?? [])
      for (const element of image.elements) element.remove();
    insertFragment.current?.();
    close();
  };
  const upload = async () => {
    if (!decorative && !alt.trim()) return;
    if (!file) {
      // Mutations retain the selection; EditorPopoverContent alone restores
      // focus on close, respecting outside interactions during an upload.
      editor
        .chain()
        .updateAttributes("image", { alt: decorative ? "" : alt })
        .run();
      close();
      return;
    }
    const anchor = selectionAnchor.current;
    if (!anchor) return;
    setState("uploading");
    try {
      let src: string;
      if (uploadFile) src = await uploadFile(file);
      else {
        if (!runtime.stored) {
          runtime.change(editor.getHTML(), editor.getJSON());
          await runtime.flush();
        }
        if (!runtime.stored) throw new Error("Document not saved");
        src = await uploadPodImage(
          file,
          docContainerUrls(runtime.stored.url).assets,
          runtime.session.fetch,
        );
      }
      if (editor.isDestroyed) return;
      if (transfer) {
        for (const element of transfer.images[index]?.elements ?? []) {
          element.setAttribute("src", src);
          element.setAttribute("alt", decorative ? "" : alt.trim());
        }
        const next = transfer.images[index + 1];
        if (next) {
          setIndex(index + 1);
          setAlt(next.alt);
          setDecorative(false);
          setState("idle");
        } else {
          insertFragment.current?.();
          close();
        }
        return;
      }
      anchor.insert(() =>
        editor
          .chain()
          .insertContent({
            type: "image",
            attrs: { src, alt: decorative ? "" : alt.trim() },
          })
          .run(),
      );
      close();
    } catch {
      setState("error");
    }
  };
  return (
    <Popover
      open
      onOpenChange={(open) => {
        if (!open && state !== "uploading") cancel();
      }}
    >
      <PopoverAnchor asChild>
        <span className="docs-popover-anchor" />
      </PopoverAnchor>
      <EditorPopoverContent editor={editor} aria-label="Image alt text" className={className}>
        <form
          className="docs-form"
          onSubmit={(event) => {
            event.preventDefault();
            void upload();
          }}
        >
          <h2>Alt text</h2>
          {transfer && transfer.images.length > 1 && (
            <p>
              Image {index + 1} of {transfer.images.length}
            </p>
          )}
          <label htmlFor={`${id}-alt`}>Describe this image for people who can't see it</label>
          <Input
            id={`${id}-alt`}
            autoFocus
            required={!decorative}
            disabled={decorative || state === "uploading"}
            value={alt}
            onChange={(event) => setAlt(event.target.value)}
          />
          <label className="docs-checkbox">
            <input
              type="checkbox"
              checked={decorative}
              disabled={state === "uploading"}
              onChange={(event) => setDecorative(event.target.checked)}
            />
            Decorative
          </label>
          {state === "uploading" && (
            <div className="docs-upload-placeholder" role="status">
              Uploading image…
            </div>
          )}
          {state === "error" && <p role="alert">We couldn't upload this image. Try again.</p>}
          <Button type="submit" disabled={state === "uploading" || (!decorative && !alt.trim())}>
            {state === "error" ? "Retry" : file ? "Insert image" : "Save alt text"}
          </Button>
          <Button variant="ghost" disabled={state === "uploading"} onClick={cancel}>
            {state === "error" ? "Remove" : "Cancel"}
          </Button>
        </form>
      </EditorPopoverContent>
    </Popover>
  );
}
