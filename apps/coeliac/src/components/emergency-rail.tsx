// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The EMERGENCY RAIL (DESIGN §4.4, RESEARCH §4). When a breathing-difficulty /
 * anaphylaxis symptom is selected, the app short-circuits straight to emergency
 * guidance — it NEVER says "we'll correlate it" and never frames a
 * potentially-fatal reaction as a data point. These are hard-coded rules, not
 * inferences; they can never be "correlated away".
 */
export function EmergencyRail() {
  return (
    <aside className="emergency" role="alert" aria-label="Medical emergency guidance">
      <h2 className="emergency__title">This can be a medical emergency</h2>
      <p>
        Trouble breathing, wheezing, swelling of the lips, tongue or throat, or feeling faint
        after eating can be <strong>anaphylaxis</strong> — a life-threatening reaction.
      </p>
      <ul className="emergency__actions">
        <li>
          Use your <strong>adrenaline auto-injector</strong> (EpiPen / Jext) now if you have one.
        </li>
        <li>
          Call emergency services immediately —{" "}
          <a href="tel:999">999</a> (UK), <a href="tel:112">112</a> (EU),{" "}
          <a href="tel:911">911</a> (US).
        </li>
        <li>Lie down and raise your legs; do not stand up suddenly.</li>
      </ul>
      <p className="emergency__note">
        This app cannot help in an emergency and will not analyse or &ldquo;correlate&rdquo; this
        — get medical help right now.
      </p>
    </aside>
  );
}
