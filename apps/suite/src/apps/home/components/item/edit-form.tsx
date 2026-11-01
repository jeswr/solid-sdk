// AUTHORED-BY Codex GPT-6
"use client";
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from "@jeswr/suite-ui";
import { NS } from "@jeswr/suite-vocab";
import { useMemo, useState } from "react";
import { normaliseField } from "../../lib/forms/field-types";
import { resolveForm } from "../../lib/forms/resolve-form";
import { saveFormEdits } from "../../lib/forms/write";
import type { HomeSession } from "../../state/use-domain-items";
import { type ItemRead, readItem } from "./data";
import { ItemForm } from "./item-form";

export function EditForm({
  read,
  session,
  online,
  onSaved,
  onCancel,
}: {
  read: ItemRead;
  session: HomeSession;
  online: boolean;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const item = read.item;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [conflict, setConflict] = useState<Record<string, string>>();
  const fields = useMemo(() => {
    const resolved = resolveForm(item.url, item.dataset, item.subject.value).fields;
    if (item.url !== session.webId.split("#")[0]) return resolved;
    const allowed = [
      "name",
      "fn",
      "hasPhoto",
      "img",
      "pronouns",
      "hasEmail",
      "hasTelephone",
      "email",
      "telephone",
    ];
    const profile = resolved
      .filter((field) => allowed.includes(field.predicate.split(/[#/]/).at(-1) ?? ""))
      .map((field) => {
        const local = field.predicate.split(/[#/]/).at(-1);
        if (["name", "fn"].includes(local ?? "")) return { ...field, label: "Name" };
        if (local === "hasEmail")
          return { ...field, label: "Email", kind: "email" as const, mode: "mailto" as const };
        if (local === "hasTelephone")
          return { ...field, label: "Phone", kind: "tel" as const, mode: "tel" as const };
        if (["hasPhoto", "img"].includes(local ?? ""))
          return { ...field, label: "Photo", kind: "url" as const, mode: "iri" as const };
        return field;
      });
    for (const [label, predicate, kind, mode] of [
      ["Name", `${NS.FOAF}name`, "text", "literal"],
      ["Photo", `${NS.VCARD}hasPhoto`, "url", "iri"],
      ["Pronouns", `${NS.SCHEMA}pronouns`, "text", "literal"],
      ["Email", `${NS.VCARD}hasEmail`, "email", "mailto"],
      ["Phone", `${NS.VCARD}hasTelephone`, "tel", "tel"],
    ] as const)
      if (!profile.some((field) => field.label === label || field.predicate === predicate))
        profile.push(normaliseField({ label, predicate, kind, mode }));
    return profile;
  }, [item, session.webId]);
  const save = async (values: Record<string, string>, reRead = false) => {
    if (!navigator.onLine) {
      setError("Reconnect to save");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const baseline = reRead ? await readItem(session, item.url, item.subject.value) : read;
      if (!baseline.writable) {
        setError("You do not have permission to edit this item.");
        return;
      }
      const result = await saveFormEdits(
        item.url,
        baseline.item.dataset,
        item.subject.value,
        fields,
        values,
        { etag: baseline.item.etag, fetchImpl: session.fetch },
      );
      if (result.ok) {
        setConflict(undefined);
        onSaved();
      } else if (result.reason === "stale") setConflict(values);
      else setError(result.message);
    } catch {
      setError("Couldn't save your changes. Please try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <h2>Edit item</h2>
      <ItemForm
        fields={fields}
        dataset={item.dataset}
        subject={item.subject.value}
        online={online}
        busy={busy}
        error={error}
        onSave={(values) => void save(values)}
        onCancel={onCancel}
      />
      <Dialog
        open={Boolean(conflict)}
        onOpenChange={(open) => {
          if (!open && !busy) setConflict(undefined);
        }}
      >
        <DialogContent className="hm-item-dialog" aria-describedby="hm-conflict-description">
          <DialogTitle>This item changed since you opened it</DialogTitle>
          <DialogDescription id="hm-conflict-description">
            Reload the latest version or keep the fields you changed.
          </DialogDescription>
          {error ? <p role="alert">{error}</p> : null}
          <div className="hm-item-form-actions">
            <Button
              variant="outline"
              disabled={busy || !online}
              onClick={() => {
                setConflict(undefined);
                onSaved();
              }}
            >
              Reload
            </Button>
            <Button
              disabled={busy || !online}
              onClick={() => {
                if (conflict) void save(conflict, true);
              }}
            >
              Keep my changes
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
