// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { FixtureRouteView } from "../fixture-route-view";
export const dynamicParams = true;
export function generateStaticParams() {
  return process.env.NEXT_PUBLIC_SUITE_TARGET === "native" ? [{ component: "__" }] : [];
}
export default function ComponentFixture() {
  return <FixtureRouteView />;
}
