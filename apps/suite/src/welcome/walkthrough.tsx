// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { AppIcon, Button } from "@jeswr/suite-ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useSuiteEnvironment } from "@/shell/environment";
import { useDemoStart } from "@/shell/public/use-demo-start";
import { useAccounts } from "@/shell/session/accounts-context";
import { type WalkthroughStep, walkthroughSteps } from "./steps";
import { useOptionalWalkthrough, useWalkthrough } from "./walkthrough-provider";

function StepLinks({ step }: { step: WalkthroughStep }) {
  const { active, status } = useAccounts();
  const env = useSuiteEnvironment();
  const demo = useDemoStart();
  const router = useRouter();
  return (
    <>
      <div className="welcome-actions">
        {step.destinations.map((destination) => {
          const needsSession = destination.app && !active;
          const href =
            needsSession && !env.NEXT_PUBLIC_SUITE_DEMO
              ? `/signin?next=${encodeURIComponent(destination.href)}`
              : destination.href;
          return (
            <Button key={destination.href} variant="outline" size="sm" asChild>
              <Link
                href={href}
                aria-disabled={demo.busy || status === "loading" || undefined}
                onClick={async (event) => {
                  if (demo.busy || status === "loading") {
                    event.preventDefault();
                    return;
                  }
                  if (!needsSession || !env.NEXT_PUBLIC_SUITE_DEMO) return;
                  // Establish the demo account before the destination's session guard runs.
                  event.preventDefault();
                  if (await demo.start()) router.push(destination.href);
                }}
              >
                {step.destinations.length === 1 ? "Go" : `Go to ${destination.label}`}
              </Link>
            </Button>
          );
        })}
      </div>
      {demo.error && <p role="alert">{demo.error}</p>}
    </>
  );
}

function StepTasks({ step }: { step: WalkthroughStep }) {
  return (
    <ul className="walkthrough-tasks">
      {step.tasks.map((task) => (
        <li key={task}>{task}</li>
      ))}
    </ul>
  );
}

export function WalkthroughPage() {
  const walkthrough = useWalkthrough();
  // Visiting the full guide starts or resumes it without discarding any ticks.
  useEffect(() => {
    if (walkthrough.ready && (!walkthrough.ui.started || walkthrough.ui.dismissed))
      walkthrough.start();
  }, [walkthrough]);
  return (
    <>
      <header className="welcome-hero">
        <p className="welcome-eyebrow">About twenty minutes · Go at your own pace</p>
        <h1>Guided walkthrough</h1>
        <p>
          Try a few everyday things in each app. Tick a step when you have tried it, even if
          something got in the way. Your progress stays in this browser.
        </p>
        <p>
          The Go links open a demo pod if you are signed out. If you are signed in, they use your
          current pod.
        </p>
        <p className="welcome-note">
          The demo pod lives in this browser only. Nothing is shared. You can also use your own pod.
        </p>
        <p aria-live="polite">
          {walkthrough.progress.done.length} of {walkthroughSteps.length} steps tried
        </p>
        <Link href="/welcome">Back to welcome</Link>
      </header>
      <ol className="walkthrough-steps">
        {walkthroughSteps.map((step, index) => (
          <li key={step.id} className="welcome-card" id={`step-${step.id}`}>
            <div className="walkthrough-step-heading">
              {step.destinations[0]?.app && <AppIcon app={step.destinations[0].app} decorative />}
              <h2>
                {index + 1}. {step.title}
              </h2>
            </div>
            <StepTasks step={step} />
            <StepLinks step={step} />
            <label className="walkthrough-check">
              <input
                type="checkbox"
                checked={walkthrough.progress.done.includes(step.id)}
                disabled={!walkthrough.ready}
                onChange={() => walkthrough.toggle(step.id)}
              />
              I have tried {step.title}
            </label>
          </li>
        ))}
      </ol>
    </>
  );
}

export function WalkthroughDock() {
  const walkthrough = useOptionalWalkthrough();
  if (!walkthrough) return null;
  const remaining = walkthroughSteps.filter((step) => !walkthrough.progress.done.includes(step.id));
  const [current, next] = remaining;
  if (!walkthrough.ready || !walkthrough.ui.started || walkthrough.ui.dismissed || !current)
    return null;
  return (
    <aside className="walkthrough-dock" aria-label="Walkthrough guide">
      <div className="walkthrough-dock-heading">
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={!walkthrough.ui.collapsed}
          aria-controls="walkthrough-guide-body"
          onClick={walkthrough.collapse}
        >
          {walkthrough.ui.collapsed ? "Open guide" : "Collapse guide"}
        </Button>
        <Button variant="ghost" size="sm" onClick={walkthrough.dismiss}>
          Dismiss guide
        </Button>
      </div>
      <div id="walkthrough-guide-body" hidden={walkthrough.ui.collapsed}>
        <p className="welcome-eyebrow">
          Guided walkthrough · {walkthrough.progress.done.length}/{walkthroughSteps.length}
        </p>
        <h2>Try now: {current.title}</h2>
        <StepTasks step={current} />
        <StepLinks step={current} />
        <label className="walkthrough-check">
          <input type="checkbox" checked={false} onChange={() => walkthrough.toggle(current.id)} />I
          have tried {current.title}
        </label>
        {next && <p className="welcome-note">Next: {next.title}</p>}
        <Link href="/welcome/walkthrough">All walkthrough steps</Link>
      </div>
    </aside>
  );
}
