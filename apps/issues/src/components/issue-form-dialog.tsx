"use client";

import { useEffect, useRef, useState } from "react";
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
import { ISSUE_TYPES, STATUSES, safeHttpUrl, type ComponentDef, type FieldDef, type FieldValue, type IssueType, type Priority, type StatusSlug, type VersionDef } from "@/lib/issue";

const VERSION_NONE = "none";

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
  // Any workflow-status slug — the tracker declares the set (F1), so this can't be
  // a fixed enum. The Select below only offers the tracker's configured statuses.
  status: z.string().min(1),
  // Derived from ISSUE_TYPES so the form can never drift from the model's levels.
  issueType: z.enum(ISSUE_TYPES.map((t) => t.slug) as [IssueType, ...IssueType[]]),
  estimate: z
    .string()
    .trim()
    .refine((v) => v === "" || (!Number.isNaN(Number(v)) && Number(v) >= 0), "Points must be a non-negative number")
    .optional(),
  labels: z.string().optional(),
  // Comma-separated component display names (declared on the tracker on use, like labels).
  components: z.string().optional(),
  // A single tracker-version display name (or "" / "none" for unset).
  affectsVersion: z.string().optional(),
  fixVersion: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

export interface IssueFormSubmit {
  title: string;
  description?: string;
  dateDue?: Date;
  assignee?: string;
  priority?: Priority;
  status: StatusSlug;
  issueType: IssueType;
  estimate?: number;
  labels: string[];
  /** Component display names (declared on the tracker on use, like labels). */
  components: string[];
  /** The affects-version display name; undefined clears it. */
  affectsVersion?: string;
  /** The fix-version display name; undefined clears it. */
  fixVersion?: string;
  /** Custom-field values keyed by slug; undefined clears a value. */
  fields?: Record<string, FieldValue | undefined>;
}

