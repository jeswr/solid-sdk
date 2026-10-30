// AUTHORED-BY Codex GPT-6.1-Sol
import { formatBytes, SurfaceFeedback, type SurfaceState } from "./content.js";

export function PodMeter({
  used,
  quota,
  locale = "en",
  state,
}: {
  used?: number;
  quota?: number;
  locale?: string;
  state?: SurfaceState;
}) {
  const ready = (!state || state.status === "ready") && used !== undefined;
  const validQuota = quota !== undefined && Number.isFinite(quota) && quota > 0;
  const amount = used !== undefined && Number.isFinite(used) ? Math.max(0, used) : 0;
  const copy = `${formatBytes(amount, locale)}${validQuota ? ` of ${formatBytes(quota, locale)} used` : " used (no limit reported)"}`;
  return (
    <section className="suite-pod-meter" aria-label="Storage">
      <h3>Storage</h3>
      {ready ? (
        <>
          {validQuota ? (
            <meter
              className="suite-usage-bar"
              aria-label="Storage used"
              min={0}
              max={quota}
              value={Math.min(amount, quota)}
              aria-valuetext={copy}
            />
          ) : (
            <div className="suite-usage-bar" aria-hidden="true" />
          )}
          <p role="status" className="suite-muted">
            {copy}
          </p>
        </>
      ) : (
        <>
          <SurfaceFeedback
            state={state ?? { status: "empty" }}
            empty="No storage usage yet"
            action="Calculate usage"
          />
          {state?.status === "loading" && <p className="suite-muted">Calculating…</p>}
        </>
      )}
    </section>
  );
}
