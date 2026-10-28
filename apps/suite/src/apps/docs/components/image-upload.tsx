// AUTHORED-BY Codex
"use client";
import { Button, Input, Popover, PopoverAnchor, PopoverContent } from "@jeswr/suite-ui";
import type { Editor } from "@tiptap/react";
import { useId, useState } from "react";
import type { DocumentPersistence } from "../editor/persistence";
import { insertionAnchor } from "../lib/editor/insertion-anchor";
import { docContainerUrls } from "../lib/model";
export function ImageUpload({
  editor,
  runtime,
  file,
  close,
}: {
  editor: Editor;
  runtime: DocumentPersistence;
  file: File | null;
  close: () => void;
}) {
  const id = useId();
  const [alt, setAlt] = useState(file ? "" : String(editor.getAttributes("image").alt ?? ""));
  const [decorative, setDecorative] = useState(false);
  const [state, setState] = useState<"idle" | "uploading" | "error">("idle");
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
        if (!open && state !== "uploading") close();
      }}
    >
      <PopoverAnchor asChild>
        <span className="docs-popover-anchor" />
      </PopoverAnchor>
      <PopoverContent
        aria-label="Image alt text"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (!editor.isDestroyed) editor.commands.focus();
        }}
      >
        <form
          className="docs-form"
          onSubmit={(event) => {
            event.preventDefault();
            void upload();
          }}
        >
          <h2>Alt text</h2>
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
          <Button variant="ghost" disabled={state === "uploading"} onClick={close}>
            {state === "error" ? "Remove" : "Cancel"}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
