// AUTHORED-BY Codex GPT-6.1-Sol
import { serializeTemplate } from "@jeswr/suite-templates";
import { buildDocument } from "../../apps/docs/lib/model/document";
import { serializeTurtle } from "../../apps/docs/lib/model/rdf-io";
import { DEMO_ROOT, DEMO_WEBID } from "./constants";
import type { DemoSeedFile } from "./pod";
export async function seedTemplates(now: number): Promise<DemoSeedFile[]> {
  const content = new URL("templates/team-standup.content", DEMO_ROOT).href;
  const metadata = new URL("templates/team-standup.template.ttl", DEMO_ROOT).href;
  return [
    {
      path: "templates/team-standup.content",
      body: await serializeTurtle(
        buildDocument(content, {
          title: "Team standup",
          body: "<h1>Team standup</h1><h2>Yesterday</h2><p>What did we finish?</p><h2>Today</h2><p>What comes next?</p><h2>Blockers</h2><p>Where do we need help?</p>",
          creator: DEMO_WEBID,
          now: new Date(now),
        }),
      ),
      contentType: "text/turtle",
      modified: now,
    },
    {
      path: "templates/team-standup.template.ttl",
      body: await serializeTemplate(metadata, {
        name: "Team standup",
        description: "Your team's daily check-in",
        app: "docs",
        category: "Work",
        previewText: "Yesterday · Today · Blockers",
        content,
        created: new Date(now),
        modified: new Date(now),
        author: DEMO_WEBID,
      }),
      contentType: "text/turtle",
      modified: now,
    },
  ];
}
