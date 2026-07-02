// AUTHORED-BY Claude Fable 5
//
// The access-request inbox. Each pending request shows requester (profile-
// resolved name), requested data class / targets, modes, purpose and expiry.
// APPROVAL IS ON THE RESOLVED CONCRETE SET (§3.4 step 2): the approve flow
// first previews exactly which resources would be shared, then runs the §3.5
// CAS-pinned pipeline. An interrupted (Approving) request offers a USER-
// CONFIRMED resume showing the PINNED snapshot targets — never automatic.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "../auth/SessionContext.js";
import {
  ApprovalConflictError,
  type ApprovalContext,
  approveRequest,
  denyRequest,
  previewApproval,
  resumeApproval,
} from "../lib/approval.js";
import { listInbox, type ParsedAccessRequest } from "../lib/inbox.js";
import type { WalkedNode } from "../lib/storage-walk.js";
import type { TypeRegistration } from "../lib/type-index.js";
import { classLabel } from "../lib/type-index.js";
import { AgentLabel, ModeBadges, resourceLabel, SavingIndicator, useOptimistic } from "./bits.jsx";

export function InboxView({
  inboxUrl,
  storageRoot,
  registrations,
  nodes,
  onChanged,
}: {
  inboxUrl: string | null;
  storageRoot: string | null;
  registrations: TypeRegistration[];
  nodes: WalkedNode[];
  onChanged: () => void;
}) {
  const session = useSession();
  const [requests, setRequests] = useState<ParsedAccessRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const { state, error, run } = useOptimistic();
  const [notice, setNotice] = useState<string | null>(null);

  const ctx: ApprovalContext | null = useMemo(() => {
    if (!storageRoot) return null;
    return {
      ownerWebId: session.webId,
      storageRoot,
      grantsContainer: `${storageRoot}access-manager/grants/`,
      receiptsContainer: `${storageRoot}access-manager/receipts/`,
      fetch: session.fetch,
      registrations,
      knownResources: nodes.map((n) => n.url),
    };
  }, [session, storageRoot, registrations, nodes]);

  const reload = useCallback(() => {
    if (!inboxUrl) return;
    setLoading(true);
    listInbox(inboxUrl, session.fetch)
      .then(setRequests)
      .catch(() => setNotice("The inbox could not be read."))
      .finally(() => setLoading(false));
  }, [inboxUrl, session.fetch]);

  useEffect(reload, [reload]);

  if (!inboxUrl) {
    return (
      <section aria-label="Access requests">
        <p className="empty">
          Your WebID profile advertises no ldp:inbox, so apps have nowhere to send access requests.
          Add one to your profile to receive requests here.
        </p>
      </section>
    );
  }

  const approve = (request: ParsedAccessRequest) => {
    if (!ctx) return;
    setConfirming(null);
    void run({
      apply: () =>
        setRequests((prev) =>
          prev.map((r) => (r.url === request.url ? { ...r, status: "Approved" as const } : r)),
        ),
      revert: () => reload(),
      persist: async () => {
        try {
          await approveRequest(request, ctx);
        } catch (e) {
          if (e instanceof ApprovalConflictError) {
            setNotice(
              `This request was already handled elsewhere (now ${e.current?.status ?? "gone"}).`,
            );
          }
          throw e;
        }
        onChanged();
        reload();
      },
    });
  };

  const deny = (request: ParsedAccessRequest) => {
    if (!ctx) return;
    void run({
      apply: () =>
        setRequests((prev) =>
          prev.map((r) => (r.url === request.url ? { ...r, status: "Denied" as const } : r)),
        ),
      revert: () => reload(),
      persist: async () => {
        try {
          await denyRequest(request, ctx);
        } catch (e) {
          if (e instanceof ApprovalConflictError) {
            setNotice(
              `This request was already handled elsewhere (now ${e.current?.status ?? "gone"}).`,
            );
          }
          throw e;
        }
        reload();
      },
    });
  };

  const resume = (request: ParsedAccessRequest) => {
    if (!ctx) return;
    void run({
      apply: () => undefined,
      revert: () => reload(),
      persist: async () => {
        await resumeApproval(request.url, ctx);
        onChanged();
        reload();
      },
    });
  };

  return (
    <section aria-label="Access requests">
      <div className="view-toolbar">
        <button type="button" onClick={reload}>
          Refresh
        </button>
        {loading ? <span className="walking">Reading inbox…</span> : null}
        <SavingIndicator state={state} error={error} />
      </div>
      {notice ? (
        <p role="status" className="notice">
          {notice}
        </p>
      ) : null}
      {requests.length === 0 && !loading ? (
        <p className="empty">No access requests.</p>
      ) : (
        <ul className="request-list">
          {requests.map((request) => (
            <li key={request.url} className={`request status-${request.status.toLowerCase()}`}>
              {request.malformed ? (
                <p className="malformed">
                  Unparseable message <code>{request.url}</code> — not a valid access request.
                </p>
              ) : (
                <>
                  <div className="request-head">
                    {request.requester ? (
                      <AgentLabel agent={request.requester} fetchFn={session.fetch} />
                    ) : (
                      <span className="agent unknown">Unknown requester</span>
                    )}
                    <span className={`status-badge ${request.status.toLowerCase()}`}>
                      {request.status}
                    </span>
                  </div>
                  <dl className="request-fields">
                    <dt>Requests</dt>
                    <dd>
                      <ModeBadges modes={request.modes.length > 0 ? request.modes : ["Read"]} />{" "}
                      {request.dataClass
                        ? `your ${classLabel(request.dataClass)} data`
                        : request.targets.map((t) => resourceLabel(t, storageRoot)).join(", ") ||
                          "(no targets named)"}
                    </dd>
                    {request.purpose ? (
                      <>
                        <dt>Purpose</dt>
                        <dd>{classLabel(request.purpose)}</dd>
                      </>
                    ) : null}
                    {request.expiry ? (
                      <>
                        <dt>Until</dt>
                        <dd>{request.expiry}</dd>
                      </>
                    ) : null}
                  </dl>
                  {request.status === "Pending" && ctx ? (
                    confirming === request.url ? (
                      <ApprovePreview
                        request={request}
                        ctx={ctx}
                        storageRoot={storageRoot}
                        onConfirm={() => approve(request)}
                        onCancel={() => setConfirming(null)}
                      />
                    ) : (
                      <div className="request-actions">
                        <button type="button" onClick={() => setConfirming(request.url)}>
                          Review &amp; approve…
                        </button>
                        <button type="button" className="danger" onClick={() => deny(request)}>
                          Deny
                        </button>
                      </div>
                    )
                  ) : null}
                  {request.status === "Approving" ? (
                    <div className="request-actions interrupted">
                      <p>
                        This approval was interrupted. It is pinned to{" "}
                        {request.snapshot?.targets.length ?? 0} resource(s):
                      </p>
                      <ul>
                        {(request.snapshot?.targets ?? []).map((t) => (
                          <li key={t}>{resourceLabel(t, storageRoot)}</li>
                        ))}
                      </ul>
                      <button type="button" onClick={() => resume(request)}>
                        Finish approving exactly these
                      </button>
                    </div>
                  ) : null}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** §3.4 step 2: approval is on the RESOLVED CONCRETE SET, shown before consent. */
function ApprovePreview({
  request,
  ctx,
  storageRoot,
  onConfirm,
  onCancel,
}: {
  request: ParsedAccessRequest;
  ctx: ApprovalContext;
  storageRoot: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const preview = useMemo(() => previewApproval(request, ctx), [request, ctx]);
  return (
    <div className="approve-preview" data-testid="approve-preview">
      {preview.targets.length === 0 ? (
        <>
          <p>
            This request resolves to <strong>no concrete resources</strong> in your storage — there
            is nothing to grant.
          </p>
          <button type="button" onClick={onCancel}>
            Back
          </button>
        </>
      ) : (
        <>
          <p>
            Approving will share these <strong>{preview.targets.length}</strong> resource(s) with
            the requester (
            <ModeBadges modes={preview.modes.length > 0 ? preview.modes : ["Read"]} />
            ):
          </p>
          <ul>
            {preview.targets.map((t) => (
              <li key={t}>{resourceLabel(t, storageRoot)}</li>
            ))}
          </ul>
          <p className="pin-note">
            Only these exact resources are shared — data added later is NOT included (a new request
            is needed).
          </p>
          <div className="request-actions">
            <button type="button" onClick={onConfirm} data-testid="confirm-approve">
              Approve these {preview.targets.length}
            </button>
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}
