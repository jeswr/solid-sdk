// AUTHORED-BY Codex GPT-6.1-Sol
import { notFound } from "next/navigation";
import { ActivityTimeline } from "../../../apps/agent/components/activity";
import "../../../apps/agent/components/agent.css";
import { activityFixture } from "../../../apps/agent/lib/audit-fixture";
import { fixturesEnabled } from "../components/fixture-access";
export default function ActivityFixturePage() {
  if (!fixturesEnabled(process.env.NODE_ENV, process.env.NEXT_PUBLIC_DEV_FIXTURES)) notFound();
  return (
    <main className="agent-app">
      <h1>Activity performance fixture</h1>
      <ActivityTimeline entries={activityFixture().toReversed()} />
    </main>
  );
}
