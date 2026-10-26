// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
"use client";

import { X } from "lucide-react";
import { type ReactNode, useId } from "react";

export interface DetailsPaneProps {
  title: string;
  preview?: ReactNode;
  metadata?: readonly { label: string; value: ReactNode }[];
  access?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  onClose?: (() => void) | undefined;
}

export function DetailsPane({
  title,
  preview,
  metadata = [],
  access,
  actions,
  children,
  onClose,
}: DetailsPaneProps) {
  const titleId = useId();
  return (
    <aside className="suite-details-pane" aria-labelledby={titleId}>
      <div className="suite-details-heading">
        <h2 id={titleId}>{title}</h2>
        {onClose && (
          <button
            type="button"
            data-slot="details-pane-close"
            className="suite-shell-icon-button"
            onClick={onClose}
            aria-label="Close details"
            title="Close details (])"
          >
            <X size={20} strokeWidth={1.75} aria-hidden="true" />
          </button>
        )}
      </div>
      {preview}
      {metadata.length > 0 && (
        <dl className="suite-details-metadata">
          {metadata.map(({ label, value }) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {access && (
        <section aria-label="Who has access">
          <h3>Who has access</h3>
          {access}
        </section>
      )}
      {actions && <div className="suite-details-actions">{actions}</div>}
      {children}
    </aside>
  );
}
