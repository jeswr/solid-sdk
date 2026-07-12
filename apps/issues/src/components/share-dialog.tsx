"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { removeAccess } from "@/lib/sharing";
import { assignRole, listRoleAssignments, ROLES, ROLE_PRESETS, type Role, type RoleAssignment } from "@/lib/roles";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertCircle, Loader2, Trash2, UserPlus } from "lucide-react";
import { PersonAvatar, PersonName } from "@/components/person";

const schema = z.object({
  webId: z
    .string()
    .trim()
    .min(1, "Enter a WebID")
    .refine((v) => /^https?:\/\//.test(v), "Must be a WebID (http(s) URL)"),
  role: z.enum(["viewer", "editor", "admin"]),
});
type FormValues = z.infer<typeof schema>;

export function ShareDialog({
  open,
  onOpenChange,
  resourceUrl,
  extraResourceUrls = [],
  ownerWebId,
  title = "Share access",
  description = "Grant another person access by their WebID.",
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resourceUrl: string;
  /** Additional resources that must carry the same grants (e.g. the tracker config). */
  extraResourceUrls?: string[];
  ownerWebId: string;
  title?: string;
  description?: string;
  /** Called after access changes so the parent can refresh assignee suggestions. */
  onChanged?: () => void;
}) {
  const [assignments, setAssignments] = useState<RoleAssignment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { webId: "", role: "editor" },
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // F7: surface each grant as its named role (viewer / editor / admin).
      const all = await listRoleAssignments(resourceUrl, ownerWebId);
      setAssignments(all.filter((a) => a.kind === "agent"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read who this is shared with.");
    } finally {
      setLoading(false);
    }
  }, [resourceUrl, ownerWebId]);

  useEffect(() => {
    // Fetch when the dialog opens; setState runs after the await inside refresh.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) void refresh();
  }, [open, refresh]);

  const grant = async (values: FormValues) => {
    try {
      const webId = values.webId.trim();
      await assignRole(resourceUrl, ownerWebId, webId, values.role);
      // Collaborators need the side resources too (sprint membership / label
      // declaration write the config doc). The config never confers control, so an
      // admin on the issues still only gets editor on the config — capped at editor.
      const sideRole: Role = values.role === "viewer" ? "viewer" : "editor";
      for (const extra of extraResourceUrls) {
        await assignRole(extra, ownerWebId, webId, sideRole);
      }
      toast.success("Access granted");
      form.reset({ webId: "", role: values.role });
      await refresh();
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not grant access.");
    }
  };

  const revoke = async (webId: string) => {
    setBusyId(webId);
    try {
      await removeAccess(resourceUrl, ownerWebId, webId);
      for (const extra of extraResourceUrls) await removeAccess(extra, ownerWebId, webId);
      toast.success("Access removed");
      await refresh();
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove access.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(grant)} className="flex flex-col gap-2 sm:flex-row sm:items-start" noValidate>
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="share-webid" className="sr-only">
              WebID to share with
            </Label>
            <Input
              id="share-webid"
              type="url"
              placeholder="https://…/profile/card#me"
              aria-invalid={!!form.formState.errors.webId}
              {...form.register("webId")}
            />
            {form.formState.errors.webId && (
              <p className="text-sm text-destructive">{form.formState.errors.webId.message}</p>
            )}
          </div>
          <Select
            defaultValue="editor"
            onValueChange={(v) => form.setValue("role", v as Role)}
          >
            <SelectTrigger className="sm:w-36" aria-label="Role">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLES.map((r) => (
                <SelectItem key={r.role} value={r.role}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="submit" disabled={form.formState.isSubmitting} className="gap-1.5">
            {form.formState.isSubmitting ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <UserPlus className="size-4" aria-hidden />
            )}
            Share
          </Button>
        </form>

        <div className="mt-2 min-h-24">
          <h3 className="mb-2 text-sm font-medium text-muted-foreground">Shared with</h3>
          {loading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Loading…
            </p>
          ) : error ? (
            <p role="alert" className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="size-4" aria-hidden /> {error}
            </p>
          ) : assignments.length === 0 ? (
            <p className="text-sm text-muted-foreground">Not shared with anyone yet.</p>
          ) : (
            <ul className="space-y-2">
              {assignments.map((a) => (
                <li key={a.subject} className="flex items-center gap-3 rounded-md border p-2">
                  <PersonAvatar webId={a.subject} className="size-8" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      <PersonName webId={a.subject} />
                    </span>
                    <span className="block truncate text-xs text-muted-foreground" title={a.subject}>
                      {ROLE_PRESETS[a.role].label} · {a.subject}
                    </span>
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove access for ${a.subject}`}
                    onClick={() => revoke(a.subject)}
                    disabled={busyId === a.subject}
                  >
                    {busyId === a.subject ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <Trash2 className="size-4" aria-hidden />
                    )}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
