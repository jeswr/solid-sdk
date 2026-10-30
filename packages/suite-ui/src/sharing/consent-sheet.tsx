// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import { Dialog } from "radix-ui";
import { useId, useRef } from "react";
import { DurationChips, type DurationChipsProps } from "./duration-chips.js";
import { Button, CheckField, ConfirmAction } from "./primitives.js";
import { hasSharingContent, type SharingState, SharingStatus } from "./state.js";

export interface ConsentDataType {
  id: string;
  label: string;
  description: string;
  count: number;
  sources: readonly string[];
}
export interface ConsentAccount {
  id: string;
  label: string;
}
export interface ConsentSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  purpose?: string;
  dataTypes: readonly ConsentDataType[];
  selected: readonly string[];
  onSelectionChange: (selected: string[]) => void;
  duration: DurationChipsProps;
  accounts: readonly ConsentAccount[];
  accountId: string;
  onAccountChange: (id: string) => void;
  onCancel: () => void;
  onShare: () => void;
  state?: SharingState;
  onRetry?: () => void;
  onClear?: () => void;
}

export function SourceBadges({ sources }: { sources: readonly string[] }) {
  return (
    <span className="su-wrap">
      {sources.map((source) => (
        <span className="su-source" key={source}>
          <span className="su-source-logo" aria-hidden="true">
            {source.slice(0, 1)}
          </span>
          Provided by {source}
        </span>
      ))}
    </span>
  );
}

export function ConsentSheet({
  open,
  onOpenChange,
  name,
  purpose,
  dataTypes,
  selected,
  onSelectionChange,
  duration,
  accounts,
  accountId,
  onAccountChange,
  onCancel,
  onShare,
  state = { kind: "ready" },
  onRetry,
  onClear,
}: ConsentSheetProps) {
  const id = useId();
  const returnFocus = useRef<HTMLElement | null>(null);
  const [selectedCount, total] = [
    dataTypes.filter((item) => selected.includes(item.id)).length,
    dataTypes.length,
  ];
  const content = hasSharingContent(state);
  const offline = state.kind === "offline";
  const blocked = !content || offline;
  const durationProps: DurationChipsProps = offline
    ? { ...duration, disabled: true, reason: "Reconnect to change sharing" }
    : duration;
  const invalidDate =
    duration.value === "custom" && !/^\d{4}-\d{2}-\d{2}$/.test(duration.customDate ?? "");
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="su-overlay" />
        <Dialog.Content
          className="su-sheet su-stack"
          onOpenAutoFocus={() => {
            returnFocus.current =
              document.activeElement instanceof HTMLElement ? document.activeElement : null;
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            returnFocus.current?.focus();
          }}
          onPointerDownOutside={(event) => event.preventDefault()}
        >
          <Dialog.Title className="su-title">
            {purpose ? `To ${purpose}, ${name} requests access to:` : `${name} requests access to:`}
          </Dialog.Title>
          <Dialog.Description className="su-muted">
            Choose what to share. You can revoke access at any time.
          </Dialog.Description>
          <SharingStatus
            state={state}
            empty="There is no data to share yet."
            onRetry={onRetry}
            onClear={onClear}
          />
          {content && (
            <>
              <CheckField
                checked={
                  selectedCount === total && total > 0
                    ? true
                    : selectedCount > 0
                      ? "indeterminate"
                      : false
                }
                disabled={blocked || total === 0}
                onChange={(checked) =>
                  onSelectionChange(checked ? dataTypes.map((item) => item.id) : [])
                }
              >
                Select all
              </CheckField>
              <div className="su-stack">
                {dataTypes.map((item) => (
                  <div className="su-data-card su-stack" key={item.id}>
                    <CheckField
                      checked={selected.includes(item.id)}
                      disabled={blocked}
                      onChange={(checked) =>
                        onSelectionChange(
                          checked
                            ? [...selected.filter((key) => key !== item.id), item.id]
                            : selected.filter((key) => key !== item.id),
                        )
                      }
                    >
                      <strong>{item.label}</strong>
                    </CheckField>
                    <p className="su-muted">{item.description}</p>
                    <p className="su-muted">
                      {item.count} {item.count === 1 ? "item" : "items"}
                    </p>
                    <SourceBadges sources={item.sources} />
                  </div>
                ))}
              </div>
              <DurationChips {...durationProps} />
              {accounts.length > 1 && (
                <label className="su-stack" htmlFor={`${id}-account`}>
                  Change account
                  <select
                    className="su-input"
                    id={`${id}-account`}
                    value={accountId}
                    disabled={blocked}
                    onChange={(event) => onAccountChange(event.target.value)}
                  >
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </>
          )}
          {offline && (
            <p className="su-muted" id={`${id}-offline`}>
              Reconnect to change sharing
            </p>
          )}
          <div className="su-equal-actions" data-consent-actions="">
            <ConfirmAction
              trigger="Cancel"
              disabled={offline}
              destructive={false}
              title="Deny this request?"
              description={`${name} will not receive access to your data.`}
              cancel="Keep reviewing"
              action="Deny"
              onConfirm={onCancel}
            />
            <Button
              onClick={onShare}
              disabled={blocked || selectedCount === 0 || invalidDate}
              aria-describedby={offline ? `${id}-offline` : undefined}
            >
              Share
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
