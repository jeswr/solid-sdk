// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { PodMeter } from "@jeswr/suite-ui";
import { useCapabilities } from "@jeswr/suite-ui/sync";
import { useEffect, useState } from "react";
import { getDemoPod } from "../../lib/demo-pod/browser";
import { capabilityRows } from "../lib/settings-capabilities";
import { useAccounts } from "../session/accounts-provider";

export function StorageSettings() {
  const caps = useCapabilities();
  const { active } = useAccounts();
  const [usage, setUsage] = useState<{ id: string; used: number } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    if (active?.kind === "demo")
      void getDemoPod()
        .then((pod) => {
          const used = pod
            .snapshot()
            .resources.reduce((total, [, resource]) => total + resource.body.byteLength, 0);
          if (!cancelled) setUsage({ id: active.id, used });
        })
        .catch(() => {
          if (!cancelled) setFailed(true);
        });
    return () => {
      cancelled = true;
    };
  }, [active?.id, active?.kind]);
  return (
    <>
      <section aria-label="Storage usage">
        <h2>Storage usage</h2>
        {usage && usage.id === active?.id ? (
          <PodMeter used={usage.used} />
        ) : (
          <PodMeter state={{ status: active?.kind === "demo" && !failed ? "loading" : "empty" }} />
        )}
        <p>Your storage has not reported a size limit.</p>
      </section>
      <section aria-label="Storage capabilities">
        <table className="settings-table">
          <caption>What your storage supports</caption>
          <thead>
            <tr>
              <th scope="col">Feature</th>
              <th scope="col">Available</th>
            </tr>
          </thead>
          <tbody>
            {capabilityRows(caps).map((row) => (
              <tr key={row.key}>
                <th scope="row">{row.label}</th>
                <td>{row.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <details>
          <summary>Learn what these mean</summary>
          <p>
            Live co-editing lets people edit together. Live updates refresh changes as they happen.
            Search finds items on your storage. Access requests let people ask an owner for
            permission. Version history keeps earlier copies. Trash lets you restore deleted items.
            Link sharing lets anyone with a link open an item. Expiring access ends sharing after a
            chosen time. Move changes where an item is stored.
          </p>
        </details>
      </section>
    </>
  );
}
