// AUTHORED-BY Codex GPT-6.1-Sol
import { StateFixtures } from "../state-fixtures";
import { DetailsFixtures } from "./fixtures";
export default function DetailsPanePage() {
  return (
    <main id="main-content" tabIndex={-1} className="fixture-page">
      <p className="eyebrow">Solid Suite · Design system</p>
      <h1>Details pane</h1>
      <DetailsFixtures />
      <StateFixtures kind="details-pane" data={{ types: [], properties: [] }} />
    </main>
  );
}
