// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Badge } from "@jeswr/suite-ui";
import Link from "next/link";
import { isLoaded } from "../lib/client";
import { useAgentQuery, useAgentWorkspace } from "../lib/hooks";
import { resourceSlug } from "../lib/paths";
import { loadedRecords, readAccounts, readDescriptors } from "../lib/readers";
import { DetailScreen, QueryRows, Screen } from "./states";

const LABELS = {
  none: "Not set up",
  "setup-required": "Setup required",
  connected: "Connected",
  error: "Error",
  disabled: "Disabled",
};
export function AccountsScreen({ id }: { id?: string }) {
  const { client } = useAgentWorkspace();
  const query = useAgentQuery(client.paths.accounts, readAccounts);
  const descriptors = useAgentQuery(client.paths.descriptors, readDescriptors);
  const selected =
    query.status === "ready" && id
      ? {
          ...query,
          data: query.data.filter((row) => !isLoaded(row) || resourceSlug(row.record.id) === id),
        }
      : query;
  const content = (
    <QueryRows query={selected} empty="No connected accounts yet">
      {(rows) =>
        [...new Set(rows.map((row) => row.channel))].map((channel) => (
          <section key={channel}>
            <h2>{channel === "email" ? "Email" : channel === "matrix" ? "Matrix" : channel}</h2>
            <div className="agent-grid">
              {rows
                .filter((row) => row.channel === channel && (!id || resourceSlug(row.id) === id))
                .map((row) => {
                  const descriptor =
                    descriptors.status === "ready"
                      ? loadedRecords(descriptors.data).find((d) => d.binding === row.provider)
                      : undefined;
                  return (
                    <article className="agent-card" key={row.id}>
                      <h3>{row.label ?? row.provider}</h3>
                      <p>
                        {row.provider} · {row.organisation}
                      </p>
                      <Badge variant="secondary">{LABELS[row.bindingState]}</Badge>
                      {row.inventory?.identityConflicts.length ? (
                        <p role="alert" className="agent-banner">
                          Two different handles recorded — pick one
                        </p>
                      ) : null}
                      <dl className="agent-restrictions">
                        {Object.entries(row.restrictions).map(([name, enabled]) => (
                          <div key={name}>
                            <dt>
                              {name[0]?.toUpperCase()}
                              {name.slice(1)}
                            </dt>
                            <dd>{enabled ? "On" : "Off"}</dd>
                          </div>
                        ))}
                      </dl>
                      {descriptor?.lastIngest && (
                        <p>Last read: {new Date(descriptor.lastIngest).toLocaleString()}</p>
                      )}
                      {id ? (
                        <>
                          <h3>Capabilities</h3>
                          <QueryRows query={descriptors} empty="No capabilities recorded">
                            {(all) => {
                              const capability = all.find((d) => d.binding === row.provider);
                              return capability ? (
                                <dl>
                                  <dt>Can carry structured data</dt>
                                  <dd>{capability.structuredPayload ? "Yes" : "No"}</dd>
                                  <dt>End-to-end encrypted</dt>
                                  <dd>{capability.endToEndEncrypted ? "Yes" : "No"}</dd>
                                  <dt>Delivery receipts</dt>
                                  <dd>{capability.deliveryReceipts ? "Yes" : "No"}</dd>
                                  <dt>History available</dt>
                                  <dd>{capability.historyWindow}</dd>
                                  <dt>Daily message limit</dt>
                                  <dd>{capability.rateLimit.perDay}</dd>
                                </dl>
                              ) : (
                                <p>No capabilities recorded for this account.</p>
                              );
                            }}
                          </QueryRows>
                          <details>
                            <summary>Technical details</summary>
                            <p>Account ID: {row.id}</p>
                            <p>Account hash: {row.channelHandleHash}</p>
                          </details>
                        </>
                      ) : (
                        <Link
                          href={`/agent/accounts/${encodeURIComponent(resourceSlug(row.id) ?? "")}`}
                        >
                          View {row.label ?? row.provider}
                        </Link>
                      )}
                    </article>
                  );
                })}
            </div>
          </section>
        ))
      }
    </QueryRows>
  );
  return id ? (
    <DetailScreen title="Account details" back="/agent/accounts">
      {content}
    </DetailScreen>
  ) : (
    <Screen title="Accounts">{content}</Screen>
  );
}
