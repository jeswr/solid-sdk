// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import type { Mandate, Rule } from "@jeswr/agent-mandate";
import type { Account } from "@jeswr/agent-model";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Switch,
} from "@jeswr/suite-ui";
import { Bot, Heart, HeartPulse, Wallet } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  ApprovalDeviceProvider,
  useApprovalDevice,
} from "../../../agent/components/approval-key-setup-sheet";
import { MandateDescription } from "../../../agent/components/permissions";
import { useAgentClock } from "../../../agent/components/use-agent-clock";
import { AgentWorkspaceProvider, useAgentQuery, useAgentWorkspace } from "../../../agent/lib/hooks";
import {
  actionNames,
  MEMORY_CATEGORIES,
  mandateBoundaries,
  memoryCategoryLabel,
  memoryScope,
  reissueMandate,
  removePermission,
} from "../../../agent/lib/mandate-rules";
import {
  activateMandate,
  loadVerifiedMandate,
  PendingRevocation,
  previewMandate,
  readAgentIdentity,
} from "../../../agent/lib/mandates";
import { AGENT } from "../../../agent/lib/paths";
import { loadedRecords, readAccounts } from "../../../agent/lib/readers";
import { useHomeSession } from "../home-app";
import "./permissions.css";

function permissionScope(rule: Rule, accounts: readonly Account[]): string {
  return (rule.constraints ?? [])
    .flatMap((constraint) => {
      if (!["eq", "isAnyOf"].includes(constraint.operator)) return [];
      const values = Array.isArray(constraint.rightOperand)
        ? constraint.rightOperand
        : [constraint.rightOperand];
      if (constraint.leftOperand === `${AGENT}recipientSet`)
        return [
          `Recipients: ${values.map((hash) => accounts.find((account) => account.channelHandleHash === hash)?.label ?? `Contact ${String(hash).slice(0, 12)}`).join(", ")}`,
        ];
      if (constraint.leftOperand === `${AGENT}binding`) return [`Channels: ${values.join(", ")}`];
      return [];
    })
    .join(". ");
}

/** Reuse the agent workspace and approval device on Home's existing signed-in session. */
export function HomeAgentPermissions({
  rules = false,
  search = "",
  onMatchChange,
}: {
  rules?: boolean;
  search?: string;
  onMatchChange?: ((matches: boolean) => void) | undefined;
}) {
  const session = useHomeSession();
  const [online, setOnline] = useState(
    () => typeof navigator === "undefined" || navigator.onLine !== false,
  );
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  if (!online) return null;
  return (
    <AgentWorkspaceProvider session={session} fallback={() => null}>
      <AgentPermissionPresence rules={rules} search={search} onMatchChange={onMatchChange} />
    </AgentWorkspaceProvider>
  );
}

function AgentPermissionPresence({
  rules,
  search,
  onMatchChange,
}: {
  rules: boolean;
  search: string;
  onMatchChange?: ((matches: boolean) => void) | undefined;
}) {
  const { client } = useAgentWorkspace();
  const identity = useAgentQuery(client.paths.agentIntroduction, readAgentIdentity);
  if (identity.status !== "ready" || !identity.data) return null;
  return (
    <ApprovalDeviceProvider>
      <AgentPermissionControls rules={rules} search={search} onMatchChange={onMatchChange} />
    </ApprovalDeviceProvider>
  );
}

