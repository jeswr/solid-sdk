// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import Link from "next/link";
import { useAgentQuery, useAgentWorkspace } from "../lib/hooks";
import { readMandateCurrent, readMandates } from "../lib/readers";
import { QueryRows, Screen } from "./states";
export function PermissionsScreen({ history = false }: { history?: boolean }) {
  const { client } = useAgentWorkspace();
  const query = useAgentQuery(client.paths.mandates, history ? readMandates : readMandateCurrent);
  return (
    <Screen title={history ? "Permission history" : "Permissions"}>
      <Link href={history ? "/agent/permissions" : "/agent/permissions/history"}>
        {history ? "Current permission" : "View permission history"}
      </Link>
      <QueryRows query={query} empty="No permissions set up yet">
        {(rows) =>
          rows.map((row) => (
            <article className="agent-card" key={row.id}>
              <h2>{history ? "Previous permission record" : "Current permission"}</h2>
              <p>Valid from {new Date(row.validFrom).toLocaleDateString()}</p>
              <p>Valid until {new Date(row.validUntil).toLocaleDateString()}</p>
              <p>
                This is a reference to the agent's permission record. Its signature has not been
                checked on this device.
              </p>
              <details>
                <summary>Technical details</summary>
                <dl>
                  <dt>Credential reference</dt>
                  <dd>{row.credential}</dd>
                  <dt>Digest</dt>
                  <dd>{row.digest}</dd>
                  <dt>Status reference</dt>
                  <dd>{row.credentialStatus ?? "Not recorded"}</dd>
                </dl>
              </details>
            </article>
          ))
        }
      </QueryRows>
    </Screen>
  );
}
