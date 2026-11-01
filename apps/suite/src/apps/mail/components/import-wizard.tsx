// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Button, formatBytes, Input, Progress, toast } from "@jeswr/suite-ui";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  fileChunks,
  type ImportProgress,
  type ImportResult,
  MailFileError,
  mailErrorMessage,
} from "../lib/client";
import { useMail } from "../state/mail-context";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export function ImportWizard() {
  const { client, setAccount, invalidate } = useMail();
  const [file, setFile] = useState<File>();
  const [account, setName] = useState("imported");
  const validAccount = SLUG.test(account) && account !== "attachments";
  const [step, setStep] = useState<"choose" | "importing" | "done">("choose");
  const [progress, setProgress] = useState<ImportProgress>({
    messages: 0,
    attachments: 0,
    bytes: 0,
    failed: 0,
  });
  const [result, setResult] = useState<ImportResult>();
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const busy = useRef(false);
  const alive = useRef(false);
  const generation = useRef(0);
  const picker = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const leave = useCallback(() => {
    generation.current++;
    controller.current?.abort();
  }, []);
  const nameId = useId();
  const fileId = useId();
  const pick = (file: File | undefined) => {
    setError("");
    setFile(undefined);
    if (!file) return;
    if (/\.zip$/i.test(file.name)) {
      setError(new MailFileError().message);
      return;
    }
    if (!/\.(mbox|mbx)$/i.test(file.name)) {
      setError("Choose an .mbox or .mbx mailbox export.");
      return;
    }
    setFile(file);
  };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      generation.current++;
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (step !== "importing") return;
    const unload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    let leaving = false;
    const click = (event: MouseEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.button !== 0)
        return;
      const target = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!target) return;
      if (!window.confirm("An import is in progress. Leave and cancel the remaining messages?")) {
        event.preventDefault();
        event.stopImmediatePropagation();
      } else leave();
    };
    // A same-URL history entry catches browser Back before it leaves this route.
    history.pushState({ ...history.state, mailImportGuard: true }, "", location.href);
    const pop = () => {
      if (leaving) return;
      if (window.confirm("An import is in progress. Leave and cancel the remaining messages?")) {
        leaving = true;
        leave();
        history.back();
      } else history.pushState({ ...history.state, mailImportGuard: true }, "", location.href);
    };
    window.addEventListener("popstate", pop);
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("popstate", pop);
      if (history.state?.mailImportGuard) {
        const { mailImportGuard: _guard, ...state } = history.state;
        history.replaceState(state, "", location.href);
      }
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", click, true);
    };
  }, [step, leave]);
  const start = async () => {
    if (!file || !validAccount || busy.current) return;
    busy.current = true;
    const run = ++generation.current;
    const current = () => alive.current && generation.current === run;
    const abort = new AbortController();
    controller.current = abort;
    setStep("importing");
    setError("");
    try {
      const summary = await client.importMailbox(account, fileChunks(file), {
        signal: abort.signal,
        onProgress: (value) => {
          if (current()) setProgress(value);
        },
      });
      if (!current()) return;
      setResult(summary);
      setProgress(summary);
      setAccount(account);
      invalidate();
      setStep("done");
    } catch (error) {
      if (!current()) return;
      setError(mailErrorMessage(error));
      setStep("choose");
      invalidate();
      toast.error(mailErrorMessage(error));
    } finally {
      if (current()) {
        busy.current = false;
        controller.current = null;
      }
    }
  };
  return (
    <div className="mail-page mail-import">
      <h1>Import mail</h1>
      <ol className="mail-steps" aria-label="Import steps">
        <li aria-current={step === "choose" ? "step" : undefined}>1. Choose mailbox</li>
        <li aria-current={step === "importing" ? "step" : undefined}>2. Import</li>
        <li aria-current={step === "done" ? "step" : undefined}>3. Summary</li>
      </ol>
      {step === "choose" && (
        <form
          className="mail-form"
          aria-label="Mailbox import"
          onSubmit={(event) => {
            event.preventDefault();
            void start();
          }}
        >
          <p>
            Import a mailbox export to read and organise it in your pod. Sending and live sync need
            a connected mail account.
          </p>
          <section
            className="mail-file-picker"
            aria-label="Choose a mailbox export"
            data-dragging={dragging}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              if (event.dataTransfer.files.length !== 1) {
                setError("Choose one mailbox file at a time.");
                return;
              }
              pick(event.dataTransfer.files[0]);
            }}
          >
            <label htmlFor={fileId} className="mail-visually-hidden">
              Mailbox file
            </label>
            <input
              id={fileId}
              ref={picker}
              type="file"
              hidden
              accept=".mbox,.mbx,.zip,application/mbox"
              onChange={(event) => pick(event.target.files?.[0])}
            />
            <Button variant="outline" onClick={() => picker.current?.click()}>
              Choose mailbox file
            </Button>
            <p className="mail-muted">Or drag and drop an .mbox or .mbx file here.</p>
            {file && (
              <p className="mail-picked-file">
                {file.name} · {formatBytes(file.size)}
              </p>
            )}
          </section>
          <label htmlFor={nameId}>Account name</label>
          <Input
            id={nameId}
            value={account}
            onChange={(event) => setName(event.target.value)}
            aria-invalid={!validAccount}
            aria-describedby={`${nameId}-help`}
          />
          <p id={`${nameId}-help`} className="mail-muted">
            Use lowercase letters, numbers and single hyphens, for example personal-mail.
          </p>
          {!validAccount && (
            <p role="alert">Choose a valid account name; “attachments” is reserved.</p>
          )}
          <details>
            <summary>Get a mailbox export</summary>
            <ul>
              <li>
                Gmail: use Google Takeout, select Mail, download the export, then unzip it and
                choose the .mbox file.
              </li>
              <li>
                Thunderbird: locate the mailbox files in your profile's Mail folder. Copy the
                mailbox without the .msf index and give the copy an .mbox extension.
              </li>
              <li>
                Apple Mail: select a mailbox, choose Mailbox → Export Mailbox, then choose the mbox
                file inside the exported folder.
              </li>
            </ul>
          </details>
          {error && <p role="alert">{error}</p>}
          <Button type="submit" disabled={!file || !validAccount}>
            Import mailbox
          </Button>
        </form>
      )}
      {step === "importing" && (
        <section className="mail-form" aria-label="Import progress">
          <h2>Importing {file?.name}</h2>
          <Progress
            value={file?.size ? Math.min(100, (progress.bytes / file.size) * 100) : 0}
            aria-label="Mailbox bytes processed"
          />
          <p role="status" aria-live="polite" aria-atomic="true">
            {progress.messages} messages imported · {progress.attachments} attachments ·{" "}
            {progress.failed} failed · {progress.bytes.toLocaleString()} bytes read
          </p>
          <p className="mail-muted">Keep this page open while messages are saved.</p>
          <Button variant="outline" onClick={() => controller.current?.abort()}>
            Cancel import
          </Button>
        </section>
      )}
      {step === "done" && result && (
        <section className="mail-form" aria-label="Import summary">
          <h2>{result.aborted ? "Import cancelled" : "Import complete"}</h2>
          <p>
            {result.messages} messages imported · {result.attachments} attachments · {result.failed}{" "}
            failed
          </p>
          <p>
            {result.typeIndex === "registered"
              ? "Type Index: Mail registered for other pod apps."
              : result.typeIndex === "missing"
                ? "Type Index: No private index found. Your mail is still available here."
                : "Type Index: Registration failed. Your imported mail is available here."}
          </p>
          {result.typeIndex === "failed" && <p>{mailErrorMessage(result.typeIndexError)}</p>}
          {result.failures.length > 0 && (
            <details>
              <summary>Show failed messages</summary>
              <ul>
                {result.failures.map((failure, i) => (
                  <li key={failure.iri}>
                    Message {i + 1}: {mailErrorMessage(failure.error)}
                  </li>
                ))}
              </ul>
              <p>
                Failed imports can leave partial resources. Refresh before trying again; existing
                messages are never overwritten.
              </p>
            </details>
          )}
          <Link href="/mail/inbox" className="mail-action-link">
            Open Inbox
          </Link>
          <Button
            variant="ghost"
            onClick={() => {
              setStep("choose");
              setFile(undefined);
            }}
          >
            Import another mailbox
          </Button>
        </section>
      )}
    </div>
  );
}
