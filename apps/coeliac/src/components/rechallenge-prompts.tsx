// AUTHORED-BY Claude Fable 5
"use client";
/**
 * Home-screen re-challenge prompts (DESIGN §4.3, Brief 4B item 3). When a time-boxed
 * secondary-intolerance exclusion reaches its `reviewAfter` date, surface a gentle,
 * expansion-positive nudge on the home screen so the user can shrink their avoid-list
 * as the gut heals — the app's job is to GROW the safe-food set where evidence allows.
 *
 * SAFETY RAIL: this reuses {@link useDietPlan}'s `reviews`, which come from the pure
 * {@link surfaceReviews} — gluten/coeliac is a LIFELONG exclusion and is NEVER
 * surfaced for re-challenge (it is not in `TIME_BOXED_TRIGGERS`; the engine fails
 * closed on the trigger set). The UI trusts that guard but adds nothing that could
 * bypass it. Renders nothing until loaded and nothing when no review is due.
 */
import Link from "next/link";
import { triggerLabel } from "@/lib/off/exposure-display";
import { useDietPlan } from "@/lib/session/use-diet-plan";

export function ReChallengePrompts() {
  const { reviews, loaded } = useDietPlan();
  if (!loaded || reviews.length === 0) return null;
  return (
    <section className="rechallenge" aria-label="Ready to re-test">
      <h2 className="rechallenge__title">Ready to re-test</h2>
      <p className="rechallenge__lead">
        Some foods you cut out may be worth trying again — sensitivities often ease as your gut
        heals, so your list of foods to avoid could shrink.
      </p>
      <ul className="rechallenge__list">
        {reviews.map((r) => (
          <li key={`${r.trigger}-${r.conclusionId ?? ""}`} className="rechallenge__item">
            <span className="rechallenge__trigger">{triggerLabel(r.trigger)}</span>
            <span className="rechallenge__msg">{r.message}</span>
          </li>
        ))}
      </ul>
      <p className="rechallenge__cta">
        <Link href="/protocols">Start a re-challenge</Link> when you&apos;re ready, or see your{" "}
        <Link href="/plan">diet plan</Link>. Talk to your clinician first if you&apos;re unsure.
      </p>
    </section>
  );
}
