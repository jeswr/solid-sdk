// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { TypedView, type TypedViewData } from "@jeswr/suite-ui";
import { useState } from "react";

export function TypedFixtures({
  fixtures,
}: {
  fixtures: { id: string; label: string; data: TypedViewData }[];
}) {
  const [advanced, setAdvanced] = useState(false);
  return (
    <>
      <fieldset className="foundation-card">
        <legend>Settings › Advanced</legend>
        <label className="ds12-setting">
          <input
            type="checkbox"
            checked={advanced}
            onChange={(event) => setAdvanced(event.target.checked)}
          />
          Show technical details
        </label>
      </fieldset>
      <div className="ds12-grid">
        {fixtures.map(({ id, label, data }) => (
          <section className="ds12-example" data-fixture-type={id} key={id}>
            <h2>{label}</h2>
            <TypedView data={data} showTechnicalDetails={advanced} />
          </section>
        ))}
      </div>
    </>
  );
}
