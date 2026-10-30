// AUTHORED-BY Codex GPT-6.1-Sol
import { notFound } from "next/navigation";
import { FixtureCatalog } from "../fixture-catalog";
import { type FixtureName, fixtureNames } from "../fixture-names";
export default async function ComponentFixture({
  params,
}: {
  params: Promise<{ component: string }>;
}) {
  const { component } = await params;
  if (!fixtureNames.includes(component as FixtureName)) notFound();
  return <FixtureCatalog name={component as FixtureName} />;
}
