// AUTHORED-BY Codex GPT-6.1-Sol
import { StateFixtures } from "../state-fixtures";
import { DetailsFixtures } from "./fixtures";
export default function ItemDetailsPage() {
  return (
    <main id="main-content" tabIndex={-1} className="fixture-page">
      <p className="eyebrow">Solid Suite · Design system</p>
      <h1>Item details</h1>
      <DetailsFixtures />
      <StateFixtures kind="item-details" data={{ types: [], properties: [] }} />
    </main>
  );
}
