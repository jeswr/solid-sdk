"use client";

import { useEffect } from "react";
import { useForm, useWatch } from "react-hook-form";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import type { IssueRecord } from "@/lib/use-issues";
import { STATUSES, type Priority, type StatusSlug } from "@/lib/issue";

const PRIORITY_NONE = "none";

const schema = z.object({
  title: z.string().trim().min(1, "A title is required").max(200, "Keep the title under 200 characters"),
  description: z.string().trim().max(5000).optional(),
  dateDue: z.string().optional(),
  assignee: z
    .string()
    .trim()
    .refine((v) => v === "" || /^https?:\/\//.test(v), "Assignee must be a WebID (http(s) URL)")
    .optional(),
  priority: z.enum(["none", "high", "medium", "low"]),
  status: z.enum(["todo", "in-progress", "done"]),
  labels: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

export interface IssueFormSubmit {
  title: string;
  description?: string;
  dateDue?: Date;
  assignee?: string;
  priority?: Priority;
  status: StatusSlug;
  labels: string[];
}

const toDateInput = (d?: Date) => (d ? d.toISOString().slice(0, 10) : "");
const parseLabels = (s?: string) =>
  (s ?? "")
    .split(",")
    .map((l) => l.trim())
    .filter(Boolean);

export function IssueFormDialog({
  open,
  onOpenChange,
  initial,
  onSubmit,
  assigneeSuggestions = [],
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: IssueRecord;
  onSubmit: (values: IssueFormSubmit) => Promise<void>;
  /** WebIDs (and the assignee group IRI) offered as assignee autocomplete. */
  assigneeSuggestions?: string[];
}) {
  const editing = !!initial;
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { title: "", description: "", dateDue: "", assignee: "", priority: "none", status: "todo", labels: "" },
  });
  const priority = useWatch({ control: form.control, name: "priority" });
  const status = useWatch({ control: form.control, name: "status" });

  useEffect(() => {
    if (open) {
      form.reset({
        title: initial?.title ?? "",
        description: initial?.description ?? "",
        dateDue: toDateInput(initial?.dateDue),
        assignee: initial?.assignee ?? "",
        priority: initial?.priority ?? "none",
        status: initial?.status ?? "todo",
        labels: (initial?.labels ?? []).join(", "),
      });
    }
  }, [open, initial, form]);

  const submit = async (values: FormValues) => {
    await onSubmit({
      title: values.title.trim(),
      description: values.description?.trim() || undefined,
      dateDue: values.dateDue ? new Date(values.dateDue) : undefined,
      assignee: values.assignee?.trim() || undefined,
      priority: values.priority === PRIORITY_NONE ? undefined : (values.priority as Priority),
      status: values.status,
      labels: parseLabels(values.labels),
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
            <Textarea id="description" rows={3} {...form.register("description")} />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="status">Status</Label>
              <Select value={status} onValueChange={(v) => form.setValue("status", v as FormValues["status"])}>
                <SelectTrigger id="status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s.slug} value={s.slug}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="priority">Priority</Label>
              <Select
                value={priority}
                onValueChange={(v) => form.setValue("priority", v as FormValues["priority"])}
              >
                <SelectTrigger id="priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dateDue">Due date</Label>
              <Input id="dateDue" type="date" {...form.register("dateDue")} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="labels">Labels</Label>
            <Input id="labels" placeholder="bug, ui, urgent" {...form.register("labels")} />
            <p className="text-xs text-muted-foreground">Comma-separated.</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="assignee">Assignee (WebID or group)</Label>
            <Input
              id="assignee"
              type="url"
              list="assignee-suggestions"
              placeholder="https://…/profile/card#me"
              aria-invalid={!!form.formState.errors.assignee}
              aria-describedby={form.formState.errors.assignee ? "assignee-error" : undefined}
              {...form.register("assignee")}
            />
            {assigneeSuggestions.length > 0 && (
              <datalist id="assignee-suggestions">
                {assigneeSuggestions.map((webId) => (
                  <option key={webId} value={webId} />
                ))}
              </datalist>
            )}
            {form.formState.errors.assignee && (
              <p id="assignee-error" className="text-sm text-destructive">
                {form.formState.errors.assignee.message}
              </p>
            )}
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
