// AUTHORED-BY Claude Opus 5.5
"use client";
/**
 * /onboarding (02-suite-shell §8.3): three steps with Skip always visible.
 * Completion is stored per account in preferences (`onboarding`); once it is
 * complete or skipped, visiting /onboarding goes straight to the start page.
 * Only a finished signup routes here, so existing accounts never see it.
 */
import { Button, Input, Label, LoadingSkeleton } from "@jeswr/suite-ui";
import { HardDrive, Plug, ShieldCheck, Sparkles, Undo2, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { START_PAGE, START_PAGE_NAME } from "../lib/next";
import {
  moveStep,
  ONBOARDING_STEPS,
  type OnboardingState,
  type OnboardingStepIndex,
  onboardingFinished,
  stepCounter,
  storageHost,
} from "../lib/onboarding";
import { useAccounts } from "../session/accounts-provider";
import { SessionGuard } from "../session/session-guard";
import type { SuiteAccount } from "../session/types";
import { useAllPreferences, usePreferences } from "../settings/preferences";
import styles from "./onboarding.module.css";
import { type ProfileEditor, profileEditorFor } from "./profile";

export function OnboardingPage() {
  return (
    <Suspense>
      <SessionGuard>
        <Onboarding />
      </SessionGuard>
    </Suspense>
  );
}

function Onboarding() {
  const { active } = useAccounts();
  const { preferences, ready } = useAllPreferences();
  const onboarding = usePreferences("onboarding");
  const router = useRouter();
  const [index, setIndex] = useState<OnboardingStepIndex>(0);
  const leaving = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  const finished = onboardingFinished(preferences.onboarding);
  useEffect(() => {
    if (ready && finished && !leaving.current) router.replace(START_PAGE);
  }, [ready, finished, router]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: focus follows the step change.
  useEffect(() => {
    if (moved.current) heading.current?.focus();
  }, [index]);
  if (!active || !ready || (finished && !leaving.current))
    return (
      <main id="main-content" className="shell-loading">
        <LoadingSkeleton label="Loading Solid Suite" />
      </main>
    );
  const finish = (state: Exclude<OnboardingState, "not-started">) => {
    leaving.current = true;
    onboarding.update(state);
  };
  const go = (by: -1 | 1) => {
    moved.current = true;
    setIndex((current) => moveStep(current, by));
  };
  const step = ONBOARDING_STEPS[index];
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span className={styles.brand}>
          <svg viewBox="0 0 40 40" width="32" height="32" aria-hidden="true">
            <polygon points="20,3 35,12 35,28 20,37 5,28 5,12" fill="currentColor" />
          </svg>
          Solid Suite
        </span>
        <Button
          variant="ghost"
          onClick={() => {
            finish("skipped");
            router.replace(START_PAGE);
          }}
        >
          Skip<span className="suite-sr-only"> setup</span>
        </Button>
      </header>
      <main id="main-content" className={styles.main}>
        <section className={styles.card} aria-labelledby="onboarding-title">
          <div className={styles.counter}>
            <span className={styles.dots} aria-hidden="true">
              {ONBOARDING_STEPS.map((item, position) => (
                <span key={item.id} data-current={position === index} />
              ))}
            </span>
            <p>{stepCounter(index)}</p>
          </div>
          <h1 id="onboarding-title" ref={heading} tabIndex={-1} className={styles.title}>
            {step.title}
          </h1>
          {index === 0 && <PodStep account={active} />}
          {index === 1 && <YoursStep account={active} profile={profileEditorFor(active)} />}
          {index === 2 && <DataStep onChoose={() => finish("complete")} />}
          <div className={styles.nav}>
            {index > 0 && (
              <Button variant="outline" onClick={() => go(-1)}>
                Back
              </Button>
            )}
            {index < 2 && <Button onClick={() => go(1)}>Next</Button>}
          </div>
        </section>
      </main>
    </div>
  );
}

function PodStep({ account }: { account: SuiteAccount }) {
  const host = storageHost(account.storageUrl);
  return (
    <>
      <figure className={styles.diagram}>
        <svg viewBox="0 0 200 120" aria-hidden="true" className={styles.hexagons}>
          <line x1="100" y1="60" x2="30" y2="25" />
          <line x1="100" y1="60" x2="170" y2="25" />
          <line x1="100" y1="60" x2="100" y2="112" />
          <polygon className={styles.satellite} points="30,12 41,18 41,32 30,38 19,32 19,18" />
          <polygon
            className={styles.satellite}
            points="170,12 181,18 181,32 170,38 159,32 159,18"
          />
          <polygon
            className={styles.satellite}
            points="100,98 111,104 111,118 100,124 89,118 89,104"
          />
          <polygon className={styles.pod} points="100,22 133,41 133,79 100,98 67,79 67,41" />
        </svg>
        <figcaption>
          <strong>{account.name}</strong>
          <span className={styles.host}>{host}</span>
        </figcaption>
      </figure>
      <ul className={styles.concepts}>
        <li>
          <HardDrive aria-hidden="true" size={20} />
          <span>
            <strong>Your data lives here.</strong> Your documents, files and tasks are saved in your
            pod, not inside each app.
          </span>
        </li>
        <li>
          <ShieldCheck aria-hidden="true" size={20} />
          <span>
            <strong>Apps ask you first.</strong> An app asks before it reads anything in your pod.
          </span>
        </li>
        <li>
          <Undo2 aria-hidden="true" size={20} />
          <span>
            <strong>You stay in charge.</strong> You can take access away from an app or a person at
            any time.
          </span>
        </li>
      </ul>
    </>
  );
}

const THEMES = [
  ["system", "System"],
  ["light", "Light"],
  ["dark", "Dark"],
] as const;

function YoursStep({ account, profile }: { account: SuiteAccount; profile: ProfileEditor }) {
  const theme = usePreferences("theme");
  const [name, setName] = useState(account.name);
  const [status, setStatus] = useState("");
  const save = async (task: Promise<void> | undefined, done: string) => {
    if (!task) return;
    setStatus("Saving…");
    try {
      await task;
      setStatus(done);
    } catch {
      setStatus("We couldn't save that. Please try again.");
    }
  };
  return (
    <>
      {profile.writable ? (
        <div className={styles.field}>
          <Label htmlFor="onboarding-name">Display name</Label>
          <Input
            id="onboarding-name"
            value={name}
            autoComplete="name"
            onChange={(event) => setName(event.target.value)}
            onBlur={() => {
              const trimmed = name.trim();
              if (trimmed && trimmed !== account.name)
                void save(profile.saveName?.(trimmed), "Name saved");
            }}
          />
          <Label htmlFor="onboarding-photo">Photo</Label>
          <input
            id="onboarding-photo"
            type="file"
            accept="image/*"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void save(profile.uploadPhoto?.(file), "Photo saved");
            }}
          />
        </div>
      ) : (
        <div className={styles.field}>
          <p className={styles.label}>Display name</p>
          <p className={styles.name}>{account.name}</p>
          <p className={styles.hint}>
            Your name comes from your account. Your provider can change it.
          </p>
        </div>
      )}
      <fieldset className={styles.fieldset}>
        <legend>Theme</legend>
        <div className="settings-choice-row">
          {THEMES.map(([value, label]) => (
            <label className="settings-theme" key={value}>
              <span className="settings-theme-preview" data-preview={value} aria-hidden="true" />
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name="onboarding-theme"
                  value={value}
                  checked={theme.value === value}
                  onChange={() => theme.update(value)}
                />
                {label}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <p role="status" className={styles.hint}>
        {status}
      </p>
    </>
  );
}

const CHOICES = [
  {
    href: "/connect",
    title: "Connect a service",
    body: "Bring in data from services you already use.",
    Icon: Plug,
  },
  {
    href: "/drive/my",
    title: "Import files",
    body: "Upload files and folders into Drive.",
    Icon: Upload,
  },
  {
    href: START_PAGE,
    title: "Start fresh",
    body: `Skip importing for now and go to ${START_PAGE_NAME}.`,
    Icon: Sparkles,
  },
] as const;

function DataStep({ onChoose }: { onChoose: () => void }) {
  return (
    <ul className={styles.choices}>
      {CHOICES.map(({ href, title, body, Icon }) => (
        <li key={title}>
          <Link href={href} className={styles.choice} onClick={onChoose}>
            <Icon aria-hidden="true" size={24} />
            <span>
              <span className={styles.choiceTitle}>{title}</span>
              <span className={styles.choiceBody}>{body}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
