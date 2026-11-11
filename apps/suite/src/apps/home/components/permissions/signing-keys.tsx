// AUTHORED-BY Claude Opus 5.5
"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
  toast,
} from "@jeswr/suite-ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { AgentWorkspaceProvider, useAgentWorkspace } from "../../../agent/lib/hooks";
import {
  type ApprovalKeyRow,
  listApprovalKeys,
  type RevocationImpact,
  revocationImpact,
  revokeApprovalKey,
} from "../../../agent/lib/key-admin";
import { useHomeSession } from "../home-app";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" });
const created = (row: ApprovalKeyRow) =>
  `Added ${dateFormat.format(new Date(`${row.created}T00:00:00Z`))}`;

function impactText(impact: RevocationImpact) {
  const lines = [
    "Your agent stops accepting approvals signed with this key.",
    impact.statements
      ? `This device signs ${impact.statements} of your agent's stop or hide instructions again so they keep working.`
      : "",
    impact.lapsing
      ? `${impact.lapsing} instruction${impact.lapsing === 1 ? "" : "s"} that allowed your agent to do more will stop counting. Turn them back on from this device if you still want them.`
      : "",
    impact.permissions
      ? "Your agent's permissions were granted with this key, so it will stop until you grant them again."
      : "",
  ];
  return lines.filter(Boolean);
}

function RevokeKey({ row, onRevoked }: { row: ApprovalKeyRow; onRevoked: () => void }) {
  const { client, session } = useAgentWorkspace();
  const [open, setOpen] = useState(false);
  const [impact, setImpact] = useState<RevocationImpact | "loading" | { error: string }>("loading");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setImpact("loading");
    revocationImpact(client, session, row.id).then(
      (next) => active && setImpact(next),
      (error: unknown) =>
        active && setImpact({ error: error instanceof Error ? error.message : String(error) }),
    );
    return () => {
      active = false;
    };
  }, [open, client, session, row.id]);
  const revoke = async () => {
    setBusy(true);
    try {
      await revokeApprovalKey(client, session, row.id);
      setOpen(false);
      toast.success("Key revoked");
      onRevoked();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't revoke the key. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const ready = typeof impact === "object" && !("error" in impact);
  return (
    <AlertDialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
      {/* The trigger lets the dialog return focus to this button when it closes. */}
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" aria-label={`Revoke key ${created(row)}`}>
          Revoke
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Revoke this key?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="hm-signing-impact">
              {impact === "loading" ? (
                <p role="status">Checking what this key signed…</p>
              ) : "error" in impact ? (
                <p role="alert">{impact.error}</p>
              ) : (
                impactText(impact).map((line) => <p key={line}>{line}</p>)
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={!ready || busy}
            onClick={(event) => {
              // Keep the dialog open until the profile edit finishes.
              event.preventDefault();
              void revoke();
            }}
          >
            {busy ? "Revoking…" : "Revoke"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function KeyList() {
  const { session } = useAgentWorkspace();
  const heading = useRef<HTMLHeadingElement>(null);
  const [rows, setRows] = useState<ApprovalKeyRow[] | "loading" | "error">("loading");
  const load = useCallback(() => {
    listApprovalKeys(session).then(setRows, () => setRows("error"));
  }, [session]);
  useEffect(load, [load]);
  const hasDeviceKey = Array.isArray(rows) && rows.some((row) => row.thisDevice);
  return (
    <section className="hm-permission-about hm-signing-keys" aria-labelledby="signing-keys">
      <h3 id="signing-keys" ref={heading} tabIndex={-1}>
        Signing keys
      </h3>
      <p className="hm-permission-muted">
        Each device you approve your agent's actions from has its own key. Revoke a key for a device
        you no longer use.
      </p>
      {rows === "loading" ? (
        <p role="status">Loading keys…</p>
      ) : rows === "error" ? (
        <p role="alert">Couldn't read your keys. Try again later.</p>
      ) : rows.length === 0 ? (
        <p>No devices have a key yet. Set one up from your agent.</p>
      ) : (
        <ul className="hm-signing-list">
          {rows.map((row) => (
            <li key={row.id}>
              <span>
                {row.thisDevice ? "This device" : "Another device"}
                <span className="hm-permission-muted"> · {created(row)}</span>
              </span>
              {!row.thisDevice && hasDeviceKey && (
                <RevokeKey
                  row={row}
                  onRevoked={() => {
                    // The revoked row and its button are gone, so focus moves to the heading.
                    heading.current?.focus();
                    load();
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {Array.isArray(rows) && rows.length > 0 && !hasDeviceKey && (
        <p className="hm-permission-muted">
          To revoke a key, first set up this device from your agent.
        </p>
      )}
    </section>
  );
}

/** Owner approval keys. Hidden when the account has no agent workspace. */
export function SigningKeys() {
  const session = useHomeSession();
  return (
    <AgentWorkspaceProvider session={session} fallback={() => null}>
      <KeyList />
    </AgentWorkspaceProvider>
  );
}
