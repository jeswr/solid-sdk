// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import type { Account } from "@jeswr/agent-model";
import {
  Badge,
  Button,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@jeswr/suite-ui";
import { Ban, Brain, Calendar, CreditCard, Mail, Plug } from "lucide-react";
import Link from "next/link";
import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from "react";
import { formatRelativeTime } from "../lib/format";
import { useAgentQuery, useAgentWorkspace } from "../lib/hooks";
import { resourceSlug } from "../lib/paths";
import { canBulkApprove, type PendingApproval } from "../lib/queue";
import { loadedRecords, readAccounts } from "../lib/readers";
import { createAgentSigner } from "../lib/sign";
import { useApprovalQueue } from "../lib/use-queue";
import { AgentControl } from "./agent-control";
import { useApprovalDevice } from "./approval-key-setup-sheet";
import { DetailScreen, DisabledAction, QueryRows, Screen } from "./states";
import { OfflineBanner, useDaemonStatus } from "./status-pill";

function Recipient({ hash, accounts }: { hash: string; accounts: Account[] }) {
  const own = accounts.find((account) => account.channelHandleHash === hash);
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard users can reveal the full recipient hash */}
          <span tabIndex={0} title={hash}>
            <Badge variant="outline">
              {own?.label ?? "Someone else"} · {hash.slice(0, 8)}
            </Badge>
          </span>
        </TooltipTrigger>
        <TooltipContent>{hash}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
function ApprovalSummary({ row, accounts }: { row: PendingApproval; accounts: Account[] }) {
  const { proposal, reason } = row;
  const icons = { send: Mail, remember: Brain, book: Calendar, pay: CreditCard, connect: Plug };
  const Icon =
    reason === "Never" ? Ban : (icons[proposal.intent.action as keyof typeof icons] ?? Mail);
  return (
    <>
      <Icon size={18} aria-hidden="true" />
      <strong>{String(proposal.intent.parameters.summary ?? proposal.intent.action)}</strong>
      <Badge variant="secondary">{proposal.intent.binding}</Badge>
      <Recipient hash={proposal.intent.recipientHash} accounts={accounts} />
      <span>
        {proposal.intent.amount.value} {proposal.intent.amount.currency}
      </span>
      <span>{formatRelativeTime(row.expiresIn, 0, true)}</span>
      <Badge variant={reason === "Never" ? "destructive" : "secondary"}>{reason}</Badge>
    </>
  );
}
function ApprovalDetail({
  row,
  accounts,
  decide,
  busy,
}: {
  row: PendingApproval;
  accounts: Account[];
  decide(row: PendingApproval, decision: "approve" | "deny"): void;
  busy: boolean;
}) {
  const action = useRef(decide);
  action.current = decide;
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        target.closest(
          "input,textarea,select,[contenteditable]:not([contenteditable=false]),[role=dialog]:not(.agent-detail-sheet),[role=alertdialog]",
        )
      )
        return;
      // A setup sheet may be open outside the detail's DOM subtree.
      if (
        document.querySelector(
          '[data-slot="sheet-content"]:not(.agent-approval-detail),[role="alertdialog"]',
        )
      )
        return;
      if (
        !busy &&
        row.state === "pending" &&
        (event.key === "d" || (event.key === "a" && row.reason !== "Never"))
      ) {
        event.preventDefault();
        action.current(row, event.key === "a" ? "approve" : "deny");
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [row, busy]);
  return (
    <article className="agent-card">
      <div className="agent-row">
        <ApprovalSummary row={row} accounts={accounts} />
      </div>
      <h2>Exact preview</h2>
      <pre>{row.proposal.renderedPreview}</pre>
      {row.reason === "Never" && <p>Your permissions never allow this</p>}
      <DecisionState row={row} />
      <details>
        <summary>Advanced</summary>
        <p>Terms digest</p>
        <code>{row.proposal.intent.termsDigest}</code>
        <Button
          variant="outline"
          onClick={() => void navigator.clipboard.writeText(row.proposal.intent.termsDigest)}
        >
          Copy digest
        </Button>
        <p>
          Rule requiring approval:{" "}
          {String(row.proposal.intent.parameters.approvalRule ?? "Ask before this action")}
        </p>
        <p>
          {row.verification === "verified"
            ? "Verified"
            : row.verification === "unchecked"
              ? "Unchecked"
              : `Invalid (${row.verification.invalid})`}
        </p>
      </details>
      <div className="agent-row">
        <Button
          disabled={busy || row.reason === "Never" || row.state !== "pending"}
          onClick={() => decide(row, "approve")}
        >
          Approve
        </Button>
        <DisabledAction tip="Available once you can edit permissions">
          Approve and allow similar for 7 days
        </DisabledAction>
        <Button
          variant="outline"
          disabled={busy || row.state !== "pending"}
          onClick={() => decide(row, "deny")}
        >
          Deny
        </Button>
      </div>
    </article>
  );
}
function DecisionState({ row }: { row: PendingApproval }) {
  return (
    <div role="status">
      {row.state === "approved" && (
        <>
          <p>Approved, the agent will send within a minute</p>
          <AgentControl stopped={false} link />
        </>
      )}
      {row.state === "sent" && <p>Sent</p>}
      {row.state === "denied" && <p>Denied</p>}
      {row.needsNewApproval && <p>Needs a new approval</p>}
    </div>
  );
}
export function ApprovalsScreen({ id }: { id?: string }) {
  const query = useApprovalQueue();
  const status = useDaemonStatus();
  const { client, session } = useAgentWorkspace();
  const device = useApprovalDevice();
  const accounts = useAgentQuery(client.paths.accounts, readAccounts);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [optimistic, setOptimistic] = useState<
    Record<string, { digest: string; state: "approved" | "denied" }>
  >({});
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState(false);
  const decide = (rows: PendingApproval[], decision: "approve" | "deny") => {
    if (inFlight.current) return;
    void device.requireKey(() => {
      if (inFlight.current) return;
      inFlight.current = true;
      setBusy(true);
      setError(false);
      const run = async () => {
        for (const row of rows) {
          const proposal = row.proposal;
          setOptimistic((current) => ({
            ...current,
            [proposal.id]: {
              digest: proposal.intent.termsDigest,
              state: decision === "approve" ? "approved" : "denied",
            },
          }));
          try {
            await createAgentSigner(session, client).signApproval(proposal, decision);
          } catch {
            setOptimistic((current) => {
              const next = { ...current };
              delete next[proposal.id];
              return next;
            });
            throw new Error("Approval couldn't be saved");
          }
        }
        setSelected(new Set());
      };
      void run()
        .catch(() => setError(true))
        .finally(() => {
          inFlight.current = false;
          setBusy(false);
          query.reload();
        });
    });
  };
  const own = accounts.status === "ready" ? loadedRecords(accounts.data) : [];
  const content = (
    <>
      <OfflineBanner status={status} />
      {error && <p role="alert">Couldn't save your decision. Try again.</p>}
      <QueryRows query={query} empty="Nothing waiting for you">
        {(records) => {
          const rows = records.map((row) => {
            const local = optimistic[row.proposal.id];
            return busy &&
              local &&
              local.digest === row.proposal.intent.termsDigest &&
              row.state === "pending" &&
              !row.needsNewApproval
              ? { ...row, state: local.state, approvedAwaitingSend: local.state === "approved" }
              : row;
          });
          if (id) {
            const row = rows.find((row) => resourceSlug(row.proposal.id) === id);
            return row ? (
              <ApprovalDetail
                row={row}
                accounts={own}
                busy={busy}
                decide={(row, decision) => decide([row], decision)}
              />
            ) : (
              <p>This proposal is no longer waiting for approval.</p>
            );
          }
          const chosen = rows.filter((row) => selected.has(row.proposal.id));
          return (
            <>
              <Button
                disabled={busy || !canBulkApprove(chosen)}
                onClick={() => decide(chosen, "approve")}
              >
                Approve all
              </Button>
              <ul className="agent-list" aria-label="Approval requests">
                {rows.map((row) => (
                  <li key={row.proposal.id} className="agent-card">
                    <label className="agent-row">
                      <input
                        type="checkbox"
                        checked={selected.has(row.proposal.id)}
                        disabled={row.state !== "pending" || row.reason === "Never"}
                        onChange={(event) =>
                          setSelected((current) => {
                            const next = new Set(current);
                            if (event.target.checked) next.add(row.proposal.id);
                            else next.delete(row.proposal.id);
                            return next;
                          })
                        }
                      />
                      Select{" "}
                      {String(row.proposal.intent.parameters.summary ?? row.proposal.intent.action)}
                    </label>
                    <div className="agent-row">
                      <ApprovalSummary row={row} accounts={own} />
                    </div>
                    <DecisionState row={row} />
                    <Link
                      data-agent-approval-link
                      href={`/agent/approvals/${encodeURIComponent(resourceSlug(row.proposal.id) ?? "")}`}
                      onKeyDown={(event: ReactKeyboardEvent<HTMLAnchorElement>) => {
                        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
                        event.preventDefault();
                        const links = [
                          ...(event.currentTarget
                            .closest("ul")
                            ?.querySelectorAll<HTMLAnchorElement>("[data-agent-approval-link]") ??
                            []),
                        ];
                        const index = links.indexOf(event.currentTarget);
                        links[
                          (index + (event.key === "ArrowDown" ? 1 : links.length - 1)) %
                            links.length
                        ]?.focus();
                      }}
                    >
                      Review{" "}
                      {String(row.proposal.intent.parameters.summary ?? row.proposal.intent.action)}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          );
        }}
      </QueryRows>
    </>
  );
  return id ? (
    <DetailScreen title="Approval details" back="/agent/approvals">
      {content}
    </DetailScreen>
  ) : (
    <Screen title="Approvals">{content}</Screen>
  );
}
