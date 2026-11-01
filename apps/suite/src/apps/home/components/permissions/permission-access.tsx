// AUTHORED-BY Codex GPT-6
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
  Button,
  PermissionRow,
  Switch,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@jeswr/suite-ui";
import { Globe, Users } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { type AgentRow, modeLabel, type PermissionLine, roleLabel } from "../../lib/permissions";
import {
  agentHref,
  agentName,
  consequenceText,
  dataTypeLabel,
  durationLabel,
  featureLabel,
  type PermissionsView,
  parentNames,
  permissionDate,
  relativePath,
  revokeCopy,
} from "../../lib/permissions/view";
import type { PermissionsBinding } from "../../state/permissions";

export function DisabledHint({ reason, children }: { reason: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Tooltip open={!!reason && open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        {/* Keyboard access to the explanation when its child control is disabled. */}
        {/* biome-ignore lint/a11y/useSemanticElements: This tooltip surrounds an article or link rather than a form field group. */}
        <div
          role="group"
          className="hm-permission-hint"
          tabIndex={reason ? 0 : -1}
          aria-label={reason || undefined}
        >
          {children}
        </div>
      </TooltipTrigger>
      {reason && <TooltipContent>{reason}</TooltipContent>}
    </Tooltip>
  );
}

function GrantDetails({
  line,
  storage,
  technical,
}: {
  line: PermissionLine;
  storage: string;
  technical: boolean;
}) {
  return (
    <div className="hm-permission-technical">
      <div className="hm-permission-chips">
        {line.modes.map((mode) => (
          <span className="hm-permission-chip" key={mode}>
            {modeLabel(mode)}
          </span>
        ))}
      </div>
      {line.resources.map((resource) => (
        <div className="hm-permission-path" key={`${resource.url}:${resource.node}`}>
          <code>{relativePath(resource.url, storage)}</code>
          {technical ? (
            <a href={resource.source} target="_blank" rel="noopener noreferrer">
              View grant<span className="sr-only"> for {dataTypeLabel(line)}</span>
            </a>
          ) : (
            <DisabledHint reason="Enable technical details in Settings">
              <Button variant="ghost" disabled>
                View grant
              </Button>
            </DisabledHint>
          )}
        </div>
      ))}
    </div>
  );
}

/** Shared by the list and full-page detail, including the exact switch label. */
export function PermissionLines({
  row,
  binding,
  view,
  storage,
  technical,
  onChange,
}: {
  row: AgentRow;
  binding: PermissionsBinding;
  view: PermissionsView;
  storage: string;
  technical: boolean;
  onChange: (line: PermissionLine, checked: boolean) => void;
}) {
  const name = agentName(row);
  return (
    <div className="hm-permission-lines">
      {row.lines.map((line) => {
        const removed = binding.removed[line.key];
        const reason = !binding.online
          ? "Reconnect to change access"
          : line.resources.some((r) => r.system === "acp")
            ? "This storage doesn't support changing access here yet"
            : binding.busy
              ? "Saving access changes"
              : "";
        return (
          <section
            className="hm-permission-line"
            key={line.key}
            aria-label={`${dataTypeLabel(line)} for ${name}`}
          >
            <div className="hm-permission-line-main">
              <div>
                <p>
                  <strong>{dataTypeLabel(line)}</strong> → {featureLabel(line, name)} ·{" "}
                  {durationLabel(line)}
                </p>
                <p className="hm-permission-muted">{roleLabel(line.role)}</p>
              </div>
              <DisabledHint reason={reason}>
                <Switch
                  className="hm-permission-switch"
                  checked={!removed}
                  disabled={!!reason}
                  aria-label={`${dataTypeLabel(line)} for ${name}`}
                  onCheckedChange={(checked) => onChange(line, checked)}
                />
              </DisabledHint>
            </div>
            {parentNames(line).map((parent) => (
              <p className="hm-permission-muted" key={parent}>
                Inherited from {parent}
              </p>
            ))}
            {view === "advanced" && (
              <GrantDetails line={line} storage={storage} technical={technical} />
            )}
            {removed && (
              <div className="su-consequence" role="status">
                <p>{consequenceText(line, name)}</p>
                <Button
                  variant="outline"
                  disabled={!!reason || !removed.token}
                  onClick={() => onChange(line, true)}
                >
                  Undo
                </Button>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

export function PermissionAccessRow({
  row,
  binding,
  storage,
  view,
  technical,
  alwaysExpanded = false,
}: {
  row: AgentRow;
  binding: PermissionsBinding;
  storage: string;
  view: PermissionsView;
  technical: boolean;
  alwaysExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(alwaysExpanded);
  const [confirm, setConfirm] = useState<"all" | PermissionLine | null>(null);
  const focus = useRef<HTMLElement | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const [slots, setSlots] = useState<{ header: HTMLElement; items: HTMLElement }>();
  useLayoutEffect(() => {
    const header = wrapper.current?.querySelector<HTMLElement>(".su-permission-header");
    const items = wrapper.current?.querySelector<HTMLElement>(".su-permission-items");
    if (header && items) setSlots({ header, items });
  }, []);
  const name = agentName(row);
  const pseudo = row.kind === "public" || row.kind === "authenticated";
  const unsupported = row.lines.some((line) => line.resources.some((r) => r.system === "acp"));
  const reason = !binding.online
    ? "Reconnect to change access"
    : unsupported
      ? "This storage doesn't support changing access here yet"
      : binding.busy
        ? "Saving access changes"
        : "";
  const active = row.lines.filter((line) => !binding.removed[line.key]);
  const allCopy = revokeCopy({ ...row, lines: active });
  const expand = (next: boolean) => {
    if (alwaysExpanded) return;
    setExpanded(next);
    if (!next) binding.collapse(row.key);
  };
  const open = (target: "all" | PermissionLine) => {
    focus.current = document.activeElement as HTMLElement;
    setConfirm(target);
  };
  const changeLine = (line: PermissionLine, checked: boolean) => {
    if (checked) {
      const token = binding.removed[line.key]?.token;
      if (token) void binding.undo(token);
    } else if (line.inherited) open(line);
    else void binding.revoke(line);
  };
  const nameLink = (
    <div className="hm-permission-name">
      {row.kind === "public" ? (
        <Globe aria-hidden="true" size={20} />
      ) : row.kind === "authenticated" ? (
        <Users aria-hidden="true" size={20} />
      ) : null}
      <Link href={agentHref(row)}>{name}</Link>
    </div>
  );
  return (
    <TooltipProvider>
      {/* biome-ignore lint/a11y/useSemanticElements: Groups an article with supplementary navigation and metadata, not form fields. */}
      <div
        role="group"
        ref={wrapper}
        className="hm-permission-card"
        data-agent={row.id}
        data-pseudo={pseudo || undefined}
        data-line-slot={!!slots || undefined}
        onKeyDown={(event) => {
          if (
            event.key.toLowerCase() !== "r" ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            reason ||
            !active.length ||
            (event.target as HTMLElement).closest("input,textarea,[contenteditable=true]")
          )
            return;
          event.preventDefault();
          open("all");
        }}
      >
        {/* PermissionRow exposes no slots. Portal the local extensions into its existing
            semantic header and controlled region; CSS hides only its stock line children. */}
        {slots ? createPortal(nameLink, slots.header) : nameLink}
        <DisabledHint reason={reason}>
          <PermissionRow
            name={name}
            since={row.since ? permissionDate(row.since) : ""}
            expanded={expanded}
            onExpandedChange={expand}
            items={row.lines.map((line) => ({
              id: line.key,
              label: dataTypeLabel(line),
              feature: featureLabel(line, name),
              duration: durationLabel(line),
              checked: !binding.removed[line.key],
              sources: [roleLabel(line.role)],
              consequence: consequenceText(line, name),
              ...(reason ? { disabled: true as const, reason } : {}),
            }))}
            onItemChange={(key, checked) => {
              const line = row.lines.find((item) => item.key === key);
              if (line) changeLine(line, checked);
            }}
            onRevoke={() => void binding.revoke({ ...row, lines: active })}
            revokeLabel={pseudo ? "Make private" : "Revoke all"}
          />
        </DisabledHint>
        {slots &&
          createPortal(
            <PermissionLines
              row={row}
              binding={binding}
              storage={storage}
              view={view}
              technical={technical}
              onChange={changeLine}
            />,
            slots.items,
          )}
        <AlertDialog
          open={confirm !== null}
          onOpenChange={(next) => {
            if (!next) setConfirm(null);
          }}
        >
          <AlertDialogContent
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (focus.current?.isConnected && !focus.current.matches(":disabled"))
                focus.current.focus();
              else wrapper.current?.querySelector<HTMLButtonElement>("button")?.focus();
            }}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>
                {confirm && confirm !== "all"
                  ? `This changes access for everything in ${parentNames(confirm).join(", ")}`
                  : allCopy.title}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {confirm && confirm !== "all"
                  ? consequenceText(confirm, name)
                  : allCopy.description}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={!!reason}
                onClick={() => {
                  if (confirm)
                    void binding.revoke(confirm === "all" ? { ...row, lines: active } : confirm);
                }}
              >
                Remove access
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
  );
}
