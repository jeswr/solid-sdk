// AUTHORED-BY Codex (GPT-6.1 Sol)
"use client";
import {
  type CredentialCheck,
  checkCredential,
  expiryStatus,
  KIND_LABELS,
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
  ErrorState,
  LoadingSkeleton,
  PreviewPane,
} from "@jeswr/suite-ui";
import { useEffect, useState } from "react";
import { useConnectionState } from "@/shell/sync/connection-state";
import { walletVerification } from "../lib/data/client";
import { useWallet } from "../state/wallet-context";
export function ItemDetail({
  item,
  close,
  edit,
  remove,
}: {
  item: WalletRecord;
  close: () => void;
  edit: () => void;
  remove: () => void;
}) {
  const { state, session, snapshot } = useWallet();
  const connection = useConnectionState();
  const online = session.mode === "demo" || connection === "online";
  const [preview, setPreview] = useState<{ blob?: Blob; error?: boolean }>({});
  const [check, setCheck] = useState<CredentialCheck>();
  const [summary, setSummary] = useState<ReturnType<typeof summariseCredential>>();
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt retries the authenticated preview read
  useEffect(() => {
    let live = true;
    setPreview({});
    if (item.file)
      void state.repository.preview(item.file).then(
        (blob) => {
          if (live) setPreview({ blob });
        },
        () => {
          if (live) setPreview({ error: true });
        },
      );
    return () => {
      live = false;
    };
  }, [item.file, state, attempt]);
  useEffect(() => {
    let live = true;
    setCheck(undefined);
    setSummary(undefined);
    if (item.credential)
      void (async () => {
        const source = await state.repository.credential(item.credential as string);
        const parsed = await parseCredential(source);
        if (live) setSummary(summariseCredential(parsed));
        const result = await checkCredential(source, walletVerification(session));
        if (live) setCheck(result);
      })().catch((reason) => {
        if (live)
          setCheck({
            state: "unknown",
            title: "Could not check",
            reason:
              reason instanceof Error
                ? reason.message
                : "The credential could not be loaded. Reconnect and try again.",
          });
      });
    return () => {
      live = false;
    };
  }, [item.credential, state, session]);
  const fields = [
    ["Document kind", KIND_LABELS[item.kind]],
    ["Number or identifier", item.identifier],
    ["Issuer", item.issuerName],
    ["Holder", item.holderName],
    ["Valid from", item.validFrom?.toISOString().slice(0, 10)],
    ["Expires", item.expires?.toISOString().slice(0, 10)],
    ["Tags", item.tags?.join(", ")],
    ["Notes", item.notes],
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
          <DialogTitle>{item.name}</DialogTitle>
          <DialogDescription>
            {item.credential
              ? "Credential claims are shown as supplied. Verification is checked again each time you open this document."
              : `Document details · ${expiryStatus(item, new Date()).replaceAll("-", " ")}`}
          </DialogDescription>
        </DialogHeader>
        <div className="wallet-detail">
          <dl>
            {fields
              .filter(([, value]) => value)
              .map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
          </dl>
          {item.credential && (
            <section
              aria-label="Credential verification"
              className="wallet-verification"
              data-state={check?.state}
            >
              {!check ? (
                <LoadingSkeleton preset="list" label="Checking credential signature and status" />
              ) : (
                <>
                  <h3>{check.title}</h3>
                  <p>{check.reason}</p>
                </>
              )}
              {summary && (
                <>
                  <p>Issuer supplied claims</p>
                  <dl>
                    {summary.fields.map((field) => (
                      <div key={`${field.subject}:${field.name}`}>
                        <dt>{field.name}</dt>
                        <dd>{field.value}</dd>
                      </div>
                    ))}
                  </dl>
                  <p>
                    Status entry:{" "}
                    {summary.status
                      ? JSON.stringify(summary.status)
                      : "The issuer supplies no revocation mechanism."}
                  </p>
                </>
              )}
            </section>
          )}
          {item.file && (
            <section aria-label="Attached file">
              <h3>Attached file</h3>
              {preview.error ? (
                <ErrorState
                  error="unreachable"
                  actions={{ retry: () => setAttempt((value) => value + 1) }}
                >
                  <p>Couldn't open this file. Reconnect and try again.</p>
                </ErrorState>
              ) : preview.blob ? (
                <PreviewPane
                  source={{ name: item.name, blob: preview.blob, contentType: preview.blob.type }}
                />
              ) : (
                <LoadingSkeleton preset="list" label="Loading attached file" />
              )}
            </section>
          )}
          <p className="wallet-muted">
            Deleting removes this entry. Attached files and original credentials stay in your pod
            for recovery.
          </p>
          <div className="wallet-actions">
            <Button
              variant="outline"
              onClick={edit}
              disabled={!online || snapshot.busy.includes(item.url)}
            >
              Edit document
            </Button>
            <Button
              variant="destructive"
              onClick={remove}
              disabled={!online || snapshot.busy.includes(item.url)}
            >
              Delete document
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
