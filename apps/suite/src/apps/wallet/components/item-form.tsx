// AUTHORED-BY Codex (GPT-6.1 Sol)
"use client";
import {
  credentialFileText,
  ITEM_KINDS,
  type ItemKind,
  inputDate,
  KIND_LABELS,
  MAX_CREDENTIAL_BYTES,
  parseCredential,
  summariseCredential,
  type WalletRecord,
} from "@jeswr/solid-wallet";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Textarea,
  toast,
} from "@jeswr/suite-ui";
import { useId, useState } from "react";
import { useConnectionState } from "@/shell/sync/connection-state";
import { useWallet } from "../state/wallet-context";
export function ItemForm({
  mode,
  item,
  close,
}: {
  mode: "manual" | "credential";
  item?: WalletRecord;
  close: () => void;
}) {
  const { state, session } = useWallet();
  const connection = useConnectionState();
  const online = session.mode === "demo" || connection === "online";
  const prefix = useId();
  const [name, setName] = useState(item?.name ?? "");
  const [kind, setKind] = useState<ItemKind>(item?.kind ?? "other");
  const [identifier, setIdentifier] = useState(item?.identifier ?? "");
  const [issuer, setIssuer] = useState(item?.issuerName ?? "");
  const [holder, setHolder] = useState(item?.holderName ?? "");
  const [from, setFrom] = useState(item?.validFrom?.toISOString().slice(0, 10) ?? "");
  const [expires, setExpires] = useState(item?.expires?.toISOString().slice(0, 10) ?? "");
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [tags, setTags] = useState(item?.tags?.join(", ") ?? "");
  const [favourite, setFavourite] = useState(item?.favourite ?? false);
  const [file, setFile] = useState<File>();
  const [source, setSource] = useState("");
  const [error, setError] = useState("");
  const title = item ? "Edit document" : mode === "credential" ? "Add credential" : "Add document";
  const textFields = [
    { key: "name", label: "Name", value: name, set: setName },
    { key: "identifier", label: "Number or identifier", value: identifier, set: setIdentifier },
    { key: "issuer", label: "Issuer name", value: issuer, set: setIssuer },
    { key: "holder", label: "Holder name", value: holder, set: setHolder },
  ];
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent className="wallet-dialog">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {mode === "credential"
              ? "Paste or upload the original VC JSON-LD. Its signature and status are checked separately from its claims."
              : "Save a document's details and an optional scan in your private pod."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="wallet-form"
          onSubmit={(event) => {
            event.preventDefault();
            setError("");
            if (!online) {
              setError("Reconnect before saving this document");
              return;
            }
            void (async () => {
              const now = new Date();
              if (mode === "credential") {
                const parsed = await parseCredential(source);
                const summary = summariseCredential(parsed);
                const data = {
                  created: now,
                  modified: now,
                  name:
                    name.trim() ||
                    summary.types
                      .filter((type) => !type.endsWith("VerifiableCredential"))
                      .at(0)
                      ?.split(/[/#]/)
                      .at(-1) ||
                    "Credential",
                  kind: "verifiable-credential" as const,
                  issuerName: summary.issuer,
                  holderName: summary.holderName,
                  validFrom: summary.validFrom ? new Date(summary.validFrom) : undefined,
                  expires: summary.validUntil ? new Date(summary.validUntil) : undefined,
                  tags: [],
                  notes: "Imported claims are untrusted until verification completes.",
                };
                void state.save(data, undefined, undefined, source).catch(() => {});
                close();
                return;
              }
              if (!name.trim()) throw new TypeError("Enter a name for this document");
              const start = inputDate(from),
                end = inputDate(expires);
              if (start && end && start > end)
                throw new TypeError("The expiry date must be on or after the start date");
              if (
                file &&
                (!["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(
                  file.type,
                ) ||
                  file.size > 10_485_760)
              )
                throw new TypeError("Choose a JPEG, PNG, WebP or PDF up to 10 MiB");
              void state
                .save(
                  {
                    created: item?.created ?? now,
                    modified: now,
                    name: name.trim(),
                    kind,
                    identifier: identifier.trim() || undefined,
                    issuerName: issuer.trim() || undefined,
                    holderName: holder.trim() || undefined,
                    validFrom: start,
                    expires: end,
                    notes: notes.trim() || undefined,
                    tags: tags
                      .split(",")
                      .map((tag) => tag.trim())
                      .filter(Boolean),
                    favourite,
                    file: item?.file,
                    credential: item?.credential,
                  },
                  item,
                  file,
                )
                .catch(() => {});
              close();
            })().catch((reason) =>
              setError(reason instanceof Error ? reason.message : "Couldn't read this document"),
            );
          }}
        >
          {error && (
            <p role="alert" id={`${prefix}-error`}>
              {error}
            </p>
          )}
          {mode === "credential" ? (
            <>
              <Label htmlFor={`${prefix}-vc-name`}>Name (optional)</Label>
              <Input
                id={`${prefix}-vc-name`}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              <Label htmlFor={`${prefix}-json`}>Credential JSON-LD</Label>
              <Textarea
                id={`${prefix}-json`}
                rows={10}
                value={source}
                onChange={(event) => setSource(event.target.value)}
                aria-describedby={error ? `${prefix}-error` : undefined}
                placeholder="Paste the complete original credential"
              />
              <Label htmlFor={`${prefix}-json-file`}>Upload a JSON credential</Label>
              <Input
                id={`${prefix}-json-file`}
                type="file"
                accept=".json,.jsonld,application/json,application/ld+json"
                onChange={(event) => {
                  const selected = event.target.files?.[0];
                  if (!selected) return;
                  if (selected.size > MAX_CREDENTIAL_BYTES) {
                    setError("Credential must be smaller than 256 KiB");
                    return;
                  }
                  void selected
                    .arrayBuffer()
                    .then(credentialFileText)
                    .then(setSource, () => {
                      setError("Couldn't read this file");
                      toast.error("Couldn't read the credential file");
                    });
                }}
              />
            </>
          ) : (
            <>
              {textFields.map((field) => (
                <div key={field.key}>
                  <Label htmlFor={`${prefix}-${field.key}`}>{field.label}</Label>
                  <Input
                    id={`${prefix}-${field.key}`}
                    value={field.value}
                    onChange={(event) => field.set(event.target.value)}
                    maxLength={1000}
                    aria-required={field.key === "name"}
                    aria-describedby={field.key === "name" && error ? `${prefix}-error` : undefined}
                  />
                </div>
              ))}
              <div>
                <Label htmlFor={`${prefix}-kind`}>Document kind</Label>
                <select
                  id={`${prefix}-kind`}
                  className="wallet-select"
                  value={kind}
                  onChange={(event) => setKind(event.target.value as ItemKind)}
                >
                  {ITEM_KINDS.map((value) => (
                    <option key={value} value={value}>
                      {KIND_LABELS[value]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="wallet-dates">
                <div>
                  <Label htmlFor={`${prefix}-from`}>Valid from</Label>
                  <Input
                    type="date"
                    id={`${prefix}-from`}
                    value={from}
                    onChange={(event) => setFrom(event.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor={`${prefix}-expires`}>Expires</Label>
                  <Input
                    type="date"
                    id={`${prefix}-expires`}
                    value={expires}
                    onChange={(event) => setExpires(event.target.value)}
                  />
                </div>
              </div>
              <div>
                <Label htmlFor={`${prefix}-tags`}>Tags (comma separated)</Label>
                <Input
                  id={`${prefix}-tags`}
                  value={tags}
                  onChange={(event) => setTags(event.target.value)}
                />
              </div>
              <div>
                <Label htmlFor={`${prefix}-notes`}>Notes</Label>
                <Textarea
                  id={`${prefix}-notes`}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  maxLength={10000}
                />
              </div>
              <div>
                <Label htmlFor={`${prefix}-file`}>
                  {item?.file ? "Replace attached file" : "Attach scan or PDF"}
                </Label>
                <Input
                  type="file"
                  id={`${prefix}-file`}
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  onChange={(event) => setFile(event.target.files?.[0])}
                />
                <p className="wallet-muted">JPEG, PNG, WebP or PDF · up to 10 MiB</p>
              </div>
              <Label className="wallet-check">
                <input
                  type="checkbox"
                  checked={favourite}
                  onChange={(event) => setFavourite(event.target.checked)}
                />{" "}
                Favourite
              </Label>
            </>
          )}
          <div className="wallet-actions">
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={!online}>
              {mode === "credential" ? "Save credential" : "Save document"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
