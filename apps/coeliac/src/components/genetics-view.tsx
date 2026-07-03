// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
"use client";
/**
 * The Genetics view (Phase 3c §5). PRIVACY-CRITICAL. Lets a user record their
 * HLA-DQ2/DQ8 status by MANUAL entry or by an ON-DEVICE file parse, framed strictly
 * negative-predictive (NPV-only) and non-diagnostic. Rails enforced here:
 *
 *  - **The raw genetic file never leaves the device.** It is read + parsed in the
 *    browser (`useGenetics.buildFilePreview`); only the interpreted summary is ever
 *    saved. The upload UI says so plainly.
 *  - **Explicit, informed consent** before any write — an UNCHECKED-by-default
 *    checkbox; Save is disabled until it is ticked. No consent ⇒ no write.
 *  - **NPV-only framing everywhere** — DQ2/DQ8 is common and NOT a diagnosis; its
 *    ABSENCE is the informative signal; a coeliac diagnosis needs blood tests +
 *    biopsy while still eating gluten. Shown via the shared framing string.
 *  - **Owner-only, optimistic, offline** — the summary writes to the pod owner-only
 *    (ACL first, in the data layer), instantly to the cache first.
 */
import type { CoeliacGeneticRisk, MarkerPresence, RiskHaplotype } from "@jeswr/solid-health-diary";
import { RISK_HAPLOTYPES } from "@jeswr/solid-health-diary";
import { useCallback, useMemo, useState } from "react";
import { GENETIC_FRAMING } from "@/lib/genetics/interpret";
import { useSession } from "@/lib/session/context";
import {
  ConsentRequiredError,
  type GeneticPreview,
  useGenetics,
} from "@/lib/session/use-genetics";
import { MedicalDisclaimer } from "./medical-disclaimer";

/** The manual entry choice per haplotype: a presence, or "unknown" (→ no marker). */
type ManualChoice = MarkerPresence | "unknown";

const PRESENCE_LABEL: Record<MarkerPresence, string> = {
  present: "Present",
  absent: "Absent",
  uncertain: "Inconclusive",
};

const HAPLOTYPE_HINT: Record<RiskHaplotype, string> = {
  "DQ2.5": "the main coeliac-risk haplotype (~90% of coeliac patients)",
  "DQ2.2": "a secondary risk haplotype (chip coverage varies)",
  DQ7: "a secondary risk haplotype (chip coverage varies)",
  DQ8: "the other main coeliac-risk haplotype (~5–10% of patients)",
};

/** The NPV-only interpretation of the rollup — never presented as a diagnosis. */
const RISK_COPY: Record<CoeliacGeneticRisk, { tone: string; title: string; body: string }> = {
  "risk-haplotype-present": {
    tone: "info",
    title: "A coeliac-risk gene variant (DQ2/DQ8) was found",
    body:
      "This is COMMON — about a quarter to 40% of everyone carries DQ2/DQ8 — and it is NOT a " +
      "diagnosis. Most carriers never develop coeliac disease. Only a clinician can diagnose " +
      "coeliac, with blood tests and a biopsy while you are still eating gluten.",
  },
  "risk-haplotype-absent": {
    tone: "ok",
    title: "No coeliac-risk gene variant was found (across the tags your source covered)",
    body:
      "Absence of DQ2/DQ8 makes coeliac disease very unlikely — this is the one thing HLA testing " +
      "is genuinely good for. It is still NOT a diagnosis and does not completely rule coeliac out. " +
      "Discuss the result with your clinician.",
  },
  "partial-coverage": {
    tone: "warn",
    title: "Incomplete coverage — not every risk gene was tested",
    body:
      "Your source did not cover every coeliac-risk tag, so a 'not found' here is NOT reassurance. " +
      "A consumer chip may not tag every risk allele. Discuss with your clinician; a clinical HLA " +
      "test is the definitive route.",
  },
  indeterminate: {
    tone: "warn",
    title: "No clear result could be read",
    body:
      "This tells you nothing either way. If you have a clinical HLA report, use manual entry to " +
      "record its result, and discuss it with your clinician.",
  },
};

const CONSENT_TEXT =
  "I understand this stores an interpreted DQ2/DQ8 summary (never my raw genetic file) in my own " +
  "Solid pod, that only I can read it, and that it is not a diagnosis. I consent to saving it.";

