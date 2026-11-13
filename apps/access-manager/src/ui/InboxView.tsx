// AUTHORED-BY Codex GPT-6.1-Sol
// The SDK owns request parsing, target resolution, decisions and recovery.
import {
  type AccessRequestEntry,
  accessModel,
  type DecideOptions,
  type DecisionPreview,
  DecisionPreviewConflictError,
  decide,
  listRequests,
  previewDecision,
  RequestConflictError,
  UnsupportedAccessModelError,
} from "@jeswr/pod-access/requests-solid";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { publicFetchFor, type Session, useSession } from "../auth/SessionContext.js";
import { classLabel } from "../lib/type-index.js";
import { AgentLabel, resourceLabel, SavingIndicator, useOptimistic } from "./bits.jsx";

type ReadableRequest = Exclude<AccessRequestEntry, { status: "unreadable" }>;
const UNAVAILABLE = "Approving requests isn't available on this storage yet.";

function previewError(error: unknown): string {
  if (error instanceof UnsupportedAccessModelError) return UNAVAILABLE;
  return error instanceof Error ? error.message : "The access preview could not be read.";
}

function TargetPreview({ preview }: { preview: DecisionPreview }) {
  return (
    <div>
      <p>
        Recipient: <AgentLabel agent={preview.requester} showHost />
      </p>
      <p>Data: {preview.dataTypes.map(classLabel).join(", ")}</p>
      {preview.purpose ? <p>Purpose: {classLabel(preview.purpose)}</p> : null}
      <ul>
        {preview.targets.map((target) => (
          <li key={target.url}>
            {resourceLabel(target.url, preview.storage)}:{" "}
            {target.role === "editor" ? "Can edit (view, add and change)" : "Can view"}
            {" — "}
            {preview.expiresAt ? `Recorded until ${preview.expiresAt}` : "No expiry"}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Only a preview for these exact inputs can enable confirmation. */
function ApprovalReview({
  request,
  options,
  version,
  previous,
  saving,
  onConfirm,
  onCancel,
}: {
  request: ReadableRequest;
  options: DecideOptions;
  version: number;
  previous: DecisionPreview | null;
  saving: boolean;
  onConfirm: (preview: DecisionPreview) => void;
  onCancel: () => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    request: ReadableRequest;
    options: DecideOptions;
    version: number;
    attempt: number;
    preview?: DecisionPreview;
    error?: string;
  } | null>(null);
  const current =
    result?.request === request &&
    result.options === options &&
    result.version === version &&
    result.attempt === attempt
      ? result
      : null;

  useEffect(() => {
    const controller = new AbortController();
    void previewDecision(
      request,
      { approve: true },
      { ...options, signal: controller.signal },
    ).then(
      (preview) => {
        if (!controller.signal.aborted) setResult({ request, options, version, attempt, preview });
      },
      (error) => {
        if (!controller.signal.aborted)
          setResult({ request, options, version, attempt, error: previewError(error) });
      },
    );
    return () => controller.abort();
  }, [request, options, version, attempt]);

  return (
    <div className="approve-preview" data-testid="approve-preview">
      <p>Approve this access?</p>
      {previous ? (
        <div role="status">
          <p>
            Access changed since your review. Compare the previous and current targets before
            confirming again.
          </p>
          <p>Previous preview</p>
          <TargetPreview preview={previous} />
        </div>
      ) : null}
      <p>{previous ? "Current preview" : "Access to grant"}</p>
      {current?.preview ? (
        <TargetPreview preview={current.preview} />
      ) : current?.error ? (
        <p role="alert">{current.error}</p>
      ) : (
        <p role="status">Reading access preview…</p>
      )}
      <p>Data added later is not included.</p>
      <p>
        Purpose and expiry are metadata. WAC does not enforce an expiry or automatically revoke
        access.
      </p>
      <div className="request-actions">
        <button
          type="button"
          disabled={!current?.preview || saving}
          onClick={() => current?.preview && onConfirm(current.preview)}
          data-testid="confirm-approve"
        >
          Approve request
        </button>
        {current?.error ? (
          <button type="button" onClick={() => setAttempt((value) => value + 1)}>
            Retry preview
          </button>
        ) : null}
        <button type="button" disabled={saving} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

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
  const publicFetch = publicFetchFor(session);
  const [listing, setListing] = useState<{
    session: Session;
    requests: AccessRequestEntry[];
  } | null>(null);
  const requests = listing?.session === session ? listing.requests : [];
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [previousPreview, setPreviousPreview] = useState<DecisionPreview | null>(null);
  const [previewVersion, setPreviewVersion] = useState(0);
  const [canApprove, setCanApprove] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const { state, error, run } = useOptimistic();
  const deciding = useRef(false);
  const activeRead = useRef<AbortController | null>(null);
  const options = useMemo(
    () => ({ fetch: session.fetch, webId: session.webId, storage: storageRoot ?? "", publicFetch }),
    [session, storageRoot, publicFetch],
  );

  const reload = useCallback(() => {
    activeRead.current?.abort();
    const controller = new AbortController();
    activeRead.current = controller;
    setListing(null);
    setConfirming(null);
    setPreviousPreview(null);
    setCanApprove(false);
    if (!inboxUrl || !storageRoot) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const options = { fetch: session.fetch, webId: session.webId, storage: storageRoot };
    void listRequests({ ...options, inbox: inboxUrl, signal: controller.signal })
      .then((entries) => {
        if (!controller.signal.aborted) setListing({ session, requests: entries });
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

  const makeDecision = (request: ReadableRequest, approve: boolean, expected?: DecisionPreview) => {
    if (!storageRoot || deciding.current) return;
    deciding.current = true;
    setNotice(null);
    let stalePreview = false;
    void run({
      apply: () => undefined,
      revert: () => {
        if (!stalePreview) reload();
      },
      persist: async () => {
        try {
          const pin = expected ?? (await previewDecision(request, { approve }, options));
          await decide(request, { approve }, { ...options, expected: pin });
        } catch (error) {
          if (error instanceof DecisionPreviewConflictError && expected) {
            stalePreview = true;
            setPreviousPreview(expected);
            setPreviewVersion((value) => value + 1);
            throw new Error("Access changed. Review the updated preview before approving again.");
          }
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
                    <AgentLabel agent={request.requester} showHost />
                    <span className={`status-badge ${request.status}`}>
                      {request.status[0]?.toUpperCase()}
                      {request.status.slice(1)}
                    </span>
                  </div>
                  <dl className="request-fields">
                    <dt>Requests</dt>
                    <dd>{request.dataTypes.map(classLabel).join(", ")}</dd>
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
                  {(request.status === "pending" || request.status === "approving") &&
                  storageRoot ? (
                    confirming === request.id ? (
                      <ApprovalReview
                        request={request}
                        options={options}
                        version={previewVersion}
                        previous={previousPreview}
                        saving={!canApprove || state === "saving"}
                        onConfirm={(preview) => makeDecision(request, true, preview)}
                        onCancel={() => {
                          setConfirming(null);
                          setPreviousPreview(null);
                        }}
                      />
                    ) : (
                      <div className="request-actions">
                        {request.status === "approving" ? (
                          <p>
                            This approval was interrupted. Review the approval saved in your private
                            access records before continuing.
                          </p>
                        ) : null}
                        <button
                          type="button"
                          disabled={!canApprove || state === "saving"}
                          onClick={() => {
                            setConfirming(request.id);
                            setPreviousPreview(null);
                          }}
                        >
                          {request.status === "approving"
                            ? "Finish saved approval"
                            : "Review & approve…"}
                        </button>
                        {request.status === "pending" ? (
                          <button
                            type="button"
                            disabled={!canApprove || state === "saving"}
                            className="danger"
                            onClick={() => makeDecision(request, false)}
                          >
                            Deny
                          </button>
                        ) : null}
                      </div>
                    )
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
