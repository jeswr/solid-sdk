// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import { ManualMeal } from "@/components/manual-meal";
import { ScanLog } from "@/components/scan-log";

export default function LogPage() {
  return (
    <div className="log-page">
      <h1>Log food</h1>
      <ScanLog />
      <details className="log-page__manual">
        <summary>Log a meal by hand instead</summary>
        <ManualMeal />
      </details>
    </div>
  );
}
