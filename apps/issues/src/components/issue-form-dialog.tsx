"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import type { IssueView } from "@/lib/use-issues";

const schema = z.object({
  title: z.string().trim().min(1, "A title is required").max(200, "Keep the title under 200 characters"),
  description: z.string().trim().max(5000).optional(),
  dateDue: z.string().optional(),
  assignee: z
    .string()
    .trim()
    .refine((v) => v === "" || /^https?:\/\//.test(v), "Assignee must be a WebID (http(s) URL)")
    .optional(),
});
type FormValues = z.infer<typeof schema>;

export interface IssueFormSubmit {
  title: string;
  description?: string;
  dateDue?: Date;
  assignee?: string;
}

function toDateInput(d?: Date): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

export function IssueFormDialog({
  open,
  onOpenChange,
  initial,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: IssueView;
  onSubmit: (values: IssueFormSubmit) => Promise<void>;
}) {
  const editing = !!initial;
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { title: "", description: "", dateDue: "", assignee: "" },
  });

  // Reset the form whenever the dialog opens (with the issue being edited, if any).
  useEffect(() => {
    if (open) {
      form.reset({
        title: initial?.title ?? "",
        description: initial?.description ?? "",
        dateDue: toDateInput(initial?.dateDue),
        assignee: initial?.assignee ?? "",
      });
    }
  }, [open, initial, form]);

  const submit = async (values: FormValues) => {
    await onSubmit({
      title: values.title.trim(),
      description: values.description?.trim() || undefined,
      dateDue: values.dateDue ? new Date(values.dateDue) : undefined,
      assignee: values.assignee?.trim() || undefined,
    });
    onOpenChange(false);
  };

  const busy = form.formState.isSubmitting;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit issue" : "New issue"}</DialogTitle>
          <DialogDescription>
            {editing ? "Update the details of this issue." : "Describe the issue you want to track."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(submit)} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              autoFocus
              aria-invalid={!!form.formState.errors.title}
              aria-describedby={form.formState.errors.title ? "title-error" : undefined}
              {...form.register("title")}
            />
            {form.formState.errors.title && (
              <p id="title-error" className="text-sm text-destructive">
                {form.formState.errors.title.message}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" rows={4} {...form.register("description")} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="dateDue">Due date</Label>
              <Input id="dateDue" type="date" {...form.register("dateDue")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="assignee">Assignee (WebID)</Label>
              <Input
                id="assignee"
                type="url"
                placeholder="https://…/profile/card#me"
                aria-invalid={!!form.formState.errors.assignee}
                aria-describedby={form.formState.errors.assignee ? "assignee-error" : undefined}
                {...form.register("assignee")}
              />
              {form.formState.errors.assignee && (
                <p id="assignee-error" className="text-sm text-destructive">
                  {form.formState.errors.assignee.message}
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {editing ? "Save changes" : "Create issue"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
