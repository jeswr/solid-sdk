// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
"use client";
import {
  Badge,
  Button,
  FilterChips,
  Input,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@jeswr/suite-ui";
import {
  Activity,
  Brain,
  CheckCheck,
  CircleAlert,
  FileCheck,
  FileInput,
  FileText,
  KeyRound,
  Mail,
  Shield,
  Square,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AUDIT_KINDS,
  AUDIT_SCOPE,
  type AuditEntry,
  auditJsonLd,
  HEAD_MISSING,
  type RangeCheck,
  readAuditHead,
  verifyLatestRange,
} from "../lib/audit";
import { isLoaded } from "../lib/client";
import { saveTabState, tabState } from "../lib/device-state";
import { formatRelativeTime } from "../lib/format";
import { useAgentQuery, useAgentWorkspace } from "../lib/hooks";
import { resourceSlug } from "../lib/paths";
import {
  loadedRecords,
  readAccounts,
  readApprovals,
  readAudit,
  readControl,
  readProposals,
} from "../lib/readers";
import { createAgentVerifier } from "../lib/verify";
import { ExpiredApprovalRequests } from "./expired-approvals";
import { useMobileSheet } from "./responsive-sheet";
import { QueryRows, Screen } from "./states";

const KINDS = {
  ingest: "Message received",
  proposal: "Proposal prepared",
  decision: "Permissions checked",
  "approval-seen": "Approval read",
  transmission: "Message sent",
  receipt: "Receipt received",
  control: "Agent control changed",
  "mandate-change": "Permissions changed",
  "model-call": "Model consulted",
  "tamper-suspected": "Record mismatch suspected",
};
const ICONS = {
  ingest: FileInput,
  proposal: FileText,
  decision: Shield,
  "approval-seen": KeyRound,
  transmission: Mail,
  receipt: CheckCheck,
  control: Square,
  "mandate-change": FileCheck,
  "model-call": Brain,
  "tamper-suspected": CircleAlert,
  "ledger-checkpoint": Activity,
};
function Summary({ entry }: { entry: AuditEntry }) {
  const r = entry.record;
  if (r.type === "ledger-checkpoint")
    return <>Earlier records were removed under the retention policy</>;
  if (r.reason === "expired") return <>Approval request expired</>;
  if (r.type !== "transmission") return <>{KINDS[r.type]}</>;
  if (r.status === "uncertain")
    return <>The agent couldn't confirm whether this message was sent</>;
  if (r.status === "attempting") return <>The agent is trying to send this message</>;
  if (r.status === "not-sent" || r.status === "refused")
    return <>The agent did not send this message</>;
  if (r.status !== "sent") return <>A message transmission was recorded</>;
  return (
    <>
      Sent email to{" "}
      <Badge variant="outline" title={(r.recipientHashes ?? r.terms?.recipientHashes)?.[0]}>
        {(r.recipientHashes ?? r.terms?.recipientHashes)?.[0]?.slice(-8) ?? "a recorded recipient"}
      </Badge>
      {r.mandate ? " under your permissions" : ""}
      {r.approval ? ", with your approval" : ""}
    </>
  );
}
function verdictText(check: RangeCheck): string {
  if (check.ok) return "Records check out";
  if (check.problem === HEAD_MISSING)
    return "These records can't be checked because the record index is missing.";
  return `Record ${check.firstBadSeq ?? "shown here"} doesn't match`;
}
const ROW_HEIGHT = 88;
const OVERSCAN = 10;
const VISIBLE_ROWS = 5;
const FOCUS_KEY = "agent.activity.returnFocus";
interface TimelineRow {
  seq: number;
  at: string;
  kind: AuditEntry["record"]["type"];
  line: string;
  time: string;
  title: string;
}
function activityLine(entry: AuditEntry): string {
  const r = entry.record;
  if (r.type === "ledger-checkpoint")
    return "Earlier records were removed under the retention policy";
  if (r.reason === "expired") return "Approval request expired";
  if (r.type !== "transmission") return KINDS[r.type];
  if (r.status === "uncertain") return "The agent couldn't confirm whether this message was sent";
  if (r.status === "attempting") return "The agent is trying to send this message";
  if (r.status === "not-sent" || r.status === "refused")
    return "The agent did not send this message";
  if (r.status !== "sent") return "A message transmission was recorded";
  const recipient =
    (r.recipientHashes ?? r.terms?.recipientHashes)?.[0]?.slice(-8) ?? "a recorded recipient";
  return `Sent email to ${recipient}${r.mandate ? " under your permissions" : ""}${r.approval ? ", with your approval" : ""}`;
}
const ActivityRow = memo(function ActivityRow({
  row,
  index,
  count,
}: {
  row: TimelineRow;
  index: number;
  count: number;
}) {
  const Icon = ICONS[row.kind];
  return (
    <li
      aria-posinset={index + 1}
      aria-setsize={count}
      style={{ position: "absolute", top: index * ROW_HEIGHT, height: ROW_HEIGHT, width: "100%" }}
    >
      <Link
        className="agent-timeline-row"
        data-seq={row.seq}
        href={`/agent/activity/${row.seq}`}
        prefetch={false}
      >
        <Icon size={18} aria-hidden="true" />
        <span>
          <span className="agent-timeline-summary">{row.line}</span>
          <small>
            <time dateTime={row.at} title={row.title}>
              {row.time}
            </time>{" "}
            · Record {row.seq}
          </small>
        </span>
      </Link>
    </li>
  );
});
/** Fixed rows and bounded DOM keep scrolling independent of the number of loaded entries. */
export const ActivityTimeline = memo(function ActivityTimeline({
  entries,
  restoreFocus,
  onRestored,
}: {
  entries: readonly AuditEntry[];
  /** Bring this record's row into the window and focus it (after the drawer closes). */
  restoreFocus?: number | undefined;
  onRestored?: () => void;
}) {
  const rows = useMemo(
    () =>
      entries.map((entry) => ({
        seq: entry.seq,
        at: entry.at,
        kind: entry.record.type,
        line: activityLine(entry),
        time: formatRelativeTime(entry.at),
        title: new Date(entry.at).toLocaleString(),
      })),
    [entries],
  );
  const [start, setStart] = useState(0);
  const scrollTop = useRef(0);
  const frame = useRef<number | undefined>(undefined);
  useEffect(
    () => () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    },
    [],
  );
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    if (restoreFocus === undefined) return;
    const index = rows.findIndex((row) => row.seq === restoreFocus);
    const scroller = section.current;
    if (index >= 0 && scroller) {
      // The list remounts at the top: scroll the row into the virtual window first.
      const top = Math.max(0, (index - 1) * ROW_HEIGHT);
      scroller.scrollTop = top;
      scrollTop.current = top;
      setStart(Math.max(0, Math.floor(top / ROW_HEIGHT) - OVERSCAN));
    }
    // The drawer's exit animation keeps its focus trap mounted for a few frames, so retry
    // until no dialog remains and focus has held on the row for consecutive frames.
    let frame = 0;
    let held = 0;
    let handle = 0;
    const attempt = () => {
      const last = ++frame >= 120;
      const target =
        (index >= 0
          ? section.current?.querySelector<HTMLElement>(
              `.agent-timeline-row[data-seq="${restoreFocus}"]`,
            )
          : null) ?? (index < 0 || last ? document.getElementById("agent-timeline-heading") : null);
      if (target && !document.querySelector('[role="dialog"]') && document.activeElement !== target)
        target.focus({ preventScroll: true });
      held = target && document.activeElement === target ? held + 1 : 0;
      if (held >= 3 || last) {
        onRestored?.();
        return;
      }
      handle = requestAnimationFrame(attempt);
    };
    handle = requestAnimationFrame(attempt);
    return () => cancelAnimationFrame(handle);
  }, [restoreFocus, rows, onRestored]);
  const visible = rows.slice(start, start + VISIBLE_ROWS + 2 * OVERSCAN);
  return (
    <section
      ref={section}
      className="agent-timeline"
      aria-label="Activity timeline"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard access to a scrollable timeline
      tabIndex={0}
      onScroll={(event) => {
        scrollTop.current = event.currentTarget.scrollTop;
        if (frame.current === undefined)
          frame.current = requestAnimationFrame(() => {
            frame.current = undefined;
            setStart(Math.max(0, Math.floor(scrollTop.current / ROW_HEIGHT) - OVERSCAN));
          });
      }}
    >
      <ol
        aria-label="Activity records"
        style={{ height: entries.length * ROW_HEIGHT, position: "relative" }}
      >
        {visible.map((row, index) => (
          <ActivityRow key={row.seq} row={row} index={start + index} count={rows.length} />
        ))}
      </ol>
    </section>
  );
});
function ProvenanceChain({
  entry,
  entries,
  proposals,
}: {
  entry: AuditEntry;
  entries: AuditEntry[];
  proposals: string[];
}) {
  const { client } = useAgentWorkspace();
  if (entry.record.type === "ledger-checkpoint") return null;
  const r = entry.record;
  const proposal = r.proposal ?? (r.type === "proposal" ? r.id : undefined);
  const related = entries.filter(
    (e) =>
      e.record.type !== "ledger-checkpoint" &&
      proposal &&
      (e.record.proposal === proposal || e.record.id === proposal),
  );
  const find = (kind: string) => {
    const found = related.find((e) => e.record.type === kind);
    return found?.record.type !== "ledger-checkpoint" ? found?.record.id : undefined;
  };
  const refs = [
    proposal,
    r.decisionRecord ?? find("decision"),
    r.mandate,
    r.approval,
    r.transmission ?? (r.type === "transmission" ? r.id : undefined),
    r.receipt ?? find("receipt"),
  ];
  const labels = ["Proposal", "Decision", "Permission", "Approval", "Transmission", "Receipt"];
  const href = (ref: string | undefined, index: number): string | undefined => {
    if (!ref) return undefined;
    if (index === 2)
      return ref.startsWith(client.paths.mandates) ? "/agent/permissions/history" : undefined;
    if (
      index === 3 &&
      ref.startsWith(client.paths.approvals) &&
      proposal &&
      proposals.includes(proposal)
    ) {
      const slug = resourceSlug(proposal);
      return slug ? `/agent/approvals/${encodeURIComponent(slug)}` : undefined;
    }
    if (index === 0 && proposals.includes(ref)) {
      const slug = resourceSlug(ref);
      return slug ? `/agent/approvals/${encodeURIComponent(slug)}` : undefined;
    }
    const kind = [
      "proposal",
      "decision",
      "mandate-change",
      "approval-seen",
      "transmission",
      "receipt",
    ][index];
    const linked = entries.find(
      (e) =>
        e.record.type !== "ledger-checkpoint" &&
        e.record.type === kind &&
        (e.record.id === ref || (index === 3 && e.record.approval === ref)),
    );
    return linked ? `/agent/activity/${linked.seq}` : undefined;
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: an SVG can't be a fieldset; it groups linked nodes
    <svg
      className="agent-prov"
      viewBox="0 0 300 430"
      role="group"
      aria-label="Record chain: proposal, decision, permission, approval, transmission, receipt"
    >
      <title>Authority and delivery chain</title>
      {labels.map((label, index) => {
        const y = index * 70 + 5;
        const target = href(refs[index], index);
        const content = (
          <>
            <rect
              x="30"
              y={y}
              width="240"
              height="48"
              rx="8"
              className={target ? "" : "agent-prov-missing"}
            />
            <text x="150" y={y + 29} textAnchor="middle">
              {label}
              {target ? "" : " · Not recorded here"}
            </text>
          </>
        );
        return (
          <g key={label}>
            {index > 0 && <path d={`M150 ${y - 22} V${y - 3} m-4 -5 l4 5 4 -5`} />}
            {target ? (
              <a href={target} aria-label={`View ${label.toLowerCase()}`}>
                {content}
              </a>
            ) : (
              content
            )}
          </g>
        );
      })}
    </svg>
  );
}
function RecordDetail({ entry, entries }: { entry: AuditEntry; entries: AuditEntry[] }) {
  const { client } = useAgentWorkspace();
  const approvals = useAgentQuery(client.paths.approvals, readApprovals);
  const proposals = useAgentQuery(client.paths.proposals, readProposals);
  const approval = entry.record.type === "ledger-checkpoint" ? undefined : entry.record.approval;
  const key =
    approvals.status === "ready"
      ? loadedRecords(approvals.data).find((a) => a.id === approval)?.signingKeyFragment
      : undefined;
  return (
    <>
      <p>
        <Summary entry={entry} />
      </p>
      <dl>
        <dt>Record</dt>
        <dd>{entry.seq}</dd>
        <dt>Time</dt>
        <dd>{new Date(entry.at).toLocaleString()}</dd>
        <dt>Approval key</dt>
        <dd>{key ?? "Not recorded"}</dd>
        {entry.record.type !== "ledger-checkpoint" && entry.record.reason === "expired" && (
          <>
            <dt>Reason</dt>
            <dd>expired</dd>
          </>
        )}
      </dl>
      <h2>How this action is connected</h2>
      <ProvenanceChain
        entry={entry}
        entries={entries}
        proposals={
          proposals.status === "ready" ? loadedRecords(proposals.data).map((p) => p.id) : []
        }
      />
      <details>
        <summary>Technical details</summary>
        <dl>
          <dt>Previous hash</dt>
          <dd>{entry.prev}</dd>
          <dt>Entry hash</dt>
          <dd>{entry.hash}</dd>
        </dl>
        <pre>{JSON.stringify(entry.record, null, 2)}</pre>
      </details>
    </>
  );
}
export function ActivityScreen({ seq }: { seq?: string }) {
  const { client, session } = useAgentWorkspace();
  const router = useRouter();
  const mobile = useMobileSheet();
  const [kinds, setKinds] = useState<string[]>([]);
  const [accounts, setAccounts] = useState<string[]>([]);
  const [from, setFrom] = useState("");
  const [until, setUntil] = useState("");
  const [limit, setLimit] = useState(500);
  const [share, setShare] = useState(false);
  const [auditor, setAuditor] = useState("");
  const [check, setCheck] = useState<{ rows: unknown; result: RangeCheck }>();
  const query = useAgentQuery(client.paths.audit, async (c) =>
    readAudit(c, {
      limit,
      ...(seq && /^[1-9]\d{0,5}$/.test(seq) ? { before: Number(seq) + 1 } : {}),
    }),
  );
  // Watch the actual container as well as local range changes.
  const head = useAgentQuery(client.paths.audit, readAuditHead);
  const allAccounts = useAgentQuery(client.paths.accounts, readAccounts);
  const controls = useAgentQuery(session.storageUrl, (c) =>
    readControl(c, createAgentVerifier(session)),
  );
  const entries = useMemo(
    () => (query.status === "ready" ? loadedRecords(query.data) : []),
    [query],
  );
  // Pick up the row to refocus whenever the list shows again after the record drawer closes.
  const [returnTo, setReturnTo] = useState<number>();
  useEffect(() => {
    if (seq) return;
    const stored = tabState(FOCUS_KEY);
    if (stored && /^[1-9]\d{0,5}$/.test(stored)) setReturnTo(Number(stored));
  }, [seq]);
  const restored = useCallback(() => {
    saveTabState(FOCUS_KEY, undefined);
    setReturnTo(undefined);
  }, []);
  const shown = useMemo(
    () =>
      entries.filter((entry) => {
        const r = entry.record;
        return (
          (!kinds.length || kinds.includes(r.type)) &&
          (!accounts.length ||
            (r.type !== "ledger-checkpoint" &&
              accounts.includes(r.accountId ?? r.terms?.accountId ?? ""))) &&
          (!from || entry.at >= `${from}T00:00:00.000Z`) &&
          (!until || entry.at <= `${until}T23:59:59.999Z`)
        );
      }),
    [entries, kinds, accounts, from, until],
  );
  const selected = entries.find((e) => String(e.seq) === seq);
  const runCheck = () => {
    const failed = query.status === "ready" ? query.data.find((row) => !isLoaded(row)) : undefined;
    const result: RangeCheck = failed
      ? {
          ok: false,
          firstBadSeq: Number(failed.url.split("/").at(-1)?.replace(".ttl", "")),
          problem: "Unreadable record",
          scope: AUDIT_SCOPE,
        }
      : verifyLatestRange(
          entries.toReversed(),
          head.status === "ready" ? head.data : undefined,
          seq ? Number(seq) : head.data?.seq,
        );
    setCheck({ rows: query.status === "ready" ? query.data : undefined, result });
  };
  const exportRange = () => {
    const blob = new Blob([JSON.stringify(auditJsonLd(entries, client.paths.audit), null, 2)], {
      type: "application/ld+json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "agent-audit.jsonld";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  const validCheck =
    check && query.status === "ready" && check.rows === query.data ? check.result : undefined;
  return (
    <Screen title={seq ? `Activity record ${seq}` : "Activity"}>
      {!seq && <ExpiredApprovalRequests />}
      <p>{AUDIT_SCOPE}</p>
      <div className="agent-row">
        <Button disabled={query.status !== "ready" || head.status !== "ready"} onClick={runCheck}>
          Check records
        </Button>
        <Button variant="outline" disabled={!entries.length} onClick={exportRange}>
          Export records
        </Button>
        <Button variant="outline" onClick={() => setShare(true)}>
          Share with an auditor
        </Button>
      </div>
      {validCheck && (
        <p role="status" className={validCheck.ok ? "agent-check-ok" : "agent-check-bad"}>
          {verdictText(validCheck)}
        </p>
      )}
      <FilterChips
        label="Activity kind"
        options={AUDIT_KINDS.map((kind) => ({ id: kind, label: KINDS[kind] }))}
        value={kinds}
        onChange={setKinds}
        resultCount={shown.length}
      />
      {allAccounts.status === "ready" && (
        <FilterChips
          label="Account"
          options={loadedRecords(allAccounts.data).flatMap((a) => {
            const id = resourceSlug(a.id);
            return id ? [{ id, label: a.label ?? "Connected account" }] : [];
          })}
          value={accounts}
          onChange={setAccounts}
          resultCount={shown.length}
        />
      )}
      <div className="agent-row">
        <label htmlFor="activity-from">
          From date
          <Input
            id="activity-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label htmlFor="activity-until">
          Until date
          <Input
            id="activity-until"
            type="date"
            value={until}
            onChange={(e) => setUntil(e.target.value)}
          />
        </label>
      </div>
      <h2 id="agent-timeline-heading" tabIndex={-1}>
        Activity timeline
      </h2>
      <QueryRows query={query} empty="No activity yet">
        {() => (
          <>
            {shown.length ? (
              <ActivityTimeline
                key={`${kinds}:${accounts}:${from}:${until}`}
                entries={shown}
                restoreFocus={returnTo}
                onRestored={restored}
              />
            ) : (
              <p>No records match these filters.</p>
            )}
            {entries.length === limit && limit < 5000 && (
              <Button
                variant="outline"
                onClick={() => {
                  setLimit((n) => Math.min(5000, n + 500));
                  query.reload();
                }}
              >
                Load earlier records
              </Button>
            )}
          </>
        )}
      </QueryRows>
      {controls.status === "ready" &&
        controls.data
          .filter((row) => !isLoaded(row) || row.verified !== "verified")
          .map((row) => (
            <article className="agent-card" key={row.url}>
              <h2>Unverified record</h2>
              <p>This record could not be verified and has no effect on your agent's status.</p>
            </article>
          ))}
      <Sheet
        open={seq !== undefined}
        onOpenChange={(open) => {
          if (!open) {
            if (seq) saveTabState(FOCUS_KEY, seq);
            router.push("/agent/activity");
          }
        }}
      >
        <SheetContent
          side={mobile ? "bottom" : "right"}
          className="agent-app agent-detail-sheet"
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <SheetTitle asChild>
            <h1>Activity record {seq}</h1>
          </SheetTitle>
          <SheetDescription>
            Read this record and its connected permissions and approval.
          </SheetDescription>
          <p>{AUDIT_SCOPE}</p>
          <Button disabled={query.status !== "ready" || head.status !== "ready"} onClick={runCheck}>
            Check records
          </Button>
          {validCheck && (
            <p role="status" className={validCheck.ok ? "agent-check-ok" : "agent-check-bad"}>
              {verdictText(validCheck)}
            </p>
          )}
          {selected ? (
            <RecordDetail entry={selected} entries={entries} />
          ) : (
            <p>
              {query.status === "loading"
                ? "Loading record…"
                : "This record is outside the loaded range or couldn't be read."}
            </p>
          )}
        </SheetContent>
      </Sheet>
      <Sheet open={share} onOpenChange={setShare}>
        <SheetContent side={mobile ? "bottom" : "right"} className="agent-app agent-detail-sheet">
          <SheetTitle>Share with an auditor</SheetTitle>
          <SheetDescription>
            Give an auditor read access to activity records and permissions.
          </SheetDescription>
          <p>
            This grants read access to audit/ and mandates/, including their records. Only share
            with someone you trust.
          </p>
          <label htmlFor="agent-auditor">Auditor account ID</label>
          <Input
            id="agent-auditor"
            type="url"
            value={auditor}
            onChange={(e) => setAuditor(e.target.value)}
            placeholder="https://example.org/profile#me"
          />
          <Button disabled>Sharing arrives with the suite share dialog</Button>
        </SheetContent>
      </Sheet>
    </Screen>
  );
}