function RollupBadge({ risk }: { risk: CoeliacGeneticRisk }) {
  const copy = RISK_COPY[risk];
  return (
    <div className={`genetics-rollup genetics-rollup--${copy.tone}`} role="status">
      <h3 className="genetics-rollup__title">{copy.title}</h3>
      <p className="genetics-rollup__body">{copy.body}</p>
    </div>
  );
}

function PreviewSummary({ preview }: { preview: GeneticPreview }) {
  return (
    <div className="genetics-preview" aria-label="Interpreted summary preview">
      {preview.coeliacGeneticRisk ? <RollupBadge risk={preview.coeliacGeneticRisk} /> : null}
      {preview.markers.length > 0 ? (
        <ul className="genetics-markers">
          {preview.markers.map((m) => (
            <li key={m.rsid} className="genetics-marker">
              <span className="genetics-marker__haplo">{m.riskHaplotype ?? m.rsid}</span>
              <span className={`genetics-marker__presence genetics-marker__presence--${m.markerPresence}`}>
                {m.markerPresence ? PRESENCE_LABEL[m.markerPresence] : "—"}
              </span>
              {m.genotype ? <span className="genetics-marker__geno">genotype {m.genotype}</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="genetics-preview__empty">
          No coeliac tag SNPs were found in this source. That is not a result — consider manual
          entry from a clinical report.
        </p>
      )}
      {preview.coverageComplete === false ? (
        <p className="genetics-preview__caveat">
          Not every coeliac-risk gene was covered by this source, so a &ldquo;not found&rdquo; is not
          a clean bill of health.
        </p>
      ) : null}
    </div>
  );
}

/** The explicit, unchecked-by-default consent gate + Save. */
function ConsentGate({
  onSave,
  saving,
  error,
}: {
  onSave: (consent: boolean) => void;
  saving: boolean;
  error?: string;
}) {
  const [consent, setConsent] = useState(false);
  return (
    <div className="genetics-consent">
      <label className="genetics-consent__label">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          disabled={saving}
        />
        <span>{CONSENT_TEXT}</span>
      </label>
      <button
        type="button"
        className="btn btn--primary"
        disabled={!consent || saving}
        onClick={() => onSave(consent)}
      >
        {saving ? "Saving…" : "Save summary to my pod"}
      </button>
      {error ? (
        <p className="genetics-consent__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function GeneticsView() {
  const { status } = useSession();
  const { summary, loaded, refresh, buildManualPreview, buildFilePreview, save } = useGenetics();

  const [mode, setMode] = useState<"manual" | "upload">("manual");
  const [choices, setChoices] = useState<Partial<Record<RiskHaplotype, ManualChoice>>>({});
  const [preview, setPreview] = useState<GeneticPreview | undefined>(undefined);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const manualSelections = useMemo(() => {
    const out: Partial<Record<RiskHaplotype, MarkerPresence>> = {};
    for (const [h, c] of Object.entries(choices) as [RiskHaplotype, ManualChoice][]) {
      if (c && c !== "unknown") out[h] = c;
    }
    return out;
  }, [choices]);

  const buildManual = useCallback(() => {
    setError(undefined);
    setPreview(buildManualPreview(manualSelections));
  }, [buildManualPreview, manualSelections]);

  const onFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setError(undefined);
      setPreview(undefined);
      setParsing(true);
      try {
        // Parsed ENTIRELY on-device — the raw file is never uploaded anywhere.
        setPreview(await buildFilePreview(file));
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setParsing(false);
      }
    },
    [buildFilePreview],
  );

  const onSave = useCallback(
    async (consent: boolean) => {
      if (!preview) return;
      setError(undefined);
      setSaving(true);
      try {
        const { syncing } = await save(preview, consent);
        // Optimistic: the cache already has it; reflect immediately, then await sync.
        setPreview(undefined);
        setChoices({});
        await refresh();
        void syncing.catch(() => {
          /* a failed pod flush is retried by the outbox; the cache keeps the record */
        });
      } catch (err) {
        setError(
          err instanceof ConsentRequiredError
            ? "Please tick the consent box to save."
            : (err as Error).message,
        );
      } finally {
        setSaving(false);
      }
    },
    [preview, save, refresh],
  );

  if (status !== "authed") {
    return (
      <div className="knowledge genetics">
        <h1>Genetics</h1>
        <MedicalDisclaimer>{GENETIC_FRAMING}</MedicalDisclaimer>
        <p className="genetics__signin">Sign in to record or view your HLA-DQ2/DQ8 summary.</p>
      </div>
    );
  }

  return (
    <div className="knowledge genetics">
      <h1>Genetics — HLA-DQ2/DQ8</h1>
      <MedicalDisclaimer>{GENETIC_FRAMING}</MedicalDisclaimer>

      {loaded && summary ? (
        <section className="genetics-current" aria-label="Your recorded HLA status">
          <h2>Your recorded summary</h2>
          {summary.coeliacGeneticRisk ? <RollupBadge risk={summary.coeliacGeneticRisk} /> : null}
          <ul className="genetics-markers">
            {summary.markers.map((m) => (
              <li key={m.rsid} className="genetics-marker">
                <span className="genetics-marker__haplo">{m.riskHaplotype ?? m.rsid}</span>
                <span
                  className={`genetics-marker__presence genetics-marker__presence--${m.markerPresence}`}
                >
                  {m.markerPresence ? PRESENCE_LABEL[m.markerPresence] : "—"}
                </span>
              </li>
            ))}
          </ul>
          <p className="genetics-current__meta">
            Source: {summary.sourceType ?? "unknown"}
            {summary.sync === "pending" ? " · Saving…" : summary.sync === "error" ? " · Not yet saved (will retry)" : " · Saved to your pod"}
          </p>
          <p className="genetics-current__framing">{summary.interpretation}</p>
        </section>
      ) : null}

      <section className="genetics-entry" aria-label="Record your HLA status">
        <h2>{summary ? "Update your summary" : "Record your HLA status"}</h2>
        <div className="genetics-modes" role="tablist" aria-label="Entry method">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "manual"}
            className={`genetics-mode ${mode === "manual" ? "is-active" : ""}`}
            onClick={() => {
              setMode("manual");
              setPreview(undefined);
              setError(undefined);
            }}
          >
            Enter manually
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "upload"}
            className={`genetics-mode ${mode === "upload" ? "is-active" : ""}`}
            onClick={() => {
              setMode("upload");
              setPreview(undefined);
              setError(undefined);
            }}
          >
            Upload a test file
          </button>
        </div>

        {mode === "manual" ? (
          <div className="genetics-manual">
            <p className="genetics-manual__intro">
              Record what a clinical HLA report or a consumer test told you, per haplotype. Leave a
              row on &ldquo;Unknown&rdquo; if you are not sure — an unknown is never treated as
              &ldquo;absent&rdquo;.
            </p>
            {RISK_HAPLOTYPES.map((h) => (
              <fieldset key={h} className="genetics-haplo">
                <legend className="genetics-haplo__legend">
                  {h} <span className="genetics-haplo__hint">— {HAPLOTYPE_HINT[h]}</span>
                </legend>
                {(["present", "absent", "uncertain", "unknown"] as ManualChoice[]).map((c) => (
                  <label key={c} className="genetics-haplo__opt">
                    <input
                      type="radio"
                      name={`haplo-${h}`}
                      checked={(choices[h] ?? "unknown") === c}
                      onChange={() => setChoices((prev) => ({ ...prev, [h]: c }))}
                    />
                    <span>{c === "unknown" ? "Unknown" : PRESENCE_LABEL[c as MarkerPresence]}</span>
                  </label>
                ))}
              </fieldset>
            ))}
            <button type="button" className="btn" onClick={buildManual}>
              Preview summary
            </button>
          </div>
        ) : (
          <div className="genetics-upload">
            <p className="genetics-upload__privacy">
              <strong>Your raw file never leaves this device.</strong> It is read and interpreted
              here in your browser; only the DQ2/DQ8 summary is saved to your pod. Accepts a 23andMe
              or AncestryDNA raw data file, or a text HLA report.
            </p>
            <input
              type="file"
              accept=".txt,.csv,.tsv,text/plain"
              aria-label="Genetic test file (parsed on this device only)"
              onChange={(e) => void onFile(e.target.files?.[0])}
              disabled={parsing || saving}
            />
            {parsing ? <p className="genetics-upload__parsing">Reading on your device…</p> : null}
          </div>
        )}

        {preview ? (
          <div className="genetics-review">
            <h3>This is what will be saved</h3>
            <PreviewSummary preview={preview} />
            <ConsentGate onSave={onSave} saving={saving} error={error} />
          </div>
        ) : error ? (
          <p className="genetics-consent__error" role="alert">
            {error}
          </p>
        ) : null}
      </section>
    </div>
  );
}
