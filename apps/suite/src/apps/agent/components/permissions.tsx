// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import type { Mandate } from "@jeswr/agent-mandate";
import type { Account } from "@jeswr/agent-model";
import { Badge, Button, Input, Label, LoadingSkeleton, toast } from "@jeswr/suite-ui";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { accountBinding } from "../lib/accounts";
import { useAgentQuery, useAgentWorkspace } from "../lib/hooks";
import { MEMORY_CATEGORIES, mandateBoundaries } from "../lib/mandate-rules";
import {
  activateMandate,
  buildEditorMandate,
  describeMandate,
  type EditorValues,
  editorDefaults,
  editorSchema,
  lastSignedMandate,
  loadVerifiedMandate,
  mandateHistory,
  PendingRevocation,
  previewMandate,
  readAgentIdentity,
  replyTemplate,
  revokeMandate,
  testsTemplate,
} from "../lib/mandates";
import { loadedRecords, readAccounts, readOutbox, readProposals } from "../lib/readers";
import { useApprovalDevice } from "./approval-key-setup-sheet";
import { Screen } from "./states";
import { useAgentClock } from "./use-agent-clock";

export function PermissionsScreen({ history = false }: { history?: boolean }) {
  const { client, session } = useAgentWorkspace();
  const device = useApprovalDevice();
  const query = useAgentQuery(client.workspace, async (c) => {
    const [accounts, agent, mandate, outbox, proposals] = await Promise.all([
      readAccounts(c),
      readAgentIdentity(c),
      loadVerifiedMandate(c, session),
      readOutbox(c),
      readProposals(c),
    ]);
    if (accounts.some((a) => "error" in a)) throw new Error("An account could not be read");
    // With no current permission, keep the owner's last signed memory choice (e.g. OFF).
    const remembered = mandate ?? (await lastSignedMandate(c, session).catch(() => undefined));
    const emailBindings = [
      ...new Set(
        loadedRecords(accounts)
          .filter((a) => a.channel === "email")
          .map(accountBinding),
      ),
    ];
    const sent = new Set(
      loadedRecords(outbox)
        .filter((t) => t.status === "sent")
        .map((t) => t.proposal),
    );
    return {
      accounts: loadedRecords(accounts),
      agent,
      mandate,
      remembered,
      emailBindings,
      sentHashes: loadedRecords(proposals)
        .filter(
          (p) =>
            sent.has(p.id) &&
            p.intent.action === "https://jeswr.org/ns/agent#SendMessage" &&
            emailBindings.includes(p.intent.binding),
        )
        .map((p) => p.intent.recipientHash),
    };
  });
  const previous = useAgentQuery(client.paths.mandates, (c) => mandateHistory(c, session));
  const data = query.status === "ready" ? query.data : undefined;
  const form = useForm<EditorValues>({
    resolver: zodResolver(editorSchema),
    defaultValues: editorDefaults(new Date(), data?.remembered),
  });
  const { resetField, getFieldState } = form;
  useEffect(() => {
    if (data && !getFieldState("memoryScope").isDirty)
      resetField("memoryScope", {
        defaultValue: editorDefaults(new Date(), data.remembered).memoryScope,
      });
  }, [data, resetField, getFieldState]);
  const [template, setTemplate] = useState("custom");
  const [preview, setPreview] = useState<{ mandate: Mandate; turtle: string } | undefined>();
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState<PendingRevocation | undefined>();
  const accountHashes =
    data?.accounts.flatMap((a) => (a.channelHandleHash ? [a.channelHandleHash] : [])) ?? [];
  const bindings = [...new Set(data?.accounts.map(accountBinding) ?? [])];
  const transfer = form.watch("transfer");
  const confirm =
    transfer ||
    (form.watch("spend") > 0 &&
      [form.watch("SendMessage"), form.watch("BookAppointment"), form.watch("Remember")].includes(
        "auto",
      ));
  const chooseTemplate = (name: string) => {
    form.reset({
      ...editorDefaults(new Date(), data?.remembered),
      bindings: name === "tests" ? ["gmail"] : bindings,
      recipients: accountHashes,
      BookAppointment: name === "meetings" ? "auto" : "ask",
    });
    setTemplate(name);
    setPreview(undefined);
    setSaved(false);
  };
  const makePreview = form.handleSubmit(async (values) => {
    if (!data?.agent) return;
    setError("");
    setSaved(false);
    try {
      const options = {
        id: `${client.paths.mandates}${crypto.randomUUID()}.trig`,
        ownerWebId: session.webId,
        agentWebId: data.agent,
        recipientHashes: values.recipients,
        now: new Date(),
      };
      let mandate: Mandate;
      if (template === "tests") mandate = testsTemplate(options);
      else if (template === "reply") {
        if (!data.sentHashes.length)
          throw new Error(
            "No earlier email recipients are recorded yet. Choose accounts below to make your own permissions.",
          );
        mandate = replyTemplate(
          { ...options, recipientHashes: data.sentHashes },
          data.emailBindings,
        );
      } else mandate = buildEditorMandate(values, options);
      if (data.remembered?.memoryScope !== undefined)
        mandate = { ...mandate, memoryScope: values.memoryScope };
      setPreview({ mandate, turtle: await previewMandate(mandate, client) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't preview your permissions. Try again.");
    }
  });
  const run = (action: () => Promise<unknown>, message: string) => {
    if (inFlight.current) return;
    void device.requireKey(() => {
      if (inFlight.current) return;
      inFlight.current = true;
      setBusy(true);
      setError("");
      setSaved(false);
      setPending(undefined);
      void action()
        .then(
          () => {
            setSaved(true);
            setPreview(undefined);
            query.reload();
            previous.reload();
            toast.success(message);
          },
          (error) => {
            setPreview(undefined);
            query.reload();
            previous.reload();
            if (error instanceof PendingRevocation) {
              setPending(error);
              setError(error.message);
            } else {
              setError(
                "Couldn't save your permissions. Your previous permissions are still current. Preview and sign again.",
              );
            }
          },
        )
        .finally(() => {
          inFlight.current = false;
          setBusy(false);
        });
    });
  };
  return (
    <Screen title={history ? "Permission history" : "Permissions"}>
      <Link href={history ? "/agent/permissions" : "/agent/permissions/history"}>
        {history ? "Current permissions" : "View permission history"}
      </Link>
      {query.status === "loading" && <LoadingSkeleton label="Loading permissions" />}
      {query.status === "error" && (
        <div role="alert">
          <p>Couldn't read your permissions.</p>
          <Button onClick={query.reload}>Retry</Button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {pending && (
        <Button disabled={busy} onClick={() => run(pending.retry, "Permissions updated")}>
          Try again
        </Button>
      )}
      {saved && <p role="status">Your permissions have been saved.</p>}
      {history ? (
        <>
          {previous.status === "loading" && <LoadingSkeleton label="Loading permission history" />}
          {previous.status === "error" && <p role="alert">Couldn't read permission history.</p>}
          {previous.status === "ready" && !previous.data.length && (
            <p>No previous permissions yet.</p>
          )}
          {(previous.status === "ready" ? previous.data : []).map((row) => (
            <article className="agent-card" key={row.id}>
              <h2>Previous permission record</h2>
              <Badge variant={row.status === "active" ? "secondary" : "outline"}>
                {
                  {
                    active: "Active",
                    replaced: "Replaced",
                    revoked: "Revoked",
                    expired: "Expired",
                    unchecked: "Couldn't be checked",
                    unreadable: "Couldn't be read",
                  }[row.status]
                }
              </Badge>
              {row.validFrom && row.validUntil && (
                <p>
                  Valid from {new Date(row.validFrom).toLocaleDateString()} until{" "}
                  {new Date(row.validUntil).toLocaleDateString()}
                </p>
              )}
              <p>Signed by approval key: {row.key}</p>
              {row.signedBy && (
                <p>
                  Signed by Account ID: <code>{row.signedBy}</code>
                </p>
              )}
              {row.signedAt && (
                <p>
                  Signed{" "}
                  <time dateTime={row.signedAt}>{new Date(row.signedAt).toLocaleString()}</time>
                </p>
              )}
            </article>
          ))}
        </>
      ) : data ? (
        <>
          <article className="agent-card">
            <h2>Current permission</h2>
            {data.mandate ? (
              <>
                <MandateDescription mandate={data.mandate} accounts={data.accounts} />
                <Button
                  variant="outline"
                  disabled={busy || !!pending}
                  onClick={() => run(() => revokeMandate(client, session), "Permissions stopped")}
                >
                  Stop using these permissions
                </Button>
                <p>Your agent won't be able to do anything until you give it new permissions.</p>
              </>
            ) : (
              <p>
                No verified permissions are active. Your agent needs new permissions before it can
                act.
              </p>
            )}
          </article>
          {!data.agent && (
            <div>
              <p role="status">
                Your agent hasn't introduced itself yet. Start it once, then come back.
              </p>
              <Button disabled>Sign and activate</Button>
            </div>
          )}
          <h2>Give your agent permissions</h2>
          <div className="agent-row">
            <Button variant="outline" onClick={() => chooseTemplate("tests")}>
              Tests between my accounts
            </Button>
            <Button variant="outline" onClick={() => chooseTemplate("reply")}>
              Reply to people I've emailed before (ask first)
            </Button>
            <Button variant="outline" onClick={() => chooseTemplate("meetings")}>
              Schedule meetings autonomously under £0
            </Button>
          </div>
          {preview ? (
            <article className="agent-card">
              <h2>Review your permissions</h2>
              <MandateDescription
                mandate={preview.mandate}
                accounts={data.accounts}
                currency={form.getValues("currency")}
              />
              <details>
                <summary>Technical details</summary>
                <pre>{preview.turtle}</pre>
              </details>
              <div className="agent-row">
                <Button
                  disabled={busy || !!pending || !data.agent}
                  onClick={() =>
                    run(
                      () => activateMandate(client, session, preview.mandate),
                      "Permissions activated",
                    )
                  }
                >
                  {busy ? "Signing…" : "Sign and activate"}
                </Button>
                <Button
                  variant="outline"
                  disabled={busy || !!pending}
                  onClick={() => setPreview(undefined)}
                >
                  Back to edit
                </Button>
              </div>
            </article>
          ) : (
            <form
              className="agent-card agent-permissions-form"
              onSubmit={makePreview}
              onChange={() => {
                setTemplate("custom");
                setSaved(false);
              }}
            >
              <fieldset>
                <legend>Channels allowed</legend>
                {bindings.map((binding) => (
                  <label className="agent-row" key={binding}>
                    <input type="checkbox" value={binding} {...form.register("bindings")} />
                    {binding === "gmail"
                      ? "Gmail"
                      : binding === "graph-mail"
                        ? "Work email"
                        : binding}
                  </label>
                ))}
              </fieldset>
              <fieldset>
                <legend>Recipients: my own accounts</legend>
                {data.accounts
                  .filter((a) => a.channelHandleHash)
                  .map((a) => (
                    <label className="agent-row" key={a.id}>
                      <input
                        type="checkbox"
                        value={a.channelHandleHash}
                        {...form.register("recipients")}
                      />
                      {a.label ?? "Account"}
                      <Badge variant="outline">{a.channelHandleHash?.slice(0, 12)}</Badge>
                    </label>
                  ))}
              </fieldset>
              {(
                [
                  ["SendMessage", "Send messages"],
                  ["BookAppointment", "Book appointments"],
                  ["Remember", "Remember information"],
                ] as const
              ).map(([action, label]) => (
                <fieldset key={action}>
                  <legend>{label}</legend>
                  <label className="agent-row">
                    <input type="radio" value="ask" {...form.register(action)} />
                    Ask me first
                  </label>
                  <label className="agent-row">
                    <input type="radio" value="auto" {...form.register(action)} />
                    Do it without asking
                  </label>
                </fieldset>
              ))}
              <label className="agent-row">
                <input type="checkbox" {...form.register("transfer")} />
                Allow moving money (ask me first)
              </label>
              <Label htmlFor="daily-sends">Daily send limit</Label>
              <Input
                id="daily-sends"
                type="number"
                min={0}
                {...form.register("sends", { valueAsNumber: true })}
              />
              <Label htmlFor="recipient-limit">
                Contact the same person at most this many times a day
              </Label>
              <Input
                id="recipient-limit"
                type="number"
                min={0}
                {...form.register("perRecipient", { valueAsNumber: true })}
              />
              <Label htmlFor="spend-cap">Daily spend cap</Label>
              <Input
                id="spend-cap"
                type="number"
                min={0}
                step="0.01"
                {...form.register("spend", { valueAsNumber: true })}
              />
              <Label htmlFor="spend-currency">Currency</Label>
              <Input id="spend-currency" readOnly {...form.register("currency")} />
              <p>Spending limits on this agent are in GBP.</p>
              <Label htmlFor="valid-until">Valid until</Label>
              <Input
                id="valid-until"
                type="date"
                required
                min={new Date().toISOString().slice(0, 10)}
                max={new Date(Date.now() + 364 * 86400000).toISOString().slice(0, 10)}
                {...form.register("until")}
              />
              <fieldset>
                <legend>Memory it may use</legend>
                <p>
                  Choose saved information your agent may use to personalise. Choose none to turn it
                  off.
                </p>
                {MEMORY_CATEGORIES.map((category) => (
                  <label className="agent-row" key={category.id}>
                    <input type="checkbox" value={category.id} {...form.register("memoryScope")} />
                    {category.label}
                  </label>
                ))}
              </fieldset>
              {confirm && (
                <>
                  <Label htmlFor="permission-confirm">Type CONFIRM to allow this</Label>
                  <Input id="permission-confirm" autoComplete="off" {...form.register("confirm")} />
                </>
              )}
              {Object.entries(form.formState.errors).map(([name, value]) => (
                <p role="alert" key={name}>
                  {value.message}
                </p>
              ))}
              <Button type="submit" disabled={!data.agent || busy || !!pending}>
                Preview permissions
              </Button>
            </form>
          )}
        </>
      ) : null}
    </Screen>
  );
}

/** Refresh permission claims whenever the shared clock crosses a policy boundary. */
export function MandateDescription({
  mandate,
  accounts,
  currency = "GBP",
}: {
  mandate: Mandate;
  accounts: Account[];
  currency?: string;
}) {
  const boundaries = useMemo(() => mandateBoundaries(mandate), [mandate]);
  const now = useAgentClock(boundaries);
  const [result, setResult] = useState<{
    mandate: Mandate;
    accounts: Account[];
    currency: string;
    now: number;
    lines: string[];
  }>();
  useEffect(() => {
    let active = true;
    void describeMandate(mandate, accounts, currency, new Date(now)).then((lines) => {
      if (active) setResult({ mandate, accounts, currency, now, lines });
    });
    return () => {
      active = false;
    };
  }, [mandate, accounts, currency, now]);
  return result?.mandate === mandate &&
    result.accounts === accounts &&
    result.currency === currency &&
    result.now === now ? (
    <ul>
      {result.lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  ) : (
    <p>Checking permissions…</p>
  );
}
