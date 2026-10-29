// AUTHORED-BY Codex GPT-6.1-Sol
import { PodMeter } from "@jeswr/suite-ui";
import { StateFixtures } from "../state-fixtures";
export default function PodMeterPage() {
  return (
    <main id="main-content" tabIndex={-1} className="fixture-page">
      <p className="eyebrow">Solid Suite · Design system</p>
      <h1>Pod meter</h1>
      <div className="ds12-grid">
        <section className="ds12-example">
          <h2>With a limit</h2>
          <PodMeter used={3100000000} quota={10000000000} />
        </section>
        <section className="ds12-example">
          <h2>No limit reported</h2>
          <PodMeter used={3100000000} />
        </section>
        <section className="ds12-example">
          <h2>Empty pod</h2>
          <PodMeter used={0} quota={10000000000} />
        </section>
        <section className="ds12-example">
          <h2>At capacity</h2>
          <PodMeter used={10000000000} quota={10000000000} />
        </section>
        <section className="ds12-example">
          <h2>Over capacity</h2>
          <PodMeter used={12000000000} quota={10000000000} />
        </section>
      </div>
      <StateFixtures kind="pod-meter" data={{ types: [], properties: [] }} />
    </main>
  );
}
