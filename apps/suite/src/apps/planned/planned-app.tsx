// AUTHORED-BY Claude Opus 5.5
"use client";
import { APP_ICONS, type AppSlug, EmptyState } from "@jeswr/suite-ui";
import { AppFrame, AppHeading, AppSessionGuard } from "@/shell/app-frame";
import { descriptions } from "@/welcome/apps";

/**
 * Placeholder for a registered app whose first cut has not landed yet. Each app's own PR
 * replaces its route files, so the rail, launcher and welcome page never link to a 404.
 */
export function PlannedApp({ app }: { app: AppSlug }) {
  const { label, icon: Icon } = APP_ICONS[app];
  return (
    <AppSessionGuard>
      <AppFrame app={app} sidebar={null}>
        <AppHeading className="suite-sr-only">{label}</AppHeading>
        <EmptyState
          title={`${label} is on its way`}
          body={descriptions[app]}
          icon={<Icon aria-hidden="true" size={32} strokeWidth={1.5} />}
        />
      </AppFrame>
    </AppSessionGuard>
  );
}
