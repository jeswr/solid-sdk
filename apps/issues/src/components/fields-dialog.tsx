"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Repository } from "@/lib/repository";
import { FIELD_TYPES, type FieldDef, type FieldType } from "@/lib/issue";
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
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Plus, SlidersHorizontal, X } from "lucide-react";

/**
 * Manage the tracker's custom fields (Jira custom fields / Monday columns).
 * Each field is an `rdf:Property` fragment of the tracker config; select
 * options are SKOS concepts.
 */
export function FieldsDialog({
  open,
  onOpenChange,
  trackerUrl,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trackerUrl: string;
  onSaved?: () => void;
}) {
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<FieldType>("text");
  const [options, setOptions] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    new Repository(trackerUrl)
      .fieldDefs()
      .then((defs) => {
        if (!cancelled) setFields(defs);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, trackerUrl]);

  const add = async () => {
    const optionLabels = options
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean);
    if (type === "select" && optionLabels.length === 0) {
      toast.error("A select field needs at least one option.");
      return;
    }
    setBusy(true);
    try {
      const repo = new Repository(trackerUrl);
      await repo.defineField(name.trim(), type, optionLabels);
      setFields(await repo.fieldDefs());
      setName("");
      setOptions("");
      setType("text");
      onSaved?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add the field.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (slug: string) => {
    setBusy(true);
    try {
      const repo = new Repository(trackerUrl);
      await repo.removeField(slug);
      setFields(await repo.fieldDefs());
      onSaved?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove the field.");
    } finally {
      setBusy(false);
    }
  };

  const typeLabel = (t: FieldType) => FIELD_TYPES.find((x) => x.slug === t)?.label ?? t;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SlidersHorizontal className="size-4" aria-hidden /> Custom fields
          </DialogTitle>
          <DialogDescription>
            Add your own typed fields to every issue in this project — text, numbers, dates, links, or
            a fixed set of options.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Loading fields" />
          </div>
        ) : fields.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">No custom fields yet.</p>
        ) : (
          <ul className="space-y-2">
            {fields.map((f) => (
              <li key={f.iri} className="flex items-center gap-2 rounded-lg border px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{f.label}</span>
                  {f.options.length > 0 && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {f.options.map((o) => o.label).join(" · ")}
                    </span>
                  )}
                </span>
                <Badge variant="secondary">{typeLabel(f.type)}</Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label={`Remove field ${f.label}`}
                  disabled={busy}
                  onClick={() => void remove(f.slug)}
                >
                  <X className="size-4" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <form
          className="space-y-3 border-t pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
            <div className="space-y-1.5">
              <Label htmlFor="new-field-name">Field name</Label>
              <Input
                id="new-field-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Customer"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-field-type">Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as FieldType)}>
                <SelectTrigger id="new-field-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FIELD_TYPES.map((t) => (
                    <SelectItem key={t.slug} value={t.slug}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {type === "select" && (
            <div className="space-y-1.5">
              <Label htmlFor="new-field-options">Options</Label>
              <Input
                id="new-field-options"
                value={options}
                onChange={(e) => setOptions(e.target.value)}
                placeholder="Alpha, Beta, GA"
              />
              <p className="text-xs text-muted-foreground">Comma-separated.</p>
            </div>
          )}
          <Button type="submit" className="gap-1.5" disabled={busy || !name.trim()}>
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Plus className="size-4" aria-hidden />}
            Add field
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
