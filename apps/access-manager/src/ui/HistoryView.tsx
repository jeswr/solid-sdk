// AUTHORED-BY Claude Fable 5
//
// History / receipts: the DPV consent-record audit trail — what was granted,
// to whom, for what purpose, when, and revoked-when — plus revocation of the
// still-active grants (retracts the pinned WAC + flips the records).

import { useCallback, useEffect, useState } from "react";
import { useSession } from "../auth/SessionContext.js";
import {
  type GrantRecord,
  listGrants,
  listReceipts,
  type ReceiptRecord,
  revokeGrant,
} from "../lib/history.js";
import { classLabel } from "../lib/type-index.js";
import { DPV } from "../lib/vocab.js";
import { AgentLabel, resourceLabel, SavingIndicator, useOptimistic } from "./bits.jsx";

function statusLabel(iri: string | undefined): string {
  if (iri === DPV.ConsentGiven) return "Granted";
  if (iri === DPV.ConsentRefused) return "Denied";
  if (iri === DPV.ConsentWithdrawn) return "Revoked";
  if (iri === DPV.ConsentRequested) return "Requested";
  return iri !== undefined ? classLabel(iri) : "Unknown";
}

export function HistoryView({
  storageRoot,
  onChanged,
}: {
  storageRoot: string | null;
  onChanged: () => void;
}) {
  const session = useSession();
  const [grants, setGrants] = useState<GrantRecord[]>([]);
  const [receipts, setReceipts] = useState<ReceiptRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const { state, error, run } = useOptimistic();

  const grantsContainer = storageRoot ? `${storageRoot}access-manager/grants/` : null;
  const receiptsContainer = storageRoot ? `${storageRoot}access-manager/receipts/` : null;

  const reload = useCallback(() => {
    if (!grantsContainer || !receiptsContainer) return;
    setLoading(true);
    Promise.all([
      listGrants(grantsContainer, session.fetch),
      listReceipts(receiptsContainer, session.fetch),
    ])
      .then(([g, r]) => {
        setGrants(g);
        setReceipts(
          [...r].sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0)),
        );
      })
      .finally(() => setLoading(false));
  }, [grantsContainer, receiptsContainer, session.fetch]);

  useEffect(reload, [reload]);

  const revoke = (grant: GrantRecord) => {
    if (!storageRoot || !receiptsContainer) return;
    void run({
      apply: () =>
        setGrants((prev) =>
          prev.map((g) => (g.url === grant.url ? { ...g, revokedAt: new Date() } : g)),
        ),
      revert: () => reload(),
      persist: async () => {
        await revokeGrant(grant, {
          ownerWebId: session.webId,
          storageRoot,
          receiptsContainer,
          fetch: session.fetch,
        });
        onChanged();
        reload();
      },
    });
  };

  return (
    <section aria-label="History and receipts">
      <div className="view-toolbar">
        <button type="button" onClick={reload}>
          Refresh
        </button>
        {loading ? <span className="walking">Reading records…</span> : null}
        <SavingIndicator state={state} error={error} />
      </div>

      <h3>Active grants</h3>
      {grants.filter((g) => g.revokedAt === undefined).length === 0 ? (
        <p className="empty">No active grants made through this app.</p>
      ) : (
        <ul className="grant-list">
          {grants
            .filter((g) => g.revokedAt === undefined)
            .map((g) => (
              <li key={g.url} className="grant">
                {g.agent ? <AgentLabel agent={g.agent} fetchFn={session.fetch} /> : "Unknown agent"}
                <span> — {g.modes.join(", ") || "?"} on </span>
                <span>{g.targets.length} resource(s)</span>
                {g.purpose ? <span> for {classLabel(g.purpose)}</span> : null}
                {g.createdAt ? (
                  <span className="when"> since {g.createdAt.toISOString().slice(0, 10)}</span>
                ) : null}
                <button
                  type="button"
                  className="danger"
                  onClick={() => revoke(g)}
                  data-testid="revoke-grant"
                >
                  Revoke
                </button>
              </li>
            ))}
        </ul>
      )}

      <h3>Consent receipts</h3>
      {receipts.length === 0 ? (
        <p className="empty">No consent receipts yet — approvals and denials appear here.</p>
      ) : (
        <table className="receipt-table">
          <thead>
            <tr>
              <th>Decision</th>
              <th>Agent</th>
              <th>Purpose</th>
              <th>Resources</th>
              <th>When</th>
              <th>Revoked</th>
            </tr>
          </thead>
          <tbody>
            {receipts.map((r) => (
              <tr key={r.url} className={`receipt ${statusLabel(r.status).toLowerCase()}`}>
                <td>{statusLabel(r.status)}</td>
                <td>
                  {r.recipient ? <AgentLabel agent={r.recipient} fetchFn={session.fetch} /> : "—"}
                </td>
                <td>{r.purpose ? classLabel(r.purpose) : "—"}</td>
                <td title={r.targets.map((t) => resourceLabel(t, storageRoot)).join("\n")}>
                  {r.targets.length}
                </td>
                <td>{r.createdAt ? r.createdAt.toISOString().slice(0, 10) : "—"}</td>
                <td>{r.revokedAt ? r.revokedAt.toISOString().slice(0, 10) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
