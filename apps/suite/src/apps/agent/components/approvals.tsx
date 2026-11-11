// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
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
import { Brain, Calendar, CreditCard, Mail, Plug } from "lucide-react";
import Link from "next/link";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { approvalExplanation, approvalKind, previewParts } from "../lib/approval-details";
import type { Row } from "../lib/client";
import { collection, isComplete, metadataOf } from "../lib/collections";
import { saveTabState, tabState } from "../lib/device-state";
import { formatRelativeTime } from "../lib/format";
import { type Query, useAgentQuery, useAgentWorkspace } from "../lib/hooks";
import { mandateBoundaries } from "../lib/mandate-rules";
import {
  activateMandate,
  allowSimilar,
  canAllowSimilar,
  loadVerifiedMandate,
  PendingRevocation,
  proposalBadge,
} from "../lib/mandates";
import { resourceSlug } from "../lib/paths";
import { canBulkApprove, conservativeReason, type PendingApproval } from "../lib/queue";
import { loadedRecords, readAccounts } from "../lib/readers";
import { createAgentSigner } from "../lib/sign";
import { useApprovalQueue } from "../lib/use-queue";
import { AgentControl } from "./agent-control";
import { useApprovalDevice } from "./approval-key-setup-sheet";
import { DetailScreen, QueryRows, Screen } from "./states";
import { OfflineBanner, useDaemonStatus } from "./status-pill";
import { useAgentClock } from "./use-agent-clock";

/**
 * The shared approval queue (verified records only, complete trust collections) with each
 * row's badge and "allow similar" option evaluated against the verified current mandate.
 * Re-evaluated on the clock and at every policy boundary, so "Allowed" never outlives it.
 */
