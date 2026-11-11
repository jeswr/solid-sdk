// AUTHORED-BY Codex GPT-6
"use client";

import { Button, EmptyState, ErrorState, LoadingSkeleton, toast } from "@jeswr/suite-ui";
import { Globe, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { AppHeading } from "@/shell/app-frame";
import type { ClientMetadata } from "../../lib/permissions";
import { agentId, agentName, permissionDate, sameAgent } from "../../lib/permissions/view";
import { usePermissions } from "../../state/permissions";
import { useHomeSession } from "../home-app";
import { PermissionAccessRow } from "./permission-access";
import {
  PermissionNotices,
  PermissionViewToggle,
  usePermissionPreferences,
} from "./permissions-page";

export function ClientCard({ metadata }: { metadata: ClientMetadata }) {
  const [showLogo, setShowLogo] = useState(false);
  return (
    <section className="hm-permission-about" aria-labelledby="client-about">
      <h2 id="client-about">What this app says about itself</h2>
      {metadata.name && <p>{metadata.name}</p>}
      <div className="hm-permission-links">
        {metadata.uri && (
          <a href={metadata.uri} rel="noopener noreferrer" target="_blank">
            App website
          </a>
        )}
        {metadata.policyUri && (
          <a href={metadata.policyUri} rel="noopener noreferrer" target="_blank">
            Privacy policy
          </a>
        )}
        {metadata.tosUri && (
          <a href={metadata.tosUri} rel="noopener noreferrer" target="_blank">
            Terms of service
          </a>
        )}
      </div>
      {metadata.logoUri &&
        (showLogo ? (
          // biome-ignore lint/performance/noImgElement: A consented remote logo must load directly with no referrer, as specified.
          <img
            className="hm-permission-logo"
            src={metadata.logoUri}
            referrerPolicy="no-referrer"
            alt={`${metadata.name || "App"} logo`}
            width={56}
            height={56}
          />
        ) : (
          <Button variant="outline" onClick={() => setShowLogo(true)}>
            Show logo
          </Button>
        ))}
      {!metadata.name &&
        !metadata.uri &&
        !metadata.policyUri &&
        !metadata.tosUri &&
        !metadata.logoUri && (
          <p className="hm-permission-muted">This app hasn't provided any details.</p>
        )}
    </section>
  );
}

export function PermissionAgentPage({ agentRef }: { agentRef: string }) {
  const binding = usePermissions();
  const session = useHomeSession();
  const preferences = usePermissionPreferences();
  const id = agentId(agentRef);
  const row = binding.rows.find((r) => sameAgent(r.id, id));
  const name = row ? agentName(row) : "Permissions";
  const pseudo = row?.kind === "public" || row?.kind === "authenticated";
  return (
    <div className="hm-page hm-permissions-page hm-permission-detail">
      <Link className="hm-permission-back" href="/permissions">
        All permissions
      </Link>
      {binding.status === "loading" ? (
        <>
          <AppHeading>Permissions</AppHeading>
          <LoadingSkeleton preset="detail" label="Loading permissions" />
        </>
      ) : binding.status === "error" ? (
        <>
          <AppHeading>Permissions</AppHeading>
          <ErrorState error="unreachable" actions={{ retry: () => void binding.refresh() }} />
        </>
      ) : !row ? (
        <>
          <AppHeading>Permissions</AppHeading>
          <EmptyState
            title="No access found for this account"
            body=""
            primaryAction={<Link href="/permissions">Back to permissions</Link>}
          />
        </>
      ) : (
        <>
          <header className="hm-permission-profile">
            <span className="hm-permission-avatar" aria-hidden="true">
              {row.kind === "public" ? (
                <Globe />
              ) : row.kind === "authenticated" ? (
                <Users />
              ) : (
                name.slice(0, 1).toUpperCase()
              )}
            </span>
            <div className="hm-permission-profile-text">
              <AppHeading>{name}</AppHeading>
              {!pseudo && (
                <div className="hm-permission-id">
                  <span>{row.kind === "app" ? "Client ID" : "Account ID"}</span>
                  <code>{row.id}</code>
                  <Button
                    variant="outline"
                    aria-label={`Copy ${row.kind === "app" ? "Client ID" : "Account ID"}`}
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(row.id);
                        toast.success("Copied");
                      } catch {
                        toast.error("Couldn't copy the ID");
                      }
                    }}
                  >
                    Copy
                  </Button>
                </div>
              )}
              <p className="hm-permission-muted">First shared {permissionDate(row.since)}</p>
              <p className="hm-permission-muted">Last changed {permissionDate(row.lastChanged)}</p>
            </div>
          </header>
          <PermissionNotices binding={binding} />
          <PermissionViewToggle view={preferences.view} onChange={preferences.changeView} />
          <PermissionAccessRow
            key={row.key}
            row={row}
            binding={binding}
            storage={session.storageUrl}
            view={preferences.view}
            technical={preferences.technical}
            alwaysExpanded
          />
          {row.kind === "app" && (
            <ClientCard key={row.id} metadata={binding.clients[row.id] || {}} />
          )}
        </>
      )}
    </div>
  );
}
