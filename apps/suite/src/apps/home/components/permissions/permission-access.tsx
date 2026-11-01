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

/**
 * Explains a disabled control in a tooltip. The wrapper is a tab stop only when the
 * child can't take focus itself; a focusable child (an aria-disabled switch while
 * saving) opens the tooltip on focus, so a second tab stop would only repeat it.
 */
export function DisabledHint({
  reason,
  focusable = false,
  children,
}: {
  reason: string;
  focusable?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Tooltip open={!!reason && open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        {/* Keyboard access to the explanation when its child control is disabled. */}
        {/* biome-ignore lint/a11y/useSemanticElements: This tooltip surrounds an article or link rather than a form field group. */}
        <div
          role="group"
          className="hm-permission-hint"
          tabIndex={reason && !focusable ? 0 : -1}
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
              View grant<span className="sr-only"> for {dataTypeLabel(line, storage)}</span>
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
  const switches = useRef(new Map<string, HTMLButtonElement>());
  return (
    <div className="hm-permission-lines">
      {row.lines.map((line) => {
        const removed = binding.removed[line.key];
        const label = dataTypeLabel(line, storage);
        // Offline and unsupported lines are truly disabled. A save in flight only marks
        // controls aria-disabled, so the focused switch or Undo keeps keyboard focus.
        const blocked = !binding.online
          ? "Reconnect to change access"
          : line.resources.some((r) => r.system === "acp")
            ? "This storage doesn't support changing access here yet"
            : "";
        const reason = blocked || (binding.busy ? "Saving access changes" : "");
        return (
          <section
            className="hm-permission-line"
            key={line.key}
            aria-label={`${label} for ${name}`}
          >
            <div className="hm-permission-line-main">
              <div>
                <p>
                  <strong>{label}</strong> → {featureLabel(line, name)} · {durationLabel(line)}
                </p>
                <p className="hm-permission-muted">{roleLabel(line.role)}</p>
              </div>
              <DisabledHint reason={reason} focusable={!blocked}>
                <Switch
                  ref={(node: HTMLButtonElement | null) => {
                    if (node) switches.current.set(line.key, node);
                    else switches.current.delete(line.key);
                  }}
                  className="hm-permission-switch"
                  checked={!removed}
                  disabled={!!blocked}
                  aria-disabled={reason || removed?.stale ? true : undefined}
                  aria-label={`${label} for ${name}`}
                  onCheckedChange={(checked) => {
                    if (!reason && !removed?.stale) onChange(line, checked);
                  }}
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
                <p>{consequenceText(line, name, storage)}</p>
                {removed.stale ? (
                  <p className="hm-permission-muted">
                    This access was changed elsewhere, so it can't be restored here
                  </p>
                ) : (
                  <Button
                    variant="outline"
                    disabled={!!blocked || !removed.token}
                    aria-disabled={reason ? true : undefined}
                    onClick={() => {
                      if (reason) return;
                      // Undo removes this block; keep focus on the line's own switch.
                      switches.current.get(line.key)?.focus();
                      onChange(line, true);
                    }}
                  >
                    Undo
                  </Button>
                )}
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
  const blocked = !binding.online
    ? "Reconnect to change access"
    : unsupported
      ? "This storage doesn't support changing access here yet"
      : "";
  const reason = blocked || (binding.busy ? "Saving access changes" : "");
  const active = row.lines.filter((line) => !binding.removed[line.key]);
  const allCopy = revokeCopy({ ...row, lines: active }, storage);
  const revokeAll = () => binding.revoke(pseudo ? "makePrivate" : { ...row, lines: active });
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
      const removed = binding.removed[line.key];
      if (removed?.token && !removed.stale) void binding.undo(removed.token);
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
        <DisabledHint reason={reason} focusable={!blocked}>
          <PermissionRow
            name={name}
            since={row.since ? permissionDate(row.since) : ""}
            expanded={expanded}
            onExpandedChange={expand}
            items={row.lines.map((line) => ({
              id: line.key,
              label: dataTypeLabel(line, storage),
              feature: featureLabel(line, name),
              duration: durationLabel(line),
              checked: !binding.removed[line.key],
              sources: [roleLabel(line.role)],
              consequence: consequenceText(line, name, storage),
              ...(reason ? { disabled: true as const, reason } : {}),
            }))}
            onItemChange={(key, checked) => {
              const line = row.lines.find((item) => item.key === key);
              if (line) changeLine(line, checked);
            }}
            onRevoke={() => void revokeAll()}
            revokeLabel={pseudo ? "Make private" : "Revoke all"}
            revokeConfirmation={allCopy}
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
                  ? consequenceText(confirm, name, storage)
                  : allCopy.description}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={!!reason}
                onClick={() => {
                  if (confirm === "all") void revokeAll();
                  else if (confirm) void binding.revoke(confirm);
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
