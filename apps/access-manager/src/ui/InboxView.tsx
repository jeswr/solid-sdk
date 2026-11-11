// AUTHORED-BY Codex GPT-6.1-Sol
// The SDK owns request parsing, target resolution, decisions and recovery.
import {
  type AccessRequestEntry,
  accessModel,
  decide,
  listRequests,
  RequestConflictError,
  UnsupportedAccessModelError,
} from "@jeswr/pod-access/requests-solid";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "../auth/SessionContext.js";
import { classLabel } from "../lib/type-index.js";
import { SavingIndicator, useOptimistic } from "./bits.jsx";

type ReadableRequest = Exclude<AccessRequestEntry, { status: "unreadable" }>;
const UNAVAILABLE = "Approving requests isn't available on this storage yet.";

export function InboxView({
  inboxUrl,
  storageRoot,
  onChanged,
}: {
  inboxUrl: string | null;
  storageRoot: string | null;
  onChanged: () => void;
}) {
  const session = useSession();
  const [requests, setRequests] = useState<AccessRequestEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [canApprove, setCanApprove] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const { state, error, run } = useOptimistic();
  const deciding = useRef(false);
  const activeRead = useRef<AbortController | null>(null);

  const reload = useCallback(() => {
    activeRead.current?.abort();
    const controller = new AbortController();
    activeRead.current = controller;
    setRequests([]);
    setCanApprove(false);
    if (!inboxUrl || !storageRoot) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const options = { fetch: session.fetch, webId: session.webId, storage: storageRoot };
    void listRequests({ ...options, inbox: inboxUrl, signal: controller.signal })
      .then((entries) => {
        if (!controller.signal.aborted) setRequests(entries);
      })
      .catch(() => {
        if (!controller.signal.aborted) setNotice("The inbox could not be read.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    void accessModel(options).then(
      (model) => {
        if (controller.signal.aborted) return;
        setCanApprove(model === "wac");
        setNotice(model === "wac" ? null : UNAVAILABLE);
      },
      () => {
        if (!controller.signal.aborted) setNotice(UNAVAILABLE);
      },
    );
  }, [inboxUrl, storageRoot, session]);

  useEffect(() => {
    reload();
    return () => activeRead.current?.abort();
  }, [reload]);

  const makeDecision = (request: ReadableRequest, approve: boolean) => {
    if (!storageRoot || deciding.current) return;
    deciding.current = true;
    setConfirming(null);
    setNotice(null);
    void run({
      apply: () => undefined,
      revert: () => {
        reload();
      },
      persist: async () => {
        try {
          await decide(
            request,
            { approve },
            {
              fetch: session.fetch,
              webId: session.webId,
              storage: storageRoot,
            },
          );
        } catch (error) {
          if (error instanceof UnsupportedAccessModelError) throw new Error(UNAVAILABLE);
          if (error instanceof RequestConflictError) {
            throw new Error(`This request was already handled elsewhere (now ${error.current}).`);
          }
          throw error;
        }
        onChanged();
        reload();
      },
    }).finally(() => {
      deciding.current = false;
    });
  };

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

  return (
    <section aria-label="Access requests">
      <div className="view-toolbar">
        <button
          type="button"
          onClick={() => {
            reload();
          }}
        >
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
            <li key={request.id} className={`request status-${request.status}`}>
              {request.status === "unreadable" ? (
                <p className="malformed">
                  Unparseable message <code>{request.id}</code> — not a valid access request.
                </p>
              ) : (
                <>
                  <div className="request-head">
                    <span className="agent" title={request.requester}>
                      {request.requesterName ?? request.requester}
                    </span>
                    <span className={`status-badge ${request.status}`}>
                      {request.status[0]?.toUpperCase()}
                      {request.status.slice(1)}
                    </span>
                  </div>
                  <dl className="request-fields">
                    <dt>Requests</dt>
                    <dd>
                      {request.modes.join(", ")} — your{" "}
                      {request.dataTypes.map(classLabel).join(", ")} data
                    </dd>
                    {request.purpose ? (
                      <>
                        <dt>Purpose</dt>
                        <dd>{classLabel(request.purpose)}</dd>
                      </>
                    ) : null}
                    {request.expiresAt ? (
                      <>
                        <dt>Requested until</dt>
                        <dd>{request.expiresAt}</dd>
                      </>
                    ) : null}
                    {request.requestedDuration ? (
                      <>
                        <dt>Requested duration</dt>
                        <dd>{request.requestedDuration}</dd>
                      </>
                    ) : null}
                  </dl>
                  {request.status === "pending" && storageRoot ? (
                    confirming === request.id ? (
                      <div className="approve-preview" data-testid="approve-preview">
                        <p>
                          Approve the requested access to your{" "}
                          {request.dataTypes.map(classLabel).join(", ")} data?
                        </p>
                        <p>
                          Your registered data locations are resolved and the concrete resources are
                          pinned when you approve. Data added later is not included.
                        </p>
                        <p>
                          Purpose and requested expiry are metadata. WAC does not enforce an expiry
                          or automatically revoke access.
                        </p>
                        <div className="request-actions">
                          <button
                            type="button"
                            disabled={!canApprove || state === "saving"}
                            onClick={() => makeDecision(request, true)}
                            data-testid="confirm-approve"
                          >
                            Approve request
                          </button>
                          <button type="button" onClick={() => setConfirming(null)}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="request-actions">
                        <button
                          type="button"
                          disabled={!canApprove || state === "saving"}
                          onClick={() => setConfirming(request.id)}
                        >
                          Review &amp; approve…
                        </button>
                        <button
                          type="button"
                          disabled={state === "saving"}
                          className="danger"
                          onClick={() => makeDecision(request, false)}
                        >
                          Deny
                        </button>
                      </div>
                    )
                  ) : null}
                  {request.status === "approving" && storageRoot ? (
                    <div className="request-actions interrupted">
                      <p>
                        This approval was interrupted. Continue only the approval saved in your
                        private access records. If that record is missing, approval will be refused.
                      </p>
                      <button
                        type="button"
                        disabled={!canApprove || state === "saving"}
                        onClick={() => makeDecision(request, true)}
                      >
                        Finish saved approval
                      </button>
                      <button
                        type="button"
                        disabled={state === "saving"}
                        className="danger"
                        onClick={() => makeDecision(request, false)}
                      >
                        Deny
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
