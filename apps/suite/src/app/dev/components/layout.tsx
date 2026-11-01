// AUTHORED-BY Codex GPT-6.1-Sol
import "@jeswr/suite-ui/styles/sync.css";
import { notFound } from "next/navigation";
import { fixturesEnabled } from "./fixture-access";
export default function FixtureLayout({ children }: { children: React.ReactNode }) {
  if (!fixturesEnabled(process.env.NODE_ENV, process.env.NEXT_PUBLIC_DEV_FIXTURES)) notFound();
  return <>{children}</>;
}
