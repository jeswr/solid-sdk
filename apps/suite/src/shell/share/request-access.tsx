// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Button, Input, Label, RoleSelect, Textarea } from "@jeswr/suite-ui";
import { useEffect, useId, useRef, useState } from "react";
import { useSyncSnapshot } from "../sync/online";
import styles from "./share.module.css";
import type { ShareCapabilities, ShareRole, SharingAdapter } from "./types";

export function RequestAccess(props: {
  url: string;
  adapter: SharingAdapter;
  caps: ShareCapabilities;
  onCopyAccountId: () => void | Promise<void>;
}) {
  // Reset the form before displaying another account's adapter or resource.
  const [session, setSession] = useState({ adapter: props.adapter, serial: 0 });
  if (session.adapter !== props.adapter)
    setSession({ adapter: props.adapter, serial: session.serial + 1 });
  return <RequestForm key={`${session.serial}:${props.url}`} {...props} />;
}
function RequestForm({
  url,
  adapter,
  caps,
  onCopyAccountId,
}: {
  url: string;
  adapter: SharingAdapter;
  caps: ShareCapabilities;
  onCopyAccountId: () => void | Promise<void>;
}) {
  const id = useId();
  const [role, setRole] = useState<ShareRole>("viewer");
  const [message, setMessage] = useState("");
  const [purpose, setPurpose] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const generation = useRef(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Replacing an account adapter invalidates requests from the previous account.
  useEffect(() => {
    generation.current += 1;
    lock.current = false;
    setBusy(false);
    setStatus("");
    setError("");
    return () => {
      generation.current += 1;
    };
  }, [adapter]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const online = useSyncSnapshot().online;
  if (!caps.accessRequests || !adapter.requestAccess)
    return (
      <div className={styles.section}>
        <p>Ask the owner to share this with you</p>
        <Button
          variant="outline"
          onClick={async () => {
            const epoch = generation.current;
            setError("");
            try {
              await onCopyAccountId();
              if (generation.current === epoch) setStatus("Account ID copied");
            } catch {
              if (generation.current === epoch)
                setError("Couldn't copy your Account ID. Try again.");
            }
          }}
        >
          Copy my Account ID
        </Button>
        <p role="status">{status}</p>
        {error && <p role="alert">{error}</p>}
      </div>
    );
  if (status) return <p role="status">{status}</p>;
  return (
    <form
      className={styles.section}
      aria-label="Request access"
      onSubmit={async (event) => {
        event.preventDefault();
        const request = adapter.requestAccess;
        if (lock.current || !online || !navigator.onLine || !request) return;
        const epoch = generation.current;
        lock.current = true;
        setBusy(true);
        setError("");
        try {
          await request.call(adapter, url, {
            role,
            ...(message.trim() ? { message: message.trim() } : {}),
            ...(caps.grantPurpose && purpose.trim() ? { purpose: purpose.trim() } : {}),
          });
          if (generation.current === epoch) setStatus("Request sent to the owner");
        } catch {
          if (generation.current === epoch) setError("Couldn't send your request. Try again.");
        } finally {
          if (generation.current === epoch) {
            lock.current = false;
            setBusy(false);
          }
        }
      }}
    >
      <RoleSelect
        label="Access wanted"
        roles={[
          "viewer",
          ...(adapter.supportsCommenter !== false ? ["commenter" as const] : []),
          "editor",
          ...(caps.managerRole ? ["manager" as const] : []),
        ]}
        value={role}
        onChange={setRole}
        disabled={busy || !online}
      />
      <Label htmlFor={`${id}-message`}>Message (optional)</Label>
      <Textarea
        id={`${id}-message`}
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        disabled={busy || !online}
      />
      {caps.grantPurpose && (
        <>
          <Label htmlFor={`${id}-purpose`}>What is this for?</Label>
          <Input
            id={`${id}-purpose`}
            value={purpose}
            onChange={(event) => setPurpose(event.target.value)}
            disabled={busy || !online}
          />
        </>
      )}
      {!online && <p role="status">Reconnect to request access</p>}
      {error && <p role="alert">{error}</p>}
      <Button type="submit" disabled={busy || !online}>
        {busy ? "Sending…" : "Request access"}
      </Button>
    </form>
  );
}
