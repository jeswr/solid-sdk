// AUTHORED-BY Codex GPT-6
import type { MigrationPlan, OptionId, ReportKind, Resolutions } from "../App.js";

const kindLabels: Record<ReportKind, string> = {
  "group-unsupported": "Groups that need a choice",
  "origin-unsupported": "Website restrictions",
  "condition-unsupported": "Sign-in conditions",
  "exclusion-unsupported": "Excluded people",
  "deny-unsupported": "Rules that block access",
  "owner-mapped": "Owner permissions",
  "source-owner-kept": "Source account permissions",
  "inheritance-narrowed": "Folder permission differences",
  "acl-unreadable": "Unreadable permissions",
  "acl-system-unknown": "Unrecognized permission system",
  "target-exists": "Files already at the destination",
  "protected-target": "Protected destination settings",
  "metadata-skipped": "Server descriptions left behind",
  "too-complex": "Rules too complex to translate",
};

export function PlanReport({
  plan,
  resolutions,
  onChange,
}: {
  plan: MigrationPlan;
  resolutions: Resolutions;
  onChange: (values: Resolutions) => void;
}) {
  const kinds = [...new Set(plan.report.map((item) => item.kind))];
  return (
    <div className="report-groups">
      {kinds.map((kind) => {
        const items = plan.report.filter((item) => item.kind === kind);
        return (
          <section key={kind} aria-label={kindLabels[kind]} className="report-group">
            <div className="group-heading">
              <h3>{kindLabels[kind]}</h3>
              <span className="badge">{items.length}</span>
            </div>
            {items.map((item) => (
              <article className="report-item" key={item.id}>
                <details>
                  <summary>
                    <span>{item.title}</span>
                    <span
                      className={`badge ${item.severity === "needs-decision" ? "attention" : ""}`}
                    >
                      {item.severity === "needs-decision"
                        ? "Your choice needed"
                        : "For your information"}
                    </span>
                  </summary>
                  <p className="resource-url">{item.resourceUrl}</p>
                  <p>{item.explanation}</p>
                  {item.sourceRuleTurtle && (
                    <details className="source-rule">
                      <summary>
                        View original permission rule{" "}
                        <span className="muted">(Turtle: a text format for linked data)</span>
                      </summary>
                      <pre>{item.sourceRuleTurtle}</pre>
                    </details>
                  )}
                </details>
                <fieldset className="report-options">
                  <legend>Choose how to handle: {item.title}</legend>
                  {item.options.map((option) => (
                    <label className="radio-option" key={option.id}>
                      <input
                        type="radio"
                        name={`resolution-${item.id}`}
                        value={option.id}
                        checked={resolutions[item.id] === option.id}
                        onChange={() => onChange({ ...resolutions, [item.id]: option.id })}
                      />
                      <span>
                        <strong>{option.label}</strong>
                        {option.id === item.recommended && (
                          <span className="recommended">Suggested</span>
                        )}
                        <small>{option.description}</small>
                      </span>
                    </label>
                  ))}
                </fieldset>
                {items.length > 1 && (
                  <button
                    type="button"
                    className="text-button"
                    disabled={!resolutions[item.id]}
                    onClick={() => {
                      const choice = resolutions[item.id] as OptionId;
                      const next = { ...resolutions };
                      for (const sibling of items) {
                        if (sibling.options.some((option) => option.id === choice))
                          next[sibling.id] = choice;
                      }
                      onChange(next);
                    }}
                  >
                    Apply to all of this kind
                  </button>
                )}
              </article>
            ))}
          </section>
        );
      })}
    </div>
  );
}