/** Input string per field slug ⇄ typed FieldValue, by field type. */
const fieldToInput = (def: FieldDef, value: FieldValue | undefined): string => {
  if (value === undefined) return "";
  if (def.type === "date") return toDateInput(value as Date);
  return String(value);
};
const inputToField = (def: FieldDef, raw: string): FieldValue | undefined => {
  const v = raw.trim();
  if (!v) return undefined;
  switch (def.type) {
    case "number":
      return Number.isNaN(Number(v)) ? undefined : Number(v);
    case "date":
      return new Date(v);
    case "url":
      return safeHttpUrl(v); // only http(s) is ever stored
    default:
      return v; // text, select (option IRI)
  }
};

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
  defaultStatus,
  onSubmit,
  assigneeSuggestions = [],
  fieldDefs = [],
  componentDefs = [],
  versionDefs = [],
  statuses = STATUSES,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: IssueRecord;
  /** Status preset for NEW issues (e.g. created from a board column). */
  defaultStatus?: StatusSlug;
  onSubmit: (values: IssueFormSubmit) => Promise<void>;
  /** WebIDs (and the assignee group IRI) offered as assignee autocomplete. */
  assigneeSuggestions?: string[];
  /** The tracker's custom fields, rendered as typed inputs. */
  fieldDefs?: FieldDef[];
  /** The tracker's component definitions (for slug→label display on edit). */
  componentDefs?: ComponentDef[];
  /** The tracker's version definitions, offered in the affects/fix-version selects. */
  versionDefs?: VersionDef[];
  /** The tracker's workflow statuses (F1); defaults to the built-in three-column set. */
  statuses?: { slug: string; label: string }[];
}) {
  const editing = !!initial;
  // Custom fields are dynamic, so they live beside the zod-validated form.
  const [fieldInputs, setFieldInputs] = useState<Record<string, string>>({});
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { title: "", description: "", dateDue: "", assignee: "", priority: "none", status: statuses[0]?.slug ?? "todo", issueType: "task", estimate: "", labels: "", components: "", affectsVersion: "", fixVersion: "" },
  });
  const priority = useWatch({ control: form.control, name: "priority" });
  const status = useWatch({ control: form.control, name: "status" });
  const issueType = useWatch({ control: form.control, name: "issueType" });
  const affectsVersion = useWatch({ control: form.control, name: "affectsVersion" });
  const fixVersion = useWatch({ control: form.control, name: "fixVersion" });

  // Reset ONLY when the dialog transitions closed -> open. Dep changes while
  // it is open (e.g. a slow tracker-info load updating fieldDefs) must never
  // wipe what the user is typing.
  const wasOpen = useRef(false);
  useEffect(() => {
    const opening = open && !wasOpen.current;
    wasOpen.current = open;
    if (opening) {
      // Component / version slugs ⇄ display labels (the issue carries slugs; the
      // form edits display names, mirroring how labels are declared-on-use).
      const componentLabel = (slug: string) => componentDefs.find((c) => c.slug === slug)?.label ?? slug;
      const versionLabel = (slug?: string) => (slug ? versionDefs.find((v) => v.slug === slug)?.label ?? slug : "");
      form.reset({
        title: initial?.title ?? "",
        description: initial?.description ?? "",
        dateDue: toDateInput(initial?.dateDue),
        assignee: initial?.assignee ?? "",
        priority: initial?.priority ?? "none",
        status: initial?.status ?? defaultStatus ?? statuses[0]?.slug ?? "todo",
        issueType: initial?.issueType ?? "task",
        estimate: initial?.estimate !== undefined ? String(initial.estimate) : "",
        labels: (initial?.labels ?? []).join(", "),
        components: (initial?.components ?? []).map(componentLabel).join(", "),
        affectsVersion: versionLabel(initial?.affectsVersion),
        fixVersion: versionLabel(initial?.fixVersion),
      });
      // Dialog-open reset, same as form.reset above (custom fields live outside RHF).

      setFieldInputs(
        Object.fromEntries(fieldDefs.map((d) => [d.slug, fieldToInput(d, initial?.fields[d.slug])])),
      );
    }
  }, [open, initial, defaultStatus, form, fieldDefs, componentDefs, versionDefs, statuses]);

  // Field definitions can arrive AFTER the dialog opened (slow tracker-info
  // load). Backfill those inputs from the stored values so submitting doesn't
  // clear them — but never overwrite a slug the reset already initialised
  // (the user may be typing in it).
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- pure backfill of newly-arrived defs; no-op render otherwise
    setFieldInputs((prev) => {
      const missing = fieldDefs.filter((d) => !(d.slug in prev));
      if (missing.length === 0) return prev;
      return {
        ...prev,
        ...Object.fromEntries(missing.map((d) => [d.slug, fieldToInput(d, initial?.fields[d.slug])])),
      };
    });
  }, [open, fieldDefs, initial]);

  const submit = async (values: FormValues) => {
    await onSubmit({
      title: values.title.trim(),
      description: values.description?.trim() || undefined,
      dateDue: values.dateDue ? new Date(values.dateDue) : undefined,
      assignee: values.assignee?.trim() || undefined,
      priority: values.priority === PRIORITY_NONE ? undefined : (values.priority as Priority),
      status: values.status,
      issueType: values.issueType,
      estimate: values.estimate?.trim() ? Number(values.estimate) : undefined,
      labels: parseLabels(values.labels),
      components: parseLabels(values.components),
      affectsVersion: values.affectsVersion?.trim() || undefined,
      fixVersion: values.fixVersion?.trim() || undefined,
      fields:
        fieldDefs.length > 0
          ? Object.fromEntries(fieldDefs.map((d) => [d.slug, inputToField(d, fieldInputs[d.slug] ?? "")]))
          : undefined,
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

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="issueType">Type</Label>
              <Select value={issueType} onValueChange={(v) => form.setValue("issueType", v as FormValues["issueType"])}>
                <SelectTrigger id="issueType">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ISSUE_TYPES.map((t) => (
                    <SelectItem key={t.slug} value={t.slug}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="status">Status</Label>
              <Select value={status} onValueChange={(v) => form.setValue("status", v)}>
                <SelectTrigger id="status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {statuses.map((s) => (
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
            <div className="space-y-1.5">
              <Label htmlFor="estimate">Story points</Label>
              <Input id="estimate" type="number" min="0" step="0.5" placeholder="e.g. 3" {...form.register("estimate")} />
              {form.formState.errors.estimate && (
                <p className="text-sm text-destructive">{form.formState.errors.estimate.message}</p>
              )}
            </div>
          </div>

          {fieldDefs.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2">
              {fieldDefs.map((def) => {
                const id = `field-${def.slug}`;
                const value = fieldInputs[def.slug] ?? "";
                const set = (v: string) => setFieldInputs((s) => ({ ...s, [def.slug]: v }));
                return (
                  <div key={def.iri} className="space-y-1.5">
                    <Label htmlFor={id}>{def.label}</Label>
                    {def.type === "select" ? (
                      <Select value={value || "none"} onValueChange={(v) => set(v === "none" ? "" : v)}>
                        <SelectTrigger id={id}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">—</SelectItem>
                          {def.options.map((o) => (
                            <SelectItem key={o.iri} value={o.iri}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        id={id}
                        type={def.type === "number" ? "number" : def.type === "date" ? "date" : def.type === "url" ? "url" : "text"}
                        value={value}
                        onChange={(e) => set(e.target.value)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="labels">Labels</Label>
            <Input id="labels" placeholder="bug, ui, urgent" {...form.register("labels")} />
            <p className="text-xs text-muted-foreground">Comma-separated.</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="components">Components</Label>
            <Input id="components" placeholder="auth, ui, api" {...form.register("components")} />
            <p className="text-xs text-muted-foreground">Comma-separated areas / modules.</p>
          </div>

          {versionDefs.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="affectsVersion">Affects version</Label>
                <Select
                  value={affectsVersion || VERSION_NONE}
                  onValueChange={(v) => form.setValue("affectsVersion", v === VERSION_NONE ? "" : v)}
                >
                  <SelectTrigger id="affectsVersion">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={VERSION_NONE}>None</SelectItem>
                    {versionDefs.map((v) => (
                      <SelectItem key={v.iri} value={v.label}>
                        {v.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fixVersion">Fix version</Label>
                <Select
                  value={fixVersion || VERSION_NONE}
                  onValueChange={(v) => form.setValue("fixVersion", v === VERSION_NONE ? "" : v)}
                >
                  <SelectTrigger id="fixVersion">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={VERSION_NONE}>None</SelectItem>
                    {versionDefs.map((v) => (
                      <SelectItem key={v.iri} value={v.label}>
                        {v.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

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
