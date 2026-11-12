// AUTHORED-BY Claude Opus 5.5
"use client";

/**
 * The exact access an approval grants, from `previewDecision`: every place and the role it gets.
 * The review sheet sends this preview as `decide`'s expected pin, so what is listed here is what
 * is shared, or nothing is.
 */

import type { DecisionPreview } from "@jeswr/pod-access/requests-solid";
import { Button } from "@jeswr/suite-ui";
import { useId } from "react";
import { relativePath } from "../../lib/permissions/view";
import { PREVIEW_CHANGED, targetRoleText } from "../../lib/requests/model";

export const PREVIEW_LOADING = "Checking exactly what will be shared…";
export const PREVIEW_SCOPE = "Only the places listed are shared.";

export function PreviewTargets({ preview, label }: { preview: DecisionPreview; label: string }) {
  return (
    <ul className="hm-request-targets" aria-label={label}>
      {preview.targets.map((target) => (
        <li key={target.url}>
          <span className="hm-request-target">{relativePath(target.url, preview.storage)}</span>
          <span className="hm-request-muted">{targetRoleText(target.role)}</span>
        </li>
      ))}
    </ul>
  );
}

export interface PreviewPanelProps {
  /** The heading: what sharing (or finishing) grants. */
  title: string;
  preview?: DecisionPreview | undefined;
  /** A plain-language reason the preview couldn't be read; approving waits for a preview. */
  error?: string | undefined;
  onRetry?: (() => void) | undefined;
  /** The preview the owner confirmed before `decide` found the access had changed. */
  previous?: DecisionPreview | undefined;
}

export function PreviewPanel({ title, preview, error, onRetry, previous }: PreviewPanelProps) {
  const headingId = useId();
  return (
    <section className="hm-request-preview" aria-labelledby={headingId}>
      <h3 id={headingId}>{title}</h3>
      {previous && (
        <div role="status" className="hm-request-changed">
          <p>{PREVIEW_CHANGED}</p>
          <p className="hm-request-muted">Before</p>
          <PreviewTargets preview={previous} label="Before" />
          <p className="hm-request-muted">Now</p>
        </div>
      )}
      {preview ? (
        <>
          <PreviewTargets preview={preview} label={previous ? "Now" : title} />
          <p className="hm-request-muted">{PREVIEW_SCOPE}</p>
        </>
      ) : error ? (
        <div className="hm-request-note">
          <p role="alert" className="hm-request-error">
            {error}
          </p>
          {onRetry && (
            <Button variant="outline" size="sm" onClick={onRetry}>
              Check again
            </Button>
          )}
        </div>
      ) : (
        <p role="status" className="hm-request-muted">
          {PREVIEW_LOADING}
        </p>
      )}
    </section>
  );
}
