// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import { ChevronDown } from "lucide-react";
import { Switch } from "radix-ui";
import { useId, useRef } from "react";
import { SourceBadges } from "./consent-sheet.js";
import { Button, ConfirmAction } from "./primitives.js";
import type { DisabledReason } from "./role-select.js";
import { hasSharingContent, type SharingState, SharingStatus } from "./state.js";

export type PermissionItem = {
  id: string;
  label: string;
  feature?: string;
  duration: string;
  checked: boolean;
  sources?: readonly string[];
  consequence?: string;
} & DisabledReason;
export interface PermissionRowProps {
  name: string;
  since: string;
  items: readonly PermissionItem[];
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onItemChange: (id: string, checked: boolean) => void;
  onRevoke: () => void;
  revokeLabel?: string;
  state?: SharingState;
  onRetry?: () => void;
  onClear?: () => void;
}

export function PermissionRow({
  name,
  since,
  items,
  expanded,
  onExpandedChange,
  onItemChange,
  onRevoke,
  revokeLabel = "Revoke all",
  state = { kind: "ready" },
  onRetry,
  onClear,
}: PermissionRowProps) {
  const id = useId();
  const headerRef = useRef<HTMLButtonElement>(null);
  const labels = [...new Set(items.map((item) => item.label))];
  const blocked = !hasSharingContent(state) || state.kind === "offline";
  return (
    <article className="su-permission" aria-label={`Access for ${name}`}>
      <header className="su-permission-header">
        <span className="su-agent-avatar" aria-hidden="true">
          {name.slice(0, 1)}
        </span>
        <button
          ref={headerRef}
          type="button"
          className="su-permission-trigger"
          aria-expanded={expanded}
          aria-controls={`${id}-items`}
          onClick={() => onExpandedChange(!expanded)}
        >
          <span className="su-stack su-small-gap">
            <strong>{name}</strong>
            <span className="su-muted">{since ? `Access since ${since}` : "Date unknown"}</span>
            <span className="su-wrap">
              {labels.slice(0, 4).map((label) => (
                <span className="su-tag" key={label}>
                  {label}
                </span>
              ))}
              {labels.length > 4 && <span className="su-tag">+{labels.length - 4}</span>}
            </span>
          </span>
          <ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" />
          <span className="su-sr-only">{expanded ? "Hide details" : "Show details"}</span>
        </button>
        <ConfirmAction
          trigger={revokeLabel}
          title={`Remove all access for ${name}?`}
          description={`${name} will no longer be able to see or change ${labels.join(", ") || "your data"}. You can share again later.`}
          action="Remove access"
          onConfirm={onRevoke}
          closeFocusFallback={headerRef}
          disabled={blocked || items.every((item) => !item.checked || item.disabled)}
        />
      </header>
      <div className="su-permission-items" id={`${id}-items`} hidden={!expanded}>
        <SharingStatus
          state={state}
          empty="Only you. No data is shared with this person or app."
          onRetry={onRetry}
          onClear={onClear}
        />
        {state.kind === "offline" && state.cached && (
          <p className="su-muted">Reconnect to change sharing</p>
        )}
        {hasSharingContent(state) &&
          items.map((item, index) => (
            <div className="su-permission-item" key={item.id}>
              <div className="su-stack su-small-gap">
                <label className="su-feature-map" htmlFor={`${id}-switch-${index}`}>
                  <strong>{item.label}</strong>
                  <span aria-hidden="true">→</span>
                  <span>{item.feature || `Used by ${name}`}</span>
                </label>
                <p className="su-muted">{item.duration}</p>
                {item.sources && <SourceBadges sources={item.sources} />}
                {item.disabled && (
                  <p className="su-muted" id={`${id}-reason-${index}`}>
                    {item.reason}
                  </p>
                )}
              </div>
              <Switch.Root
                className="su-switch"
                id={`${id}-switch-${index}`}
                aria-label={`Allow ${name} to use ${item.label}`}
                checked={item.checked}
                disabled={blocked || item.disabled}
                aria-describedby={
                  item.disabled
                    ? `${id}-reason-${index}`
                    : !item.checked
                      ? `${id}-consequence-${index}`
                      : undefined
                }
                onCheckedChange={(checked) => onItemChange(item.id, checked)}
              >
                <Switch.Thumb className="su-switch-thumb" />
              </Switch.Root>
              {!item.checked && (
                <div className="su-consequence" role="status" id={`${id}-consequence-${index}`}>
                  <p>
                    {item.consequence ||
                      (item.feature
                        ? `${item.feature} will stop working in ${name}`
                        : `${name} will lose access to your ${item.label}`)}
                  </p>
                  <Button
                    disabled={blocked || item.disabled}
                    onClick={() => onItemChange(item.id, true)}
                  >
                    Undo
                  </Button>
                </div>
              )}
            </div>
          ))}
      </div>
    </article>
  );
}
