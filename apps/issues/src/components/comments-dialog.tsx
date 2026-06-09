"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, MessageSquare } from "lucide-react";
import type { IssueRecord } from "@/lib/use-issues";

const timeFmt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const shortWebId = (webId?: string) => {
  if (!webId) return "Someone";
  try {
    return new URL(webId).host;
  } catch {
    return webId;
  }
};

export function CommentsDialog({
  open,
  onOpenChange,
  issue,
  canComment,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  issue?: IssueRecord;
  canComment: boolean;
  onAdd: (content: string) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const content = text.trim();
    if (!content) return;
    setBusy(true);
    try {
      await onAdd(content);
      setText("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not post the comment.");
    } finally {
      setBusy(false);
    }
  };

  const comments = issue?.comments ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="truncate">{issue?.title ?? "Comments"}</DialogTitle>
          <DialogDescription>
            {comments.length} comment{comments.length === 1 ? "" : "s"}
          </DialogDescription>
        </DialogHeader>

        <ul className="max-h-72 space-y-3 overflow-y-auto">
          {comments.length === 0 ? (
            <li className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
              <MessageSquare className="size-6" aria-hidden /> No comments yet.
            </li>
          ) : (
            comments.map((c, i) => (
              <li key={i} className="rounded-md border p-3">
                <div className="mb-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="truncate font-medium">{shortWebId(c.author)}</span>
                  {c.created && <span>{timeFmt.format(c.created)}</span>}
                </div>
                <p className="text-sm whitespace-pre-wrap">{c.content}</p>
              </li>
            ))
          )}
        </ul>

        {canComment && (
          <div className="space-y-2">
            <Textarea
              aria-label="Add a comment"
              rows={3}
              placeholder="Add a comment…"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <div className="flex justify-end">
              <Button onClick={submit} disabled={busy || !text.trim()}>
                {busy && <Loader2 className="size-4 animate-spin" aria-hidden />} Comment
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
