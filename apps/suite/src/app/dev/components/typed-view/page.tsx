// AUTHORED-BY Codex GPT-6.1-Sol
import { typedFixtureData } from "../../../../components/typed-view-fixtures";
import { StateFixtures } from "../state-fixtures";
import { TypedFixtures } from "./fixtures";
export default async function TypedViewPage() {
  const fixtures = await typedFixtureData();
  return (
    <main id="main-content" tabIndex={-1} className="fixture-page">
      <p className="eyebrow">Solid Suite · Design system</p>
      <h1>Typed views</h1>
      <p>Familiar content from your pod.</p>
      <TypedFixtures fixtures={fixtures} />
      <StateFixtures kind="typed-view" data={fixtures[0]?.data ?? { types: [], properties: [] }} />
    </main>
  );
}
