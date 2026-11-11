// AUTHORED-BY Codex (GPT-6.1 Sol)
"use client";
import {
  EVENT_STATUS,
  entities,
  type Invitation,
  type InviteeData,
  type Reply,
  RSVP_RESPONSE,
  readReplies,
  summariseRsvps,
} from "@jeswr/solid-events";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  toast,
} from "@jeswr/suite-ui";
import { ArrowLeft, CalendarDays, Clock3, Copy, Globe2, MapPin, Users } from "lucide-react";
import { useEffect, useState } from "react";
import type { PodSession } from "@/lib/session/pod-session";
import { AppHeading } from "@/shell/app-frame";
import { useEvents } from "../state/events-context";
import { EventForm } from "./event-form";
import { RsvpPanel } from "./rsvp-panel";

export const eventDate = (date: Date) =>
  date.toLocaleString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
export function InvitationDetail({
  event,
  fetch,
  session,
  organiser,
  onBack,
  onCancel,
  onEdit,
  invitees = [],
  onNotify,
}: {
  event: Invitation;
  fetch: typeof globalThis.fetch;
  session?: PodSession | undefined;
  organiser?: boolean;
  onBack?(): void;
  onCancel?(): void;
  onEdit?(): void;
  invitees?: InviteeData[];
  onNotify?: (() => void) | undefined;
}) {
  const [replies, setReplies] = useState<Reply[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const canRead = organiser || event.guestListVisible;
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt explicitly retries the read
  useEffect(() => {
    let live = true;
    if (!canRead) {
      setStatus("ready");
      return;
    }
    setStatus("loading");
    void readReplies(fetch, event.url).then(
      (rows) => {
        if (live) {
          setReplies(rows);
          setStatus("ready");
        }
      },
      () => {
        if (live) setStatus("error");
      },
    );
    return () => {
      live = false;
    };
  }, [fetch, event.url, canRead, attempt]);
  const summary = summariseRsvps(replies, { ...event, url: entities.Event.subject(event.url) });
  return (
    <div className="ev-page ev-detail">
      {onBack && (
        <Button variant="ghost" onClick={onBack} className="ev-back">
          <ArrowLeft size={16} aria-hidden="true" />
          All invitations
        </Button>
      )}
      <header className="ev-invitation-cover">
        <div className="ev-cover-mark" aria-hidden="true">
          <CalendarDays size={56} strokeWidth={1} />
        </div>
        <span className="ev-eyebrow">You're invited</span>
        <AppHeading>{event.name}</AppHeading>
        <div className="ev-actions">
          <Badge variant="secondary">
            {event.publication === "draft"
              ? "Private draft"
              : event.eventStatus === EVENT_STATUS.cancelled
                ? "Cancelled"
                : event.eventStatus === EVENT_STATUS.postponed
                  ? "Postponed"
                  : "Let's get together"}
          </Badge>
          <Badge variant="outline">
            {event.visibility === "link" ? "Anyone with the link" : "Invited WebIDs only"}
          </Badge>
        </div>
      </header>
      <div className="ev-detail-grid">
        <div className="ev-details-main">
          <section className="ev-panel ev-event-info">
            <h3>The details</h3>
            <p>
              <CalendarDays size={18} aria-hidden="true" />
              <time dateTime={event.startDate.toISOString()}>{eventDate(event.startDate)}</time>
            </p>
            {event.endDate && (
              <p>
                <Clock3 size={18} aria-hidden="true" />
                Until {eventDate(event.endDate)}
              </p>
            )}
            {event.location && (
              <p>
                <MapPin size={18} aria-hidden="true" />
                <span>
                  {event.location}
                  {event.address && <small>{event.address}</small>}
                </span>
              </p>
            )}
            {event.onlineUrl && (
              <p>
                <Globe2 size={18} aria-hidden="true" />
                <a href={event.onlineUrl} target="_blank" rel="noreferrer">
                  Join online
                </a>
              </p>
            )}
            {event.capacity !== undefined && (
              <p>
                <Users size={18} aria-hidden="true" />
                Room for {event.capacity} guests
              </p>
            )}
            {event.rsvpDeadline && (
              <p className="ev-muted">Please reply by {eventDate(event.rsvpDeadline)}</p>
            )}
            <p className="ev-description">
              {event.description || "The best part will be having you there."}
            </p>
          </section>
          {organiser && (
            <section className="ev-panel">
              <h3>Your invitation</h3>
              <div className="ev-actions">
                <Button variant="outline" onClick={onEdit}>
                  Edit details
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    const url = new URL("/events/view", location.origin);
                    url.searchParams.set("event", event.url);
                    void navigator.clipboard.writeText(url.href).then(
                      () => toast.success("Invitation link copied"),
                      () =>
                        toast.error(
                          "Couldn't copy the link. Open the guest page to copy its address.",
                        ),
                    );
                  }}
                >
                  <Copy size={15} aria-hidden="true" />
                  Copy invite link
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    const url = new URL("/events/view", location.origin);
                    url.searchParams.set("event", event.url);
                    window.open(url.href, "_blank", "noopener,noreferrer");
                  }}
                >
                  Open guest page
                </Button>
                {onNotify && (
                  <Button variant="outline" onClick={onNotify}>
                    Notify invited WebIDs
                  </Button>
                )}
                {event.eventStatus !== EVENT_STATUS.cancelled && (
                  <Button variant="destructive" onClick={onCancel}>
                    Cancel event
                  </Button>
                )}
              </div>
              {invitees.length > 0 && (
                <p className="ev-muted">
                  {invitees.length} invited ·{" "}
                  {invitees.map((i) => i.displayName ?? i.webId).join(", ")}
                </p>
              )}
            </section>
          )}
          {canRead ? (
            <section className="ev-panel" aria-labelledby="ev-guests-title">
              <div className="ev-section-heading">
                <h3 id="ev-guests-title">Good company</h3>
                <Badge variant="secondary">
                  Guest list {event.guestListVisible ? "visible" : "private"}
                </Badge>
              </div>
              {status === "loading" ? (
                <LoadingSkeleton preset="list" />
              ) : status === "error" ? (
                <ErrorState
                  error="unreachable"
                  actions={{ retry: () => setAttempt((a) => a + 1) }}
                />
              ) : (
                <>
                  <div className="ev-tally">
                    <div>
                      <strong>{summary.attending}</strong>
                      <span>going, incl. guests</span>
                    </div>
                    <div>
                      <strong>{summary.maybe}</strong>
                      <span>maybe</span>
                    </div>
                    <div>
                      <strong>{summary.no}</strong>
                      <span>can't go</span>
                    </div>
                  </div>
                  {summary.remaining !== null && (
                    <p className="ev-muted">
                      {summary.remaining} places remaining
                      {summary.overCapacity > 0 ? ` · ${summary.overCapacity} over capacity` : ""}.
                      Capacity is a guide; places are not reserved.
                    </p>
                  )}
                  {!summary.latest.length ? (
                    <EmptyState
                      title="The first yes is on its way"
                      body="Replies will appear here as your guests respond."
                    />
                  ) : (
                    <ul className="ev-guest-list">
                      {summary.latest.map((reply) => (
                        <li key={reply.url}>
                          <span className="ev-avatar" aria-hidden="true">
                            {(reply.displayName ?? "G").slice(0, 1)}
                          </span>
                          <div>
                            <strong>{reply.displayName ?? "Guest"}</strong>
                            <small>
                              {reply.agent ? "WebID supplied · identity unverified" : "Named guest"}
                              {reply.additionalGuests > 0 ? ` · +${reply.additionalGuests}` : ""}
                            </small>
                            {reply.comment && <p>{reply.comment}</p>}
                          </div>
                          <div className="ev-reply-chips">
                            <Badge variant="secondary">
                              {reply.response === RSVP_RESPONSE.yes
                                ? "Going"
                                : reply.response === RSVP_RESPONSE.no
                                  ? "Can't go"
                                  : "Maybe"}
                            </Badge>
                            {summary.late.includes(reply) && (
                              <Badge variant="outline">Late reply</Badge>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </section>
          ) : (
            <section className="ev-panel">
              <h3>A private guest list</h3>
              <p className="ev-muted">
                The organiser can see replies. Guests can't read each other's responses.
              </p>
            </section>
          )}
        </div>
        <RsvpPanel
          key={`${event.url}:${session?.webId ?? "anonymous"}`}
          event={event}
          fetch={fetch}
          session={session}
          onReply={(reply) => setReplies((rows) => [...rows, reply])}
        />
      </div>
    </div>
  );
}
export function OrganiserDetail({ event, onBack }: { event: Invitation; onBack(): void }) {
  const { session, controller } = useEvents();
  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [invitees, setInvitees] = useState<InviteeData[]>([]);
  useEffect(() => {
    let live = true;
    void controller.repository.invitees(event).then(
      (rows) => {
        if (live) setInvitees(rows);
      },
      () => {
        if (live) toast.error("Couldn't load the invited guest list");
      },
    );
    return () => {
      live = false;
    };
  }, [controller, event]);
  return (
    <>
      <InvitationDetail
        event={event}
        fetch={session.fetch}
        session={session}
        organiser
        onBack={onBack}
        onEdit={() => setEditing(true)}
        onCancel={() => setCancelling(true)}
        invitees={invitees}
        onNotify={
          invitees.some((i) => i.webId) && event.publication === "published"
            ? () => {
                void controller.repository
                  .notify(
                    event,
                    invitees.flatMap((i) => (i.webId ? [i.webId] : [])),
                  )
                  .then(
                    (results) => {
                      if (results.every((result) => result.delivered))
                        toast.success("Invitations delivered to their inboxes");
                      else
                        toast.error(
                          "Some invitations couldn't be delivered. You can still share the invite link.",
                        );
                    },
                    () => toast.error("Couldn't notify your guests"),
                  );
              }
            : undefined
        }
      />
      <EventForm
        key={editing ? "edit" : "closed"}
        open={editing}
        onClose={() => setEditing(false)}
        owner={session.webId}
        existing={event}
        onSave={(data) => controller.save(data, [], event)}
      />
      <Dialog open={cancelling} onOpenChange={setCancelling}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel {event.name}?</DialogTitle>
            <DialogDescription>
              The invitation will say it's cancelled and stop accepting replies. Existing replies
              stay in your pod.
            </DialogDescription>
          </DialogHeader>
          <div className="ev-actions">
            <Button variant="outline" onClick={() => setCancelling(false)}>
              Keep event
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                controller.save(
                  { ...event, eventStatus: EVENT_STATUS.cancelled, modified: new Date() },
                  [],
                  event,
                );
                setCancelling(false);
              }}
            >
              Confirm cancellation
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
