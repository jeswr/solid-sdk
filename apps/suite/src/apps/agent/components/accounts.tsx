// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
"use client";
import type { Account, ChannelCapability } from "@jeswr/agent-model";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  Badge,
  Button,
  ProvenanceBadge,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  Switch,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  toast,
} from "@jeswr/suite-ui";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  type AccountPatch,
  AccountSettingsQueue,
  accountBinding,
  accountDescriptor,
  accountLoginCommand,
  persistAccountPatch,
  readAccountSettings,
} from "../lib/accounts";
import { isLoaded } from "../lib/client";
import { collection, metadataOf } from "../lib/collections";
import { type Query, useAgentQuery, useAgentWorkspace } from "../lib/hooks";
import { mandateBoundaries } from "../lib/mandate-rules";
import { loadVerifiedMandate, mandateNamesBinding } from "../lib/mandates";
import { resourceSlug } from "../lib/paths";
import { loadedRecords, readDescriptors } from "../lib/readers";
import { useApprovalDevice } from "./approval-key-setup-sheet";
import { DetailScreen, QueryRows, Screen } from "./states";
import { useAgentClock } from "./use-agent-clock";

const LABELS = {
  none: "Not set up",
  "setup-required": "Setup required",
  connected: "Connected",
  error: "Error",
  disabled: "Disabled",
};
const SEND_TIP = "Your permissions don't let the agent send on this account yet";
const NAMES: Record<string, string> = {
  google: "Google",
  google_workspace: "Google Workspace",
  gmail: "Gmail",
  microsoft: "Microsoft",
  "graph-mail": "Microsoft Mail",
  "graph-teams": "Microsoft Teams",
  microsoft_teams: "Microsoft Teams",
  email: "Email",
  matrix: "Matrix",
  matrix_bot: "Matrix bot",
  matrix_bridge: "Matrix bridge",
  phone_messages: "Messages",
  github_notifications: "GitHub",
  atproto: "Bluesky",
  email_proxy: "Email notifications",
};
const LOGOS: Record<string, string> = {
  google: "google",
  google_workspace: "google",
  gmail: "google",
  microsoft: "microsoft",
  "graph-mail": "microsoft",
  "graph-teams": "microsoft",
  slack: "slack",
  matrix: "matrix",
  matrix_bridge: "matrix",
  matrix_bot: "matrix",
  github: "github",
  discord: "discord",
  atproto: "bluesky",
  bluesky: "bluesky",
  mastodon: "mastodon",
  apple: "apple",
  telegram: "telegram",
  x: "x",
  email_proxy: "email",
};
function displayName(value: string) {
  return (
    (Object.hasOwn(NAMES, value) ? NAMES[value] : undefined) ??
    (/^[a-z][a-z0-9_-]*$/i.test(value)
      ? value.replaceAll(/[_-]/g, " ").replace(/^./, (c) => c.toUpperCase())
      : "Other")
  );
}

