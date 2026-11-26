// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import {
  Button,
  Checkbox,
  type DroppedFiles,
  DropZoneOverlay,
  EmptyState,
  Input,
  LoadingSkeleton,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@jeswr/suite-ui";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { readCardDav } from "../lib/carddav";
import {
  type ImportResult,
  type ImportRow,
  importContacts,
  previewVcards,
} from "../lib/import-export";
import { useAddressBook, useContactMutations } from "../state/contacts-context";
import { encodeContactRef } from "../state/data";
import { ContactLoadError } from "./contact-load-error";

export function ContactImport() {
  const state = useAddressBook();
  const mutations = useContactMutations();
  const [step, setStep] = useState(1);
  const [source, setSource] = useState("files");
  const [online, setOnline] = useState(true);
  const [url, setUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [label, setLabel] = useState("none");
  const [completed, setCompleted] = useState(0);
  const [result, setResult] = useState<ImportResult>();
  const heading = useRef<HTMLHeadingElement>(null);
  const running = useRef(false);
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    addEventListener("online", sync);
    addEventListener("offline", sync);
    return () => {
      removeEventListener("online", sync);
      removeEventListener("offline", sync);
    };
  }, []);
  // Each step gets a clear reading and keyboard starting point.
  // biome-ignore lint/correctness/useExhaustiveDependencies: A step transition moves focus to its heading.
  useEffect(() => {
    heading.current?.focus();
  }, [step]);
  const preview = (text: string) => {
    setRows(
      previewVcards(
        text,
        state.data.people.map((person) => person.data),
      ),
    );
    setError("");
    setStep(2);
  };
  const readFiles = async ({ files }: DroppedFiles) => {
    setBusy(true);
    setError("");
    try {
      if (
        !files.length ||
        files.length > 100 ||
        files.some(({ file }) => !/\.vcf$/i.test(file.name)) ||
        files.reduce((sum, { file }) => sum + file.size, 0) > 10 * 1024 * 1024
      )
        throw new Error("Choose up to 100 .vcf files, totalling at most 10 MB.");
      const texts = await Promise.all(files.map(({ file }) => file.text()));
      preview(texts.map((text) => text.replace(/^\uFEFF/, "")).join("\r\n"));
    } catch {
      setError(
        "Could not read these vCards. Choose valid vCard 3.0 or 4.0 .vcf files (up to 100 files and 10 MB in total).",
      );
    } finally {
      setBusy(false);
    }
  };
  if (state.status === "loading")
    return <LoadingSkeleton preset="detail" label="Loading import wizard" />;
  if (state.status === "error") return <ContactLoadError onRetry={state.retry} />;
  if (!state.book)
    return (
      <EmptyState
        title="Create your address book first"
        primaryAction={
          <Button
            onClick={() => {
              void state.createAddressBook().catch(() => {});
            }}
          >
            Create address book
          </Button>
        }
      />
    );
  const book = state.book;
  const selected = rows.filter((row) => row.include).length;
  return (
    <section className="con-wizard" aria-label="Import contacts">
      <h1>Import contacts</h1>
      <ol className="con-wizard-steps" aria-label="Import steps">
        {["Source", "Preview", "Import"].map((name, index) => (
          <li key={name} aria-current={step === index + 1 ? "step" : undefined}>
            {index + 1}. {name}
          </li>
        ))}
      </ol>
      <h2 ref={heading} tabIndex={-1}>
        {step === 1 ? "Choose a source" : step === 2 ? "Preview contacts" : "Import results"}
      </h2>
      {error && <p role="alert">{error}</p>}
      {step === 1 && (
        <>
          <div className="con-form-actions">
            <Button
              variant={source === "files" ? "default" : "outline"}
              aria-pressed={source === "files"}
              onClick={() => {
                setSource("files");
                setError("");
              }}
              disabled={busy}
            >
              vCard files
            </Button>
            <Button
              data-requires-online="true"
              aria-pressed={source === "dav"}
              aria-describedby={!online ? "con-dav-offline" : undefined}
              disabled={!online || busy}
              variant={source === "dav" ? "default" : "outline"}
              onClick={() => {
                setSource("dav");
                setError("");
              }}
            >
              From a CardDAV server
            </Button>
          </div>
          {!online && (
            <p id="con-dav-offline">
              Reconnect to import from a CardDAV server. You can still import .vcf files offline.
            </p>
          )}
          {source === "files" ? (
            <DropZoneOverlay
              folderName="Contacts"
              onFiles={readFiles}
              disabled={busy}
              readOptions={{ maxEntries: 100, maxDepth: 0 }}
            >
              <p className="con-drop-help">
                Drop .vcf files here, or choose Upload files. Multiple vCard 3.0 and 4.0 files are
                supported.
              </p>
            </DropZoneOverlay>
          ) : (
            <form
              className="con-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (!online || busy) return;
                setBusy(true);
                setError("");
                void readCardDav(url.trim(), username, password, globalThis.fetch.bind(globalThis))
                  .then(preview)
                  .catch(() =>
                    setError(
                      "Could not read this CardDAV server. Check the HTTPS address and credentials. The server may block browser access (CORS); export a .vcf file and import it instead.",
                    ),
                  )
                  .finally(() => {
                    setPassword("");
                    setUsername("");
                    setBusy(false);
                  });
              }}
            >
              <div className="con-field">
                <label htmlFor="con-dav-url">CardDAV URL</label>
                <Input
                  id="con-dav-url"
                  type="url"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  required
                  disabled={busy}
                />
              </div>
              <div className="con-field">
                <label htmlFor="con-dav-user">Username</label>
                <Input
                  id="con-dav-user"
                  autoComplete="off"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  disabled={busy}
                />
              </div>
              <div className="con-field">
                <label htmlFor="con-dav-password">Password</label>
                <Input
                  id="con-dav-password"
                  type="password"
                  autoComplete="off"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={busy}
                />
              </div>
              <p className="con-field-help">
                Credentials are kept only in memory for this request.
              </p>
              <Button type="submit" disabled={!online || busy}>
                Preview server contacts
              </Button>
            </form>
          )}
          <p role="status" aria-live="polite">
            {busy ? "Reading contacts…" : ""}
          </p>
          <Button variant="ghost" asChild>
            <Link href="/contacts">Cancel</Link>
          </Button>
        </>
      )}
      {step === 2 && (
        <>
          <p>Choose which contacts to import. Duplicates are unchecked by default.</p>
          <div className="con-import-table">
            <table>
              <caption>Contacts to import</caption>
              <thead>
                <tr>
                  <th scope="col">Include</th>
                  <th scope="col">Name</th>
                  <th scope="col">Email</th>
                  <th scope="col">Phone</th>
                  <th scope="col">Warnings</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: Preview rows retain their fixed source order; inclusion never reorders or removes them.
                  <tr key={index}>
                    <td>
                      <Checkbox
                        aria-label={`Include ${row.data.name || "Unnamed contact"}`}
                        aria-describedby={
                          row.duplicates.length || row.warnings.length
                            ? `con-import-warnings-${index}`
                            : undefined
                        }
                        checked={row.include}
                        disabled={!row.valid}
                        onCheckedChange={(checked) =>
                          setRows((rows) =>
                            rows.map((item, at) =>
                              at === index ? { ...item, include: checked === true } : item,
                            ),
                          )
                        }
                      />
                    </td>
                    <th scope="row">{row.data.name || "Unnamed contact"}</th>
                    <td>
                      {row.data.emails?.map((email) => email.replace(/^mailto:/i, "")).join(", ")}
                    </td>
                    <td>{row.data.phones?.join(", ")}</td>
                    <td id={`con-import-warnings-${index}`}>
                      {row.duplicates.length > 0 && (
                        <p className="con-duplicate">
                          Possible duplicate: {row.duplicates.join(", ")}. Matching email or phone.
                        </p>
                      )}
                      {row.warnings.map((warning) => (
                        <p key={warning}>{warning}</p>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="con-field">
            <label id="con-import-label" htmlFor="con-import-select">
              Add to label (optional)
            </label>
            <Select value={label} onValueChange={setLabel}>
              <SelectTrigger id="con-import-select" aria-labelledby="con-import-label">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No label</SelectItem>
                {state.data.groups.map((group) => (
                  <SelectItem key={group.url} value={`${group.url}#this`}>
                    {group.data.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p role="status" aria-live="polite">
            {selected} contacts selected
          </p>
          <div className="con-form-actions">
            <Button
              disabled={!selected}
              onClick={() => {
                if (running.current) return;
                running.current = true;
                setStep(3);
                setBusy(true);
                void importContacts(
                  rows,
                  (data) => mutations.create(data),
                  label === "none" ? undefined : (id) => mutations.setLabel(id, label, true),
                  setCompleted,
                )
                  .then(setResult)
                  .finally(() => {
                    setBusy(false);
                    running.current = false;
                  });
              }}
            >
              Import {selected} contacts
            </Button>
            <Button variant="outline" onClick={() => setStep(1)}>
              Back to source
            </Button>
          </div>
        </>
      )}
      {step === 3 && (
        <>
          <p role="status" aria-live="polite" aria-atomic="true">
            {completed} of {selected} contacts processed{busy ? "…" : "."}
          </p>
          <progress aria-label="Import progress" value={completed} max={selected} />
          {result && (
            <>
              <p>
                {result.imported.length} contacts imported. {result.failed.length} failed.
              </p>
              {result.failed.length > 0 && (
                <p role="alert">
                  Could not import: {result.failed.join(", ")}. Review your address book before
                  retrying those contacts.
                </p>
              )}
              {result.labelFailed.length > 0 && (
                <p role="alert">
                  Contacts were saved, but the label could not be added to:{" "}
                  {result.labelFailed.join(", ")}. Add the label from their details.
                </p>
              )}
              <Button asChild>
                <Link
                  href={
                    label !== "none" && !result.labelFailed.length && result.imported.length
                      ? `/contacts/label/${encodeContactRef(book.url, label)}`
                      : result.imported.length
                        ? `/contacts?created=${result.imported.map((id) => encodeContactRef(book.url, id)).join(",")}`
                        : "/contacts"
                  }
                >
                  Done
                </Link>
              </Button>
            </>
          )}
        </>
      )}
    </section>
  );
}
