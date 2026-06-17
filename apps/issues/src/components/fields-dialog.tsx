"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Repository } from "@/lib/repository";
import {
  FIELD_TYPES,
  DEFAULT_WORKFLOW,
  type ComponentDef,
  type FieldDef,
  type FieldType,
  type VersionDef,
  type WipLimits,
  type WorkflowStatus,
} from "@/lib/issue";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Boxes, GaugeCircle, Loader2, Milestone, Plus, SlidersHorizontal, X } from "lucide-react";

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
  const [components, setComponents] = useState<ComponentDef[]>([]);
  const [versions, setVersions] = useState<VersionDef[]>([]);
  // WIP limits (#111): the tracker's workflow columns + their per-column min/max.
  const [statuses, setStatuses] = useState<WorkflowStatus[]>(DEFAULT_WORKFLOW.statuses);
  const [wipLimits, setWipLimits] = useState<WipLimits>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<FieldType>("text");
  const [options, setOptions] = useState("");
  const [componentName, setComponentName] = useState("");
  const [versionName, setVersionName] = useState("");
  const [versionDate, setVersionDate] = useState("");
  const [versionReleased, setVersionReleased] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    new Repository(trackerUrl)
      .info()
      .then((info) => {
        if (cancelled) return;
        setFields(info.fields);
        setComponents(info.components);
        setVersions(info.versions);
        setStatuses(info.workflow.statuses);
        setWipLimits(info.wipLimits);
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

  const addComponent = async () => {
    const label = componentName.trim();
    if (!label) return;
    setBusy(true);
    try {
      const repo = new Repository(trackerUrl);
      await repo.defineComponent(label);
      setComponents(await repo.components());
      setComponentName("");
      onSaved?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add the component.");
    } finally {
      setBusy(false);
    }
  };

  const removeComponent = async (slug: string) => {
    setBusy(true);
    try {
      const repo = new Repository(trackerUrl);
      await repo.removeComponent(slug);
      setComponents(await repo.components());
      onSaved?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove the component.");
    } finally {
      setBusy(false);
    }
  };

  const addVersion = async () => {
    const label = versionName.trim();
    if (!label) return;
    setBusy(true);
    try {
      const repo = new Repository(trackerUrl);
      await repo.defineVersion(label, {
        releaseDate: versionDate ? new Date(versionDate) : undefined,
        released: versionReleased,
      });
      setVersions(await repo.versions());
      setVersionName("");
      setVersionDate("");
      setVersionReleased(false);
      onSaved?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add the version.");
    } finally {
      setBusy(false);
    }
  };

  const toggleReleased = async (v: VersionDef) => {
    setBusy(true);
    try {
      const repo = new Repository(trackerUrl);
      // Redefining by the same label keeps the position; flips the released flag.
      await repo.defineVersion(v.label, { position: v.position, releaseDate: v.releaseDate, released: !v.released });
      setVersions(await repo.versions());
      onSaved?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update the version.");
    } finally {
      setBusy(false);
    }
  };

  const removeVersion = async (slug: string) => {
    setBusy(true);
    try {
      const repo = new Repository(trackerUrl);
      await repo.removeVersion(slug);
      setVersions(await repo.versions());
      onSaved?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove the version.");
    } finally {
      setBusy(false);
    }
  };

  // WIP limit edit (#111): set a column's min OR max. An empty input clears that
  // bound; a non-negative integer sets it. Persisted on the #status- wf:State class.
  const setWip = async (slug: string, which: "min" | "max", raw: string) => {
    const current = wipLimits[slug] ?? {};
    const value = raw.trim() === "" ? undefined : Math.max(0, Math.floor(Number(raw)));
    if (value !== undefined && !Number.isFinite(value)) {
      toast.error("WIP limits must be whole numbers.");
      return;
    }
    const next = { ...current, [which]: value };
    // Optimistically reflect the edit; revert from the server result on failure.
    setWipLimits((prev) => {
      const updated = { ...prev };
      if (next.min === undefined && next.max === undefined) delete updated[slug];
      else updated[slug] = next;
      return updated;
    });
    setBusy(true);
    try {
      const repo = new Repository(trackerUrl);
      await repo.setWipLimit(slug, next);
      setWipLimits(await repo.wipLimits());
      onSaved?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not set the WIP limit.");
      // Reconcile to the true stored state.
      try {
        setWipLimits(await new Repository(trackerUrl).wipLimits());
      } catch {
        /* keep optimistic value */
      }
    } finally {
      setBusy(false);
    }
  };

  const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
  const typeLabel = (t: FieldType) => FIELD_TYPES.find((x) => x.slug === t)?.label ?? t;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SlidersHorizontal className="size-4" aria-hidden /> Fields, components &amp; versions
          </DialogTitle>
          <DialogDescription>
            Configure this project — custom typed fields, components (areas / modules), and versions
            (releases) that issues can be filed against and fixed in.
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

        {/* Components — a second categorization dimension (areas / modules). */}
        <section className="space-y-3 border-t pt-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Boxes className="size-4" aria-hidden /> Components
          </h3>
          {components.length === 0 ? (
            <p className="text-sm text-muted-foreground">No components yet.</p>
          ) : (
            <ul className="space-y-2">
              {components.map((c) => (
                <li key={c.slug} className="flex items-center gap-2 rounded-lg border px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.label}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label={`Remove component ${c.label}`}
                    disabled={busy}
                    onClick={() => void removeComponent(c.slug)}
                  >
                    <X className="size-4" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void addComponent();
            }}
          >
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="new-component-name">Component name</Label>
              <Input
                id="new-component-name"
                value={componentName}
                onChange={(e) => setComponentName(e.target.value)}
                placeholder="e.g. Auth Service"
              />
            </div>
            <Button type="submit" className="gap-1.5" disabled={busy || !componentName.trim()}>
              <Plus className="size-4" aria-hidden /> Add
            </Button>
          </form>
        </section>

        {/* Versions / releases — schema:position-ordered, with a release date + released flag. */}
        <section className="space-y-3 border-t pt-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Milestone className="size-4" aria-hidden /> Versions
          </h3>
          {versions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No versions yet.</p>
          ) : (
            <ul className="space-y-2">
              {versions.map((v) => (
                <li key={v.slug} className="flex items-center gap-2 rounded-lg border px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{v.label}</span>
                    {v.releaseDate && (
                      <span className="block truncate text-xs text-muted-foreground">{dateFmt.format(v.releaseDate)}</span>
                    )}
                  </span>
                  <Badge variant={v.released ? "secondary" : "outline"}>{v.released ? "Released" : "Unreleased"}</Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7"
                    disabled={busy}
                    onClick={() => void toggleReleased(v)}
                  >
                    {v.released ? "Mark unreleased" : "Mark released"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label={`Remove version ${v.label}`}
                    disabled={busy}
                    onClick={() => void removeVersion(v.slug)}
                  >
                    <X className="size-4" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void addVersion();
            }}
          >
            <div className="grid gap-3 sm:grid-cols-[1fr_11rem]">
              <div className="space-y-1.5">
                <Label htmlFor="new-version-name">Version name</Label>
                <Input
                  id="new-version-name"
                  value={versionName}
                  onChange={(e) => setVersionName(e.target.value)}
                  placeholder="e.g. 1.0.0"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-version-date">Release date</Label>
                <Input
                  id="new-version-date"
                  type="date"
                  value={versionDate}
                  onChange={(e) => setVersionDate(e.target.value)}
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="new-version-released"
                checked={versionReleased}
                onCheckedChange={(c) => setVersionReleased(c === true)}
              />
              <Label htmlFor="new-version-released" className="font-normal">Already released</Label>
            </div>
            <Button type="submit" className="gap-1.5" disabled={busy || !versionName.trim()}>
              <Plus className="size-4" aria-hidden /> Add version
            </Button>
          </form>
        </section>

        {/* WIP limits — per board column min / max (#111 P1-1). */}
        <section className="space-y-3 border-t pt-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <GaugeCircle className="size-4" aria-hidden /> Column WIP limits
          </h3>
          <p className="text-sm text-muted-foreground">
            Soft work-in-progress bounds per board column. The board warns (amber under the minimum, red
            over the maximum) and warns on a drag that would push a column over its maximum — it never
            blocks the move. Leave blank for no limit.
          </p>
          <ul className="space-y-2">
            {statuses.map((s) => {
              const limit = wipLimits[s.slug] ?? {};
              return (
                <li key={s.slug} className="flex items-center gap-2 rounded-lg border px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{s.label}</span>
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor={`wip-min-${s.slug}`} className="text-xs text-muted-foreground">
                      Min
                    </Label>
                    <Input
                      id={`wip-min-${s.slug}`}
                      type="number"
                      min={0}
                      inputMode="numeric"
                      className="h-8 w-16"
                      defaultValue={limit.min ?? ""}
                      disabled={busy}
                      aria-label={`Minimum WIP for ${s.label}`}
                      onBlur={(e) => void setWip(s.slug, "min", e.target.value)}
                    />
                    <Label htmlFor={`wip-max-${s.slug}`} className="text-xs text-muted-foreground">
                      Max
                    </Label>
                    <Input
                      id={`wip-max-${s.slug}`}
                      type="number"
                      min={0}
                      inputMode="numeric"
                      className="h-8 w-16"
                      defaultValue={limit.max ?? ""}
                      disabled={busy}
                      aria-label={`Maximum WIP for ${s.label}`}
                      onBlur={(e) => void setWip(s.slug, "max", e.target.value)}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      </DialogContent>
    </Dialog>
  );
}
