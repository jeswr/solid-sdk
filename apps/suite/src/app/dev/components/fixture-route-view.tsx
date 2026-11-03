// AUTHORED-BY Codex GPT-6
"use client";
import { notFound } from "next/navigation";
import { useRouteParams } from "@/lib/route-params";
import { FixtureCatalog } from "./fixture-catalog";
import { type FixtureName, fixtureNames } from "./fixture-names";

export function FixtureRouteView() {
  const params = useRouteParams<{ component: string }>("/dev/components/[component]");
  if (!params) return <div role="status">Loading…</div>;
  if (!fixtureNames.includes(params.component as FixtureName)) notFound();
  return <FixtureCatalog name={params.component as FixtureName} />;
}
