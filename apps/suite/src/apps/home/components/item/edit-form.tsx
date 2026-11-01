// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
"use client";
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from "@jeswr/suite-ui";
import { useMemo, useState } from "react";
import { itemEditFields } from "../../lib/forms/profile-fields";
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
  // Fields with several values or a nested structure come back read-only (see profile-fields).
  const fields = useMemo(() => itemEditFields(item, session.webId), [item, session.webId]);
  const save = async (values: Record<string, string>, reRead = false) => {
    if (!navigator.onLine) {
      setError("Reconnect to save");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const baseline = reRead ? await readItem(session, item.url, item.subject) : read;
      if (!baseline.writable) {
        setError("You do not have permission to edit this item.");
        return;
      }
      const result = await saveFormEdits(
        item.url,
        baseline.item.dataset,
        baseline.item.subject,
        fields,
        values,
        { etag: baseline.item.etag, fetchImpl: session.fetch },
      );
      if (result.ok) {
        setConflict(undefined);
        onSaved();
      } else if (result.reason === "stale") setConflict(values);
      else if (result.reason === "validation" && result.fieldId) {
        // On "Keep my changes" a field may have gained values elsewhere; never drop them.
        const label = fields.find((field) => field.id === result.fieldId)?.label ?? "A field";
        setError(`${label} can't be changed here. ${result.message}`);
      } else setError(result.message);
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
        subject={item.subject}
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
