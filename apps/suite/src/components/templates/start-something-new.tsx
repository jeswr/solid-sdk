// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { BUILTIN_TEMPLATES, TEMPLATE_APPS } from "@jeswr/suite-templates";
import { Button, toast } from "@jeswr/suite-ui";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { PodSession } from "@/lib/session/pod-session";
import { createFromTemplate } from "@/lib/templates/create";
import { TemplateLauncher } from "./template-picker";
export function StartSomethingNew({ session }: { session: PodSession }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const currentSession = useRef(session);
  currentSession.current = session;
  return (
    <section className="su-template-start" aria-labelledby="start-something-new">
      <h2 id="start-something-new">Start something new</h2>
      <div className="su-template-filters">
        {TEMPLATE_APPS.map((app) => {
          const template = BUILTIN_TEMPLATES.find((item) => item.app === app);
          if (!template) return null;
          return (
            <Button
              key={app}
              variant="outline"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void createFromTemplate(session, template)
                  .then((href) => {
                    if (currentSession.current === session) router.push(href);
                  })
                  .catch(() => toast.error("Couldn't create from this template. Please try again."))
                  .finally(() => setBusy(false));
              }}
            >
              {app[0]?.toUpperCase()}
              {app.slice(1)}: {template.name}
            </Button>
          );
        })}
        <TemplateLauncher session={session} label="More templates" />
      </div>
    </section>
  );
}
