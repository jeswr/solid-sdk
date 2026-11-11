// AUTHORED-BY Codex (GPT-6.1 Sol)
"use client";
import {
  appendRsvp,
  EVENT_STATUS,
  entities,
  type Invitation,
  type Reply,
  RSVP_RESPONSE,
  type RsvpData,
} from "@jeswr/solid-events";
import { Button, Input, Label, Textarea, toast } from "@jeswr/suite-ui";
import { Check, CircleHelp, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { PodSession } from "@/lib/session/pod-session";

export function RsvpPanel({
  event,
  fetch,
  session,
  onReply,
}: {
  event: Invitation;
  fetch: typeof globalThis.fetch;
  session?: PodSession | undefined;
  onReply(reply: Reply): void;
}) {
  const [response, setResponse] = useState<RsvpData["response"]>(RSVP_RESPONSE.yes);
  const [saved, setSaved] = useState(false);
  const [sending, setSending] = useState(false);
  const [name, setName] = useState(session?.displayName ?? "");
  const guestKey = useRef(crypto.randomUUID());
  const confirmed = useRef(false);
  const revision = useRef(0);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    const storageKey = `events:reply:${session?.webId ?? "anonymous"}:${event.url}`;
    try {
      const value = localStorage.getItem(storageKey);
      if (value) {
        const receipt = JSON.parse(value);
        if (typeof receipt.guestKey === "string") guestKey.current = receipt.guestKey;
        if (Object.values(RSVP_RESPONSE).includes(receipt.response)) {
          setResponse(receipt.response);
          setSaved(true);
          confirmed.current = true;
        }
        if (typeof receipt.displayName === "string") setName(receipt.displayName);
      }
    } catch {
      /* Storage is optional; the current page still keeps its receipt. */
    }
    return () => {
      live.current = false;
      ++revision.current;
    };
  }, [event.url, session?.webId]);
  const closed = event.eventStatus !== EVENT_STATUS.scheduled || event.publication !== "published";
  const deadlinePassed = event.rsvpDeadline && event.rsvpDeadline < new Date();
  return (
    <section className="ev-rsvp ev-panel" aria-labelledby="ev-rsvp-title">
      <span className="ev-eyebrow">A place for you</span>
      <h3 id="ev-rsvp-title">
        {closed ? "Replies are closed" : saved ? "Your reply is in" : "Will you be there?"}
      </h3>
      {closed ? (
        <p>
          This event is{" "}
          {event.publication === "draft"
            ? "a private draft"
            : event.eventStatus === EVENT_STATUS.cancelled
              ? "cancelled"
              : "postponed"}
          .
        </p>
      ) : !session && event.visibility !== "link" ? (
        <p>Sign in with your invited WebID to reply.</p>
      ) : (
        <form
          onSubmit={(formEvent) => {
            formEvent.preventDefault();
            const form = new FormData(formEvent.currentTarget);
            const reply: RsvpData = {
              event: entities.Event.subject(event.url),
              ...(session ? { agent: session.webId } : {}),
              displayName: name.trim(),
              guestKey: guestKey.current,
              response,
              additionalGuests: Number(form.get("additionalGuests") ?? 0),
              comment: String(form.get("comment") ?? "").trim(),
              repliedAt: new Date(),
            };
            const generation = ++revision.current;
            setSaved(true);
            setSending(true);
            void appendRsvp(fetch, event, reply).then(
              (result) => {
                if (!live.current) return;
                confirmed.current = true;
                if (generation !== revision.current) return;
                setSending(false);
                onReply(result);
                try {
                  localStorage.setItem(
                    `events:reply:${session?.webId ?? "anonymous"}:${event.url}`,
                    JSON.stringify(reply),
                  );
                } catch {
                  /* Reply is already saved to the pod. */
                }
                toast.success("Your reply has been sent");
              },
              () => {
                if (!live.current || generation !== revision.current) return;
                setSaved(confirmed.current);
                setSending(false);
                toast.error("Couldn't send your reply. Please reconnect and try again.");
              },
            );
          }}
        >
          <fieldset className="ev-response" aria-label="Your response">
            {[
              [RSVP_RESPONSE.yes, "Going", Check],
              [RSVP_RESPONSE.maybe, "Maybe", CircleHelp],
              [RSVP_RESPONSE.no, "Can't go", X],
            ].map(([value, label, Icon]) => {
              const ResponseIcon = Icon as typeof Check;
              return (
                <Button
                  key={String(value)}
                  className="ev-response-option"
                  type="button"
                  variant={response === value ? "default" : "outline"}
                  aria-pressed={response === value}
                  onClick={() => setResponse(value as RsvpData["response"])}
                >
                  <ResponseIcon size={16} aria-hidden="true" />
                  {String(label)}
                </Button>
              );
            })}
          </fieldset>
          <Label htmlFor="ev-guest-name">Your name</Label>
          <Input
            id="ev-guest-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={100}
            autoComplete="name"
          />
          <Label htmlFor="ev-plus">Additional guests</Label>
          <Input
            id="ev-plus"
            name="additionalGuests"
            type="number"
            min={0}
            max={20}
            step={1}
            defaultValue={0}
          />
          <Label htmlFor="ev-comment">A note for the organiser (optional)</Label>
          <Textarea
            id="ev-comment"
            name="comment"
            maxLength={2000}
            placeholder="Anything they should know?"
          />
          {deadlinePassed && (
            <p className="ev-muted">
              The reply deadline has passed. Your reply will be marked late.
            </p>
          )}
          {event.guestListVisible && (
            <p className="ev-muted">
              Your name, response and note will be visible to other guests.
            </p>
          )}
          <Button type="submit" className="ev-full">
            {saved ? "Change your reply" : "Send reply"}
          </Button>
          <p role="status" className="ev-muted">
            {sending
              ? "Sending your reply…"
              : saved
                ? "Your reply is recorded. Unverified replies are shown separately from the verified tally."
                : "Your reply goes directly to the organiser's pod."}
          </p>
        </form>
      )}
    </section>
  );
}