export function AgentPermissionControls({
  rules = false,
  search = "",
  onMatchChange,
}: {
  rules?: boolean;
  search?: string;
  onMatchChange?: ((matches: boolean) => void) | undefined;
}) {
  const { client, session } = useAgentWorkspace();
  const controlsId = useId();
  const device = useApprovalDevice();
  const query = useAgentQuery(client.workspace, async (c) => {
    const [mandate, accounts] = await Promise.all([
      loadVerifiedMandate(c, session),
      readAccounts(c),
    ]);
    return { mandate, accounts: loadedRecords(accounts) };
  });
  const data = query.status === "ready" ? query.data : undefined;
  const boundaries = useMemo(() => mandateBoundaries(data?.mandate), [data?.mandate]);
  const now = useAgentClock(boundaries);
  const mandate =
    data?.mandate && Date.parse(data.mandate.validUntil) > now ? data.mandate : undefined;
  const scope = mandate ? memoryScope(mandate) : [];
  const [review, setReview] = useState<{
    source: Mandate;
    next: Mandate;
    turtle: string;
    warning: string;
  }>();
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState<PendingRevocation>();
  const heading = useRef<HTMLHeadingElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const prepare = async (makeNext: () => Mandate | Promise<Mandate>, warning: string) => {
    if (!mandate || inFlight.current) return;
    trigger.current = document.activeElement as HTMLElement;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      let next: Mandate;
      try {
        next = await makeNext();
      } catch (failure) {
        setError(
          failure instanceof Error ? failure.message : "Couldn't change this rule. Try again.",
        );
        return;
      }
      setReview({ source: mandate, next, warning, turtle: await previewMandate(next, client) });
    } catch {
      setError("Couldn't preview your permissions. Try again.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const run = (action: () => Promise<unknown>) => {
    if (inFlight.current) return;
    void device.requireKey(() => {
      if (inFlight.current) return;
      inFlight.current = true;
      setBusy(true);
      setError("");
      void action()
        .then(
          () => {
            setReview(undefined);
            setPending(undefined);
            setSaved(true);
            query.reload();
          },
          (failure: unknown) => {
            setReview(undefined);
            query.reload();
            if (failure instanceof PendingRevocation) {
              setPending(failure);
              setError(failure.message);
            } else
              setError(
                "Couldn't save your permissions. Review the current permissions and try again.",
              );
          },
        )
        .finally(() => {
          inFlight.current = false;
          setBusy(false);
        });
    });
  };
  const newId = () => `${client.paths.mandates}${crypto.randomUUID()}.trig`;
  const permissionRules = mandate
    ? (["autonomous", "withApproval"] as const).flatMap((set) =>
        (mandate[set].permissions ?? []).map((rule, index) => ({ set, rule, index })),
      )
    : [];
  const matches =
    !search.trim() ||
    [
      "Your agent",
      ...(data?.accounts.map((account) => account.label ?? "") ?? []),
      ...scope.map(memoryCategoryLabel),
      ...permissionRules.map(
        ({ rule }) =>
          actionNames[rule.action.slice(AGENT.length) as keyof typeof actionNames] ??
          "Other action",
      ),
    ]
      .join(" ")
      .toLowerCase()
      .includes(search.trim().toLowerCase());
  useEffect(() => {
    onMatchChange?.(matches);
  }, [matches, onMatchChange]);
  useEffect(() => () => onMatchChange?.(false), [onMatchChange]);
  if (!matches) return null;
  return (
    <section
      className="hm-agent-permissions"
      aria-label={rules ? "Your agent permissions" : "Agent personalisation"}
    >
      <h2 ref={heading} tabIndex={-1}>
        <Bot aria-hidden="true" size={20} /> Your agent
      </h2>
      {query.status === "loading" ? (
        <p role="status">Checking your agent's permissions…</p>
      ) : query.status === "error" ? (
        <p role="alert">
          Couldn't check your agent's permissions.{" "}
          <Button variant="outline" onClick={query.reload}>
            Retry
          </Button>
        </p>
      ) : (
        <>
          <p>
            Your agent is personalising with:{" "}
            {scope.length
              ? scope.map((category, index) => {
                  const Icon =
                    category === MEMORY_CATEGORIES[1].id
                      ? HeartPulse
                      : category === MEMORY_CATEGORIES[2].id
                        ? Wallet
                        : Heart;
                  return (
                    <span key={category} className="hm-agent-category">
                      <Icon aria-hidden="true" size={16} />
                      {memoryCategoryLabel(category)}
                      {index < scope.length - 1 ? ", " : ""}
                    </span>
                  );
                })
              : "none"}
          </p>
          <label className="hm-agent-toggle" htmlFor={`${controlsId}-personalise`}>
            <Switch
              id={`${controlsId}-personalise`}
              aria-label="Personalise"
              checked={scope.length > 0}
              disabled={!mandate || busy || !!pending}
              onCheckedChange={(checked) => {
                if (mandate)
                  void prepare(
                    () => ({
                      ...reissueMandate(mandate, newId()),
                      memoryScope: checked ? [MEMORY_CATEGORIES[0].id] : [],
                    }),
                    checked
                      ? "Your agent will use your saved preferences to personalise."
                      : "Your agent will stop using saved information to personalise.",
                  );
              }}
            />{" "}
            Personalise {scope.length ? "ON" : "OFF"}
          </label>
          {!mandate && <p>No verified permissions are active.</p>}
          {rules && mandate && (
            <>
              <h3>Permission rules</h3>
              <p>
                Turn an automatic rule off to ask first instead. Turn an ask-first rule off to stop
                that action. This also turns off other automatic rules for the same action. Other
                limits and bans still apply.
              </p>
              <ul>
                {permissionRules.map(({ set, rule, index }) => (
                  <li key={`${set}-${index}`}>
                    <label className="hm-agent-toggle" htmlFor={`${controlsId}-${set}-${index}`}>
                      <Switch
                        id={`${controlsId}-${set}-${index}`}
                        checked
                        disabled={busy || !!pending}
                        onCheckedChange={() => {
                          void prepare(
                            () => removePermission(mandate, set, index, newId()),
                            set === "autonomous"
                              ? "The agent will ask you before doing this"
                              : "The agent won't do this at all.",
                          );
                        }}
                      />
                      {set === "autonomous" ? "Without asking" : "Ask first"}:{" "}
                      {actionNames[rule.action.slice(AGENT.length) as keyof typeof actionNames] ??
                        "other action"}{" "}
                      (rule {index + 1})
                    </label>
                    <p className="hm-permission-muted">
                      {permissionScope(rule, data?.accounts ?? [])}
                    </p>
                  </li>
                ))}
              </ul>
              <MandateDescription mandate={mandate} accounts={data?.accounts ?? []} />
            </>
          )}
          <Link href="/agent/permissions">Edit agent permissions and limits</Link>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {busy && <p role="status">Updating your permissions…</p>}
      {pending && (
        <Button disabled={busy} onClick={() => run(pending.retry)}>
          Try again
        </Button>
      )}
      {saved && <p role="status">Your permissions have been saved.</p>}
      <AlertDialog
        open={!!review}
        onOpenChange={(open) => {
          if (!open && !busy) setReview(undefined);
        }}
      >
        <AlertDialogContent
          className="hm-agent-review"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (trigger.current?.isConnected) trigger.current.focus();
            else heading.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Review your agent's permissions</AlertDialogTitle>
            <AlertDialogDescription>{review?.warning}</AlertDialogDescription>
          </AlertDialogHeader>
          {review && (
            <>
              <MandateDescription mandate={review.next} accounts={data?.accounts ?? []} />
              <details>
                <summary>Technical details</summary>
                <pre>{review.turtle}</pre>
              </details>
            </>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <Button
              disabled={busy || !!pending}
              onClick={() => {
                if (review)
                  run(() =>
                    activateMandate(client, session, review.next, new Date(), review.source),
                  );
              }}
            >
              {busy ? "Signing…" : "Sign and activate"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
