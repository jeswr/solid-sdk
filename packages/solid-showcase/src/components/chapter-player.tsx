// AUTHORED-BY Claude Fable 5
"use client";

import { cn } from "@jeswr/app-shell";
import { type KeyboardEvent as ReactKeyboardEvent, useState } from "react";
import type { ServiceRegistry, WalkthroughChapter } from "../schema.js";
import { TryLiveButton } from "./try-live.js";

export interface ChapterPlayerProps {
  chapter: WalkthroughChapter;
  registry: ServiceRegistry;
}

/**
 * Chapter player: a linear, keyboard-navigable stepper over one chapter's steps
 * (step-dot buttons, previous/next controls, and Arrow-key navigation on the stepper),
 * with the step's try-this-live deep link and the chapter's "what just happened
 * underneath" panel.
 */
export function ChapterPlayer({ chapter, registry }: ChapterPlayerProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const step = chapter.steps[stepIndex] ?? chapter.steps[0];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === chapter.steps.length - 1;

  function goPrevious() {
    setStepIndex((index) => Math.max(0, index - 1));
  }
  function goNext() {
    setStepIndex((index) => Math.min(chapter.steps.length - 1, index + 1));
  }
  function onStepperKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      goPrevious();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      goNext();
    }
  }

  if (step === undefined) return null;

  return (
    <div data-chapter-player={chapter.slug}>
      <nav
        aria-label="Steps in this chapter"
        className="flex items-center gap-2"
        onKeyDown={onStepperKeyDown}
      >
        {chapter.steps.map((chapterStep, index) => (
          <button
            aria-current={index === stepIndex ? "step" : undefined}
            aria-label={`Step ${index + 1}: ${chapterStep.title}`}
            className={cn(
              "h-2.5 flex-1 rounded-full transition-colors",
              index === stepIndex ? "bg-primary" : index < stepIndex ? "bg-primary/40" : "bg-muted",
            )}
            key={chapterStep.title}
            onClick={() => setStepIndex(index)}
            type="button"
          />
        ))}
      </nav>

      <div className="mt-6 rounded-xl border border-border bg-card p-6" data-chapter-step="">
        <p className="text-muted-foreground text-sm">
          Step {stepIndex + 1} of {chapter.steps.length}
        </p>
        <h2 className="mt-1 font-semibold text-2xl text-card-foreground tracking-tight">
          {step.title}
        </h2>
        <p className="mt-3 text-card-foreground leading-relaxed">{step.body}</p>
        <div className="mt-5">
          <TryLiveButton app={step.tryLive.app} label={step.tryLive.label} registry={registry} />
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <button
          className="rounded-lg border border-border px-4 py-2 font-medium text-sm disabled:cursor-not-allowed disabled:opacity-40"
          disabled={isFirst}
          onClick={goPrevious}
          type="button"
        >
          ← Previous step
        </button>
        <button
          className="rounded-lg border border-border px-4 py-2 font-medium text-sm disabled:cursor-not-allowed disabled:opacity-40"
          disabled={isLast}
          onClick={goNext}
          type="button"
        >
          Next step →
        </button>
      </div>

      {chapter.underneath !== undefined && chapter.underneath.length > 0 && (
        <details className="mt-6 rounded-xl border border-border bg-card" data-underneath-panel="">
          <summary className="cursor-pointer px-5 py-3 font-medium text-card-foreground text-sm">
            What just happened underneath
          </summary>
          <ul className="flex list-disc flex-col gap-2 border-border border-t px-5 py-4 pl-9 text-muted-foreground text-sm">
            {chapter.underneath.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
