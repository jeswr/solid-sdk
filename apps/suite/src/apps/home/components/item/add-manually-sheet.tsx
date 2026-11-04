// AUTHORED-BY Codex GPT-6
"use client";
import { RdfFetchError } from "@jeswr/fetch-rdf";
import {
  Button,
  LoadingSkeleton,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  toast,
} from "@jeswr/suite-ui";
import type { DatasetCore } from "@rdfjs/types";
import { useEffect, useId, useState } from "react";
import { autoFormFor } from "../../lib/forms/auto-form";
import type { DataCategory, DataType } from "../../lib/model/domains";
import { loadTemplate } from "../../lib/templates";
import { domainStore } from "../../state/use-domain-items";
import { useHomeSession } from "../home-app";
import { ItemForm } from "./item-form";
import {
  createManualItem,
  ManualRegistrationError,
  manualUrl,
  registerManualType,
} from "./manual-data";
import { useOnline } from "./use-online";
import "./item.css";

export function AddManuallySheet({
  domain,
  open,
  onOpenChange,
  returnFocus,
}: {
  domain: DataCategory;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocus: () => void;
}) {
  const session = useHomeSession();
  const online = useOnline();
  const labelId = useId();
  const types = domain.dataTypes.filter((type) => type.manualForm);
  const [selected, setSelected] = useState(types[0]?.id);
  const type = types.find((type) => type.id === selected) ?? types[0];
  const [template, setTemplate] = useState<{
    type: DataType;
    dataset: DatasetCore;
    subject: string;
  }>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const [saved, setSaved] = useState<string>();
  // biome-ignore lint/correctness/useExhaustiveDependencies: explicit retry reloads the resource
  useEffect(() => {
    if (!open || !type?.manualForm) return;
    let live = true;
    setTemplate(undefined);
    setError(undefined);
    setSaved(undefined);
    const url = new URL("personal/draft.ttl", session.storageUrl).href;
    loadTemplate(type.manualForm, url).then(
      (dataset) => {
        if (live) setTemplate({ type, dataset, subject: `${url}#it` });
      },
      () => {
        if (live) setError("Couldn't load the form. Please try again.");
      },
    );
    return () => {
      live = false;
    };
  }, [open, type, session.storageUrl, retry]);
  const fields = template
    ? autoFormFor(template.dataset, template.subject).map((field) => ({
        ...field,
        label:
          (
            { Fn: "Name", Recalls: "Link", "Country name": "Country", Text: "Note" } as Record<
              string,
              string
            >
          )[field.label] ?? field.label,
        required: ["name", "fn", "title", "recalls"].includes(
          field.predicate.split(/[#/]/).at(-1) ?? "",
        ),
      }))
    : [];
  const save = async (values: Record<string, string>) => {
    if (!template || !type?.manualForm || !online || !navigator.onLine) return;
    setBusy(true);
    setError(undefined);
    try {
      const name = fields.find((field) => ["Name", "Title"].includes(field.label));
      const url =
        saved ??
        manualUrl(session.storageUrl, type, name ? (values[name.id] ?? type.label) : type.label);
      if (saved)
        await registerManualType(
          session,
          type.manualForm,
          new URL(type.container as string, session.storageUrl).href,
        );
      else
        await createManualItem(
          session,
          type,
          url,
          await loadTemplate(type.manualForm, url),
          fields,
          values,
        );
      void domainStore(session).refresh();
      toast.success(`Added ${type.label}`);
      onOpenChange(false);
    } catch (error) {
      // Once the item exists only registration can fail: say why, then offer retry or skip.
      const registering = saved !== undefined || error instanceof ManualRegistrationError;
      if (error instanceof ManualRegistrationError) setSaved(error.url);
      const cause = error instanceof ManualRegistrationError ? error.cause : error;
      setError(
        registering
          ? cause instanceof Error &&
            !(cause instanceof RdfFetchError || cause instanceof TypeError)
            ? cause.message
            : "Couldn't add this type to Home. Please try again."
          : error instanceof Error
            ? error.message
            : "Couldn't save this item. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      open={open}
      onOpenChange={(value) => {
        if (!busy) onOpenChange(value);
      }}
    >
      <SheetContent
        className="hm-add-sheet"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus();
        }}
      >
        <SheetTitle>Add manually</SheetTitle>
        <SheetDescription>Add something to {domain.label}.</SheetDescription>
        <div className="hm-item-field">
          <label htmlFor={labelId}>Data type</label>
          <select
            id={labelId}
            value={type?.id ?? ""}
            disabled={busy || Boolean(saved)}
            onChange={(event) => setSelected(event.target.value)}
          >
            {types.map((type) => (
              <option key={type.id} value={type.id}>
                {type.label}
              </option>
            ))}
          </select>
        </div>
        {saved ? (
          <div className="hm-item-form">
            <p role="alert">{error}</p>
            <p>Your item is saved. Try again to add it to Home, or skip and keep it as it is.</p>
            <div className="hm-item-form-actions">
              <Button disabled={busy || !online} onClick={() => void save({})}>
                Retry registration
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  void domainStore(session).refresh();
                  onOpenChange(false);
                }}
              >
                Skip registration
              </Button>
            </div>
          </div>
        ) : template ? (
          <ItemForm
            key={`${template.type.id}-${retry}`}
            fields={fields}
            dataset={template.dataset}
            subject={template.subject}
            blank
            online={online}
            busy={busy}
            error={error}
            onSave={(values) => void save(values)}
            onCancel={() => onOpenChange(false)}
          />
        ) : error ? (
          <>
            <p role="alert">{error}</p>
            <Button onClick={() => setRetry((value) => value + 1)}>Retry</Button>
          </>
        ) : (
          <LoadingSkeleton preset="detail" label="Loading form" />
        )}
      </SheetContent>
    </Sheet>
  );
}
