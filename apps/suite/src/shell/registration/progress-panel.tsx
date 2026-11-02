// AUTHORED-BY Claude Opus 5.5
"use client";
/** The three-step registration progress with per-step errors and Retry (02-suite-shell §8.2). */
import { Button } from "@jeswr/suite-ui";
import { Check, Circle, LoaderCircle, TriangleAlert } from "lucide-react";
import { useEffect, useRef } from "react";
import {
  progressAnnouncement,
  REGISTRATION_STEPS,
  type RegistrationProgress,
  type StepStatus,
  stepStatusText,
} from "../lib/registration-steps";
import styles from "./registration.module.css";

const ICONS: Record<StepStatus, typeof Check> = {
  pending: Circle,
  active: LoaderCircle,
  done: Check,
  failed: TriangleAlert,
};

export function ProgressPanel({
  progress,
  onRetry,
  onChangeDetails,
}: {
  progress: RegistrationProgress;
  onRetry: () => void;
  onChangeDetails: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const retry = useRef<HTMLButtonElement>(null);
  const failed = progress.phase === "failed";
  // Focus follows the work: the heading while steps run, Retry when one fails.
  useEffect(() => {
    if (failed) retry.current?.focus();
    else heading.current?.focus();
  }, [failed]);
  return (
    <section className={styles.progress} aria-labelledby="signup-progress-title">
      <h2 id="signup-progress-title" ref={heading} tabIndex={-1}>
        Setting up your account
      </h2>
      <ol className={styles.steps}>
        {REGISTRATION_STEPS.map((step) => {
          const status = progress.steps[step.id];
          const Icon = ICONS[status];
          return (
            <li key={step.id} data-status={status}>
              <Icon aria-hidden="true" size={20} className={styles.stepIcon} />
              <span>{step.label}</span>
              <span className="suite-sr-only">: {stepStatusText(status)}</span>
            </li>
          );
        })}
      </ol>
      <p role="status" className={styles.status}>
        {progressAnnouncement(progress)}
      </p>
      {failed && progress.error && (
        <div className={styles.failure}>
          <p role="alert" className={styles.error}>
            {progress.error.message}
          </p>
          <div className={styles.actions}>
            <Button ref={retry} onClick={onRetry}>
              Retry
            </Button>
            {progress.error.step === "pod" && (
              <Button variant="outline" onClick={onChangeDetails}>
                Change my details
              </Button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
