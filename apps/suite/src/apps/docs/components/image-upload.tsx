// AUTHORED-BY Codex
"use client";
import { Button, Input, Popover, PopoverAnchor } from "@jeswr/suite-ui";
import type { Editor, EditorEvents } from "@tiptap/react";
import { useEffect, useId, useRef, useState } from "react";
import type { RichImageTransfer } from "../editor/image-transfer";
import type { DocumentPersistence } from "../editor/persistence";
import { insertionAnchor } from "../lib/editor/insertion-anchor";
import { docContainerUrls } from "../lib/model";
import { EditorPopoverContent } from "./editor-popover-content";
export function ImageUpload({
  editor,
  runtime,
  file: initialFile,
  transfer,
  close,
}: {
  editor: Editor;
  runtime: DocumentPersistence;
  file: File | null;
  transfer?: RichImageTransfer;
  close: () => void;
}) {
  const id = useId();
  const [index, setIndex] = useState(0);
  const file = transfer?.images[index]?.file ?? initialFile;
  const [alt, setAlt] = useState(
    transfer?.images[0]?.alt ?? (file ? "" : String(editor.getAttributes("image").alt ?? "")),
  );
  const [decorative, setDecorative] = useState(false);
  const [state, setState] = useState<"idle" | "uploading" | "error">("idle");
  const insertFragment = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {
    if (!transfer) return;
    let bookmark = editor.state.selection.getBookmark();
    const map = ({ transaction, appendedTransactions }: EditorEvents["transaction"]) => {
      for (const applied of [transaction, ...appendedTransactions])
        bookmark = bookmark.map(applied.mapping);
    };
    editor.on("transaction", map);
    insertFragment.current = () => {
      if (editor.isDestroyed) return;
      editor.view.dispatch(editor.state.tr.setSelection(bookmark.resolve(editor.state.doc)));
      // Run the usual paste normalization and URL filters on the retained fragment.
      editor.view.pasteHTML(transfer.fragment.innerHTML);
    };
    return () => {
      editor.off("transaction", map);
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
      editor
        .chain()
        .focus()
        .updateAttributes("image", { alt: decorative ? "" : alt })
        .run();
      close();
      return;
    }
    setState("uploading");
    const anchor = insertionAnchor(editor);
    try {
      if (!runtime.stored) {
        runtime.change(editor.getHTML(), editor.getJSON());
        await runtime.flush();
      }
      if (!runtime.stored) throw new Error("Document not saved");
      const extension = (
        {
          "image/png": "png",
          "image/jpeg": "jpg",
          "image/gif": "gif",
          "image/webp": "webp",
          "image/svg+xml": "svg",
        } as Record<string, string>
      )[file.type];
      const src = `${docContainerUrls(runtime.stored.url).assets}${crypto.randomUUID()}.${extension}`;
      const response = await runtime.session.fetch(src, {
        method: "PUT",
        redirect: "error",
        headers: { "content-type": file.type, "if-none-match": "*" },
        body: file,
      });
      if (!response.ok) throw new Error("Upload failed");
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
      editor
        .chain()
        .focus()
        .insertContentAt(anchor.position, {
          type: "image",
          attrs: { src, alt: decorative ? "" : alt.trim() },
        })
        .run();
      close();
    } catch {
      setState("error");
    } finally {
      anchor.release();
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
      <EditorPopoverContent editor={editor} aria-label="Image alt text">
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