/** Never receives or renders daemon handles or resolved credentials. */
export function AccountCapabilities({
  descriptor,
}: {
  descriptor?: ChannelCapability | undefined;
}) {
  return descriptor ? (
    <table className="agent-capabilities">
      <caption>Capabilities</caption>
      <tbody>
        {[
          ["Can carry structured data", descriptor.structuredPayload ? "Yes" : "No"],
          ["End-to-end encrypted", descriptor.endToEndEncrypted ? "Yes" : "No"],
          ["Delivery receipts", descriptor.deliveryReceipts ? "Yes" : "No"],
          [
            "History available",
            descriptor.historyWindow === "P30D"
              ? "30 days"
              : descriptor.historyWindow === "P0D"
                ? "No history"
                : "Available",
          ],
          [
            "Largest message",
            `${new Intl.NumberFormat().format(descriptor.maxMessageBytes)} bytes`,
          ],
          [
            "Cost per message",
            descriptor.costPerMessage === 0
              ? "Free"
              : `${descriptor.costPerMessage} (currency not recorded)`,
          ],
          [
            "Rate limit",
            `${descriptor.rateLimit.perDay} messages a day; ${descriptor.rateLimit.perRecipient} to the same person`,
          ],
        ].map(([label, value]) => (
          <tr key={label}>
            <th scope="row">{label}</th>
            <td>{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  ) : (
    <p>No capabilities recorded for this account.</p>
  );
}

function AccountCard({
  account,
  descriptor,
  detail,
  sendAllowed,
}: {
  account: Account;
  descriptor?: ChannelCapability | undefined;
  detail: boolean;
  sendAllowed: boolean;
}) {
  const { client, session } = useAgentWorkspace();
  const device = useApprovalDevice();
  const [, render] = useState(0);
  const [connect, setConnect] = useState(false);
  const [disconnect, setDisconnect] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [save, setSave] = useState("");
  const connectButton = useRef<HTMLButtonElement>(null);
  const disconnectButton = useRef<HTMLButtonElement>(null);
  const disconnectConfirmed = useRef(false);
  const labels = useId();
  const binding = accountBinding(account);
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshed fields reconcile below without replacing pending edits
  const queue = useMemo(
    () =>
      new AccountSettingsQueue(
        { bindingState: account.bindingState, restrictions: account.restrictions },
        (patch) => persistAccountPatch(client, session, account.id, patch),
        () => render((n) => n + 1),
      ),
    [account.id, binding, client, session],
  );
  useEffect(() => {
    queue.reconcile(account);
    render((n) => n + 1);
  }, [account, queue]);
  useEffect(() => {
    const media = matchMedia("(max-width: 767px)");
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (save !== "Saved") return;
    const timer = setTimeout(() => setSave(""), 1500);
    return () => clearTimeout(timer);
  }, [save]);
  const change = (patch: AccountPatch) =>
    void device.requireKey(() => {
      setSave("Saving…");
      void queue.change(patch).then(
        () => setSave("Saved"),
        () => {
          const message = "Couldn't save this change. Your previous settings have been restored.";
          setSave(message);
          toast.error(message);
        },
      );
    });
  const current = queue.value;
  const command = accountLoginCommand(account);
  const label = account.label ?? `${displayName(account.provider)} account`;
  return (
    <article className="agent-card" data-agent-account>
      <h3>{label}</h3>
      <ProvenanceBadge
        className="agent-provider"
        source={displayName(account.provider)}
        {...(Object.hasOwn(LOGOS, account.provider)
          ? { logoSrc: `/agent/providers/${LOGOS[account.provider]}.svg` }
          : {})}
      />
      {account.organisation && <p>{account.organisation}</p>}
      <Badge variant="secondary">{LABELS[current.bindingState]}</Badge>
      {account.channelHandleHash && (
        <Badge variant="outline">Account hash: {account.channelHandleHash.slice(0, 16)}</Badge>
      )}
      {account.inventory?.identityConflicts.length ? (
        <div role="alert" className="agent-banner">
          <p>Two different handles recorded — pick one</p>
          <details>
            <summary>How to resolve this</summary>
            <p>
              On the agent's computer, review the source registry, keep the handle you recognise,
              then import it again. Only you can make this choice.
            </p>
          </details>
        </div>
      ) : null}
      <div className="agent-restrictions">
        {(["read", "triage", "draft", "send"] as const).map((name) => {
          const text = name.charAt(0).toUpperCase() + name.slice(1);
          const disabled = name === "send" && !sendAllowed;
          const toggle = (
            <Switch
              id={`${labels}-${name}`}
              aria-label={`${text} for ${label}`}
              checked={current.restrictions[name]}
              disabled={disabled}
              onCheckedChange={(value) => change({ restrictions: { [name]: value } })}
            />
          );
          return (
            <div key={name}>
              <label htmlFor={`${labels}-${name}`}>{text}</label>
              {disabled ? (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard users can reveal the disabled switch explanation */}
                      <span className="agent-disabled" tabIndex={0} title={SEND_TIP}>
                        {toggle}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>{SEND_TIP}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : (
                toggle
              )}
            </div>
          );
        })}
      </div>
      <p>
        Last ingest:{" "}
        {descriptor?.lastIngest ? new Date(descriptor.lastIngest).toLocaleString() : "Not recorded"}
      </p>
      <div role="status" aria-live="polite">
        {queue.busy ? "Saving…" : save}
      </div>
      <Button ref={connectButton} variant="outline" onClick={() => setConnect(true)}>
        Connect…
      </Button>
      {detail ? (
        <>
          <AccountCapabilities descriptor={descriptor} />
          <h3>Scopes granted</h3>
          {descriptor?.grantedScopes === undefined ? (
            <p>No scopes recorded by the agent.</p>
          ) : descriptor.grantedScopes.length === 0 ? (
            <p>No scopes granted.</p>
          ) : (
            <details>
              <summary>Technical details</summary>
              <ul className="agent-scopes">
                {[...new Set(descriptor.grantedScopes)].map((scope) => (
                  <li key={scope}>
                    <code>{scope}</code>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <Button
            ref={disconnectButton}
            variant="outline"
            onClick={() => {
              disconnectConfirmed.current = false;
              setDisconnect(true);
            }}
            disabled={current.bindingState === "disabled"}
          >
            Disconnect
          </Button>
        </>
      ) : (
        <Link href={`/agent/accounts/${encodeURIComponent(resourceSlug(account.id) ?? "")}`}>
          View {label}
        </Link>
      )}
      <Sheet open={connect} onOpenChange={setConnect}>
        <SheetContent
          side={mobile ? "bottom" : "right"}
          className="agent-app agent-detail-sheet"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            connectButton.current?.focus();
          }}
        >
          <SheetTitle>Connect {label}</SheetTitle>
          <SheetDescription>
            Accounts are connected on the computer where your agent runs, so this app never sees
            your passwords or tokens.
          </SheetDescription>
          <p>Run this command on that computer:</p>
          <code>{command}</code>
          <Button
            onClick={() =>
              void navigator.clipboard.writeText(command).then(
                () => toast.success("Command copied"),
                () => toast.error("Couldn't copy the command. Select and copy it instead."),
              )
            }
          >
            Copy command
          </Button>
        </SheetContent>
      </Sheet>
      <AlertDialog open={disconnect} onOpenChange={setDisconnect}>
        <AlertDialogContent
          className="agent-app"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            (disconnectConfirmed.current ? connectButton : disconnectButton).current?.focus();
          }}
        >
          <AlertDialogTitle>Disconnect {label}?</AlertDialogTitle>
          <AlertDialogDescription>
            Your agent will stop using this account. It will disconnect on the agent's computer and
            confirm in Activity.
          </AlertDialogDescription>
          <div className="agent-row">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              onClick={() => {
                disconnectConfirmed.current = true;
                setDisconnect(false);
                change({ bindingState: "disabled" });
              }}
            >
              Disconnect
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  );
}

export function AccountsScreen({ id }: { id?: string }) {
  const { client, session } = useAgentWorkspace();
  const query = useAgentQuery(client.workspace, (c) => readAccountSettings(c, session));
  const descriptors = useAgentQuery(client.paths.descriptors, readDescriptors);
  const mandate = useAgentQuery(client.workspace, (c) => loadVerifiedMandate(c, session));
  const policy = mandate.status === "ready" ? mandate.data : undefined;
  const boundaries = useMemo(() => mandateBoundaries(policy), [policy]);
  const now = useAgentClock(boundaries);
  const accountRows = query.status === "ready" ? query.data : undefined;
  const [evaluated, setEvaluated] = useState<{
    policy: typeof policy;
    accounts: typeof accountRows;
    now: number;
    allowed: Record<string, boolean>;
  }>();
  useEffect(() => {
    if (!accountRows) return;
    let active = true;
    void Promise.all(
      loadedRecords(accountRows).map(
        async (account) =>
          [account.id, await mandateNamesBinding(policy, account, new Date(now))] as const,
      ),
    ).then((entries) => {
      if (active)
        setEvaluated({ policy, accounts: accountRows, now, allowed: Object.fromEntries(entries) });
    });
    return () => {
      active = false;
    };
  }, [policy, accountRows, now]);
  // Keep cards mounted during notification reconciliation so pending field edits stay visible.
  const previous = useRef<
    { client: typeof client; query: Extract<typeof query, { status: "ready" }> } | undefined
  >(undefined);
  if (query.status === "ready") previous.current = { client, query };
  const visible: Query<typeof query extends Query<infer T> ? T : never> =
    query.status === "loading" && previous.current?.client === client
      ? previous.current.query
      : query;
  const selected =
    visible.status === "ready" && id
      ? {
          ...visible,
          data: collection(
            visible.data.filter((row) => !isLoaded(row) || resourceSlug(row.record.id) === id),
            metadataOf(visible.data),
          ),
        }
      : visible;
  const content = (
    <QueryRows query={selected} empty="No connected accounts yet">
      {(rows) =>
        [...new Set(rows.map((row) => row.channel))].map((channel) => (
          <section key={channel}>
            <h2>{displayName(channel)}</h2>
            <div className="agent-grid">
              {rows
                .filter((row) => row.channel === channel)
                .map((row) => {
                  const descriptor =
                    descriptors.status === "ready"
                      ? accountDescriptor(row, loadedRecords(descriptors.data))
                      : undefined;
                  return (
                    <AccountCard
                      key={`${session.webId}:${row.id}`}
                      account={row}
                      descriptor={descriptor}
                      detail={!!id}
                      sendAllowed={
                        evaluated?.policy === policy &&
                        evaluated?.accounts === accountRows &&
                        evaluated?.now === now &&
                        evaluated.allowed[row.id] === true
                      }
                    />
                  );
                })}
            </div>
          </section>
        ))
      }
    </QueryRows>
  );
  return id ? (
    <DetailScreen title="Account details" back="/agent/accounts">
      {content}
    </DetailScreen>
  ) : (
    <Screen title="Accounts">{content}</Screen>
  );
}
