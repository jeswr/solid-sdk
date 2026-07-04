// AUTHORED-BY Claude Sonnet 5
/**
 * A compact lift/confidence VISUALISATION for a suspicion (DESIGN §4.1,
 * suite-tracker-ov8g deliverable 3) — a small meter rather than a raw number
 * dump, but the underlying counts stay visible alongside it (the engine's
 * "every field transparent, nothing a hidden coefficient" rule — DESIGN §4.1 —
 * applies to how a surface renders it too). `lift` is explicitly NOT a
 * probability; the caption always says so.
 */
import type { SuspicionScore } from "@/lib/inference/types";

/** Visual fill cap: a lift far past this (e.g. 20×) still reads as a "full" meter. */
const LIFT_VISUAL_CAP = 5;

export function LiftMeter({ suspicion }: { suspicion: SuspicionScore }) {
  const { lift, followedRate, confidence } = suspicion;
  const clamped = lift === undefined ? 0 : Math.min(Math.max(lift, 0), LIFT_VISUAL_CAP);
  const fillPct = (clamped / LIFT_VISUAL_CAP) * 100;
  return (
    <div className="lift-meter">
      <div className="lift-meter__row">
        <span className="lift-meter__label">Enrichment over chance</span>
        <span className="lift-meter__value">
          {lift === undefined ? "Not enough data yet" : `${lift.toFixed(1)}×`}
        </span>
      </div>
      <div
        className="lift-meter__track"
        role="meter"
        aria-label="Lift — enrichment over chance"
        aria-valuemin={0}
        aria-valuemax={LIFT_VISUAL_CAP}
        aria-valuenow={clamped}
        aria-valuetext={
          lift === undefined
            ? "not enough data to estimate"
            : `${lift.toFixed(1)} times more often than chance would predict`
        }
      >
        <div
          className={`lift-meter__fill lift-meter__fill--${confidence}`}
          style={{ width: `${fillPct}%` }}
        />
      </div>
      <p className="lift-meter__note">
        Not a probability — how much more often symptoms followed this exposure than
        coincidence alone would predict, shown with the underlying count (
        {Math.round(followedRate * 100)}% of exposures followed).
      </p>
    </div>
  );
}
