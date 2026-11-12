// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
"use client";
import { TemplateAccessError, type TemplateApp, type TemplateBody } from "@jeswr/suite-templates";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  Input,
  toast,
} from "@jeswr/suite-ui";
import { useId, useState } from "react";
import type { PodSession } from "@/lib/session/pod-session";
import { prepareTemplateContent } from "@/lib/templates/content";
import { templatesForSession } from "@/lib/templates/store";
export function SaveTemplateDialog({
  session,
  app,
  title,
  content,
  imagesFrom,
  open,
  onOpenChange,
}: {
  session: PodSession;
  app: TemplateApp;
  title: string;
  content: (resource: string) => TemplateBody | Promise<TemplateBody>;
  /** The source's own assets container: only its direct-child images are copied. */
  imagesFrom?: string | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState(title);
  const [category, setCategory] = useState("Personal");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const id = useId();
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) onOpenChange(value);
      }}
    >
      <DialogContent>
        <DialogTitle>Save as template</DialogTitle>
        <DialogDescription>
          Save a reusable copy in your pod. Give it a name and category.
        </DialogDescription>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (busy || !name.trim() || !category.trim()) return;
            setBusy(true);
            setError(undefined);
            void templatesForSession(session)
              .then((store) =>
                store.save({
                  metadata: {
                    name: name.trim(),
                    description,
                    app,
                    category: category.trim(),
                    author: session.webId,
                  },
                  content: async (resource, assets) =>
                    prepareTemplateContent(
                      session,
                      app,
                      resource,
                      await content(resource),
                      assets,
                      imagesFrom,
                    ),
                }),
              )
              .then(() => {
                toast.success("Saved as template");
                onOpenChange(false);
              })
              .catch((reason: unknown) =>
                setError(
                  reason instanceof TemplateAccessError
                    ? reason.message
                    : "Couldn't save this template. Please try again.",
                ),
              )
              .finally(() => setBusy(false));
          }}
        >
          <label htmlFor={`${id}-name`}>Template name</label>
          <Input
            id={`${id}-name`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={200}
            required
          />
          <label htmlFor={`${id}-category`}>Template category</label>
          <Input
            id={`${id}-category`}
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            maxLength={100}
            required
          />
          <label htmlFor={`${id}-description`}>Description</label>
          <Input
            id={`${id}-description`}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={500}
          />
          {error && <p role="alert">{error}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim() || !category.trim()}>
              {busy ? "Saving…" : "Save template"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