function useQueue(): Query<Row<PendingApproval>[]> {
  const { session } = useAgentWorkspace();
  const base = useApprovalQueue();
  const mandate = useAgentQuery(session.storageUrl, (c) => loadVerifiedMandate(c, session));
  const policy = mandate.status === "ready" ? mandate.data : undefined;
  const boundaries = useMemo(() => mandateBoundaries(policy), [policy]);
  const now = useAgentClock(boundaries);
  const rows = base.status === "ready" ? base.data : undefined;
  const [evaluated, setEvaluated] = useState<{
    rows: typeof rows;
    policy: typeof policy;
    now: number;
    data: Row<PendingApproval>[];
  }>();
  useEffect(() => {
    if (!rows || mandate.status === "loading") return;
    let active = true;
    void Promise.all(
      rows.map(async (row) =>
        "record" in row
          ? {
              ...row,
              record: {
                ...row.record,
                // The mandate's badge never relaxes the queue's own (prohibited, renewal) reason.
                reason: conservativeReason(
                  row.record.reason,
                  await proposalBadge(policy, row.record.proposal, new Date(now)),
                ),
                similarAllowed: await canAllowSimilar(policy, row.record.proposal, new Date(now)),
                explanation: await approvalExplanation(policy, row.record.proposal, new Date(now)),
              },
            }
          : row,
      ),
    ).then((data) => {
      if (active) setEvaluated({ rows, policy, now, data });
    });
    return () => {
      active = false;
    };
  }, [rows, policy, now, mandate.status]);
  if (base.status !== "ready") return base;
  if (mandate.status === "loading" || !evaluated)
    return { status: "loading", reload: base.reload } as const;
  if (evaluated.rows === rows && evaluated.policy === policy && evaluated.now === now)
    return { ...base, data: collection(evaluated.data, metadataOf(base.data)) };
  // While a re-evaluation is in flight, keep the list mounted (typed confirmations, focus and
  // list position survive a clock tick) but never keep showing a stale "Allowed": carry over
  // earlier badges only for the same proposal and terms, downgraded, and nothing permissive.
  const previous = new Map(
    evaluated.data.flatMap((row) =>
      "record" in row
        ? [[`${row.record.proposal.id} ${row.record.proposal.intent.termsDigest}`, row.record]]
        : [],
    ),
  );
  const data = (rows ?? []).map((row) => {
    if (!("record" in row)) return row;
    const earlier = previous.get(
      `${row.record.proposal.id} ${row.record.proposal.intent.termsDigest}`,
    )?.reason;
    const reason = conservativeReason(row.record.reason, earlier ?? row.record.reason);
    return {
      ...row,
      record: {
        ...row.record,
        reason: reason === "Allowed" ? "Ask first" : reason,
        similarAllowed: false,
        explanation: { reason: "Checking your permissions", rule: "Checking your permissions" },
      },
    };
  });
  return { ...base, data: collection(data, metadataOf(base.data)) };
}

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
  const kind = approvalKind(proposal.intent.action);
  const icons = { send: Mail, remember: Brain, book: Calendar, pay: CreditCard, connect: Plug };
  const Icon = icons[kind as keyof typeof icons] ?? Mail;
  return (
    <>
      <Icon size={18} aria-hidden="true" />
      <span>{kind}</span>
      <strong>{String(proposal.intent.parameters.summary ?? proposal.intent.action)}</strong>
      <Badge variant="secondary">{proposal.intent.binding}</Badge>
      <Recipient hash={proposal.intent.recipientHash} accounts={accounts} />
      <span>
        {proposal.intent.amount.value} {proposal.intent.amount.currency}
      </span>
      <span>{formatRelativeTime(row.expiresIn, 0, true)}</span>
      <Badge variant={reason === "Never" ? "destructive" : "secondary"}>{reason}</Badge>
      <span>
        {reason === "Never" ? "Your permissions never allow this" : row.explanation?.reason}
      </span>
    </>
  );
}
function ApprovalDetail({
  row,
  accounts,
  decide,
  busy,
  similar,
}: {
  row: PendingApproval;
  accounts: Account[];
  decide(row: PendingApproval, decision: "approve" | "deny"): void;
  busy: boolean;
  similar(row: PendingApproval): void;
}) {
  const [confirmation, setConfirmation] = useState("");
  const [copyState, setCopyState] = useState("");
  const preview = previewParts(row.proposal.renderedPreview);
  const needsConfirmation =
    row.proposal.intent.amount.value > 0 ||
    ["pay", "Transfer", "https://jeswr.org/ns/agent#Transfer"].includes(row.proposal.intent.action);
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
      <pre>
        {preview.text}
        <span className="agent-preview-footer">{preview.footer}</span>
      </pre>
      <p>Rule requiring approval: {row.explanation?.rule ?? "Checking your permissions"}</p>
      <Link href="/agent/permissions">View permissions</Link>
      <DecisionState row={row} />
      <details>
        <summary>Advanced</summary>
        <p>Terms digest</p>
        <code>{row.proposal.intent.termsDigest}</code>
        <Button
          variant="outline"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(row.proposal.intent.termsDigest);
              setCopyState("Digest copied");
            } catch {
              setCopyState("Couldn't copy the digest. Select the text to copy it.");
            }
          }}
        >
          Copy digest
        </Button>
        <p role="status">{copyState}</p>
        {row.explanation?.ruleDetails && (
          <>
            <p>Permission rule</p>
            <code>{row.explanation.ruleDetails}</code>
          </>
        )}
        <p>
          {row.verification === "verified"
            ? "Verified"
            : row.verification === "unchecked"
              ? "Unchecked"
              : "Signature could not be verified"}
        </p>
      </details>
      <div className="agent-row">
        <Button
          disabled={busy || row.reason === "Never" || row.state !== "pending"}
          onClick={() => decide(row, "approve")}
        >
          Approve
        </Button>
        {needsConfirmation && (
          <label>
            Type CONFIRM to allow similar actions
            <input
              aria-label="Type CONFIRM to allow similar actions"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
            />
          </label>
        )}
        <Button
          disabled={
            busy ||
            row.reason === "Never" ||
            !row.similarAllowed ||
            row.state !== "pending" ||
            (needsConfirmation && confirmation !== "CONFIRM")
          }
          onClick={() => similar(row)}
        >
          Approve and allow similar for 7 days
        </Button>
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
          <p>Approved (waiting for agent)</p>
          <p>Approved — the agent will send within a minute</p>
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
  const query = useQueue();
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
  const [pendingRevocation, setPendingRevocation] = useState<PendingRevocation>();
  useEffect(() => {
    if (id || query.status !== "ready") return;
    const stored = tabState("agent.approvals.returnFocus");
    if (!stored) return;
    let frame = 0;
    let handle = 0;
    const restore = () => {
      const target = document.querySelector<HTMLElement>(
        `[data-agent-approval-id="${CSS.escape(stored)}"]`,
      );
      if (target && !document.querySelector('[role="dialog"]')) {
        target.focus();
        saveTabState("agent.approvals.returnFocus", undefined);
      } else if (++frame < 120) handle = requestAnimationFrame(restore);
    };
    handle = requestAnimationFrame(restore);
    return () => cancelAnimationFrame(handle);
  }, [id, query.status]);
  const decide = (rows: PendingApproval[], decision: "approve" | "deny", similar = false) => {
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
            const mandate = await loadVerifiedMandate(client, session);
            if (decision === "approve" && (await proposalBadge(mandate, proposal)) === "Never")
              throw new Error("Your permissions never allow this");
            if (similar) {
              if (!mandate) throw new Error("Give your agent permissions first");
              if (!(await canAllowSimilar(mandate, proposal)))
                throw new Error("These permissions require confirmation");
              await activateMandate(
                client,
                session,
                allowSimilar(
                  mandate,
                  proposal,
                  `${client.paths.mandates}${crypto.randomUUID()}.trig`,
                ),
                new Date(),
                mandate,
              );
            }
            await createAgentSigner(session, client).signApproval(proposal, decision);
          } catch (error) {
            setOptimistic((current) => {
              const next = { ...current };
              delete next[proposal.id];
              return next;
            });
            if (error instanceof PendingRevocation) throw error;
            throw new Error("Approval couldn't be saved");
          }
        }
        setSelected(new Set());
      };
      void run()
        .catch((error) => {
          if (error instanceof PendingRevocation) setPendingRevocation(error);
          else setError(true);
        })
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
      {pendingRevocation && (
        <div role="alert">
          <p>{pendingRevocation.message}</p>
          <Button
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void pendingRevocation
                .retry()
                .then(
                  () => setPendingRevocation(undefined),
                  (error) => setPendingRevocation(error as PendingRevocation),
                )
                .finally(() => {
                  setBusy(false);
                  query.reload();
                });
            }}
          >
            Try again
          </Button>
        </div>
      )}
      <QueryRows query={query} empty="Nothing waiting for you">
        {(records) => {
          const rows = records.map((row) => {
            const local = optimistic[row.proposal.id];
            return busy &&
              query.status === "ready" &&
              isComplete(query.data) &&
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
                key={`${row.proposal.id}:${row.proposal.intent.termsDigest}`}
                row={row}
                accounts={own}
                busy={busy}
                decide={(row, decision) => decide([row], decision)}
                similar={(row) => decide([row], "approve", true)}
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
                      data-agent-approval-id={row.proposal.id}
                      onClick={() => saveTabState("agent.approvals.returnFocus", row.proposal.id)}
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
