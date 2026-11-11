// AUTHORED-BY Codex (GPT-6.1 Sol)
"use client";
import { Button, EmptyState, ErrorState, LoadingSkeleton, Toaster } from "@jeswr/suite-ui";
import { ArrowUpRight, CalendarDays, LockKeyhole, Plus, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { PodSessionProvider, usePodSessionState } from "@/lib/session/pod-session";
import { AppFrame, AppHeading, AppSessionGuard } from "@/shell/app-frame";
import { type EventFilter, filterInvitations } from "../lib/forms";
import { EventsProvider, useEvents } from "../state/events-context";
import { OrganiserDetail } from "./event-detail";
import { EventForm } from "./event-form";
import "./events.css";

const filters: EventFilter[] = ["Upcoming", "Past", "Drafts", "Cancelled"];
function EventsWorkspace() {
  const { session, controller, events, loading, error, saving } = useEvents();
  const [filter, setFilter] = useState<EventFilter>("Upcoming");
  const [selected, setSelected] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [offline, setOffline] = useState(false);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const online = () => setOffline(!navigator.onLine);
    online();
    window.addEventListener("online", online);
    window.addEventListener("offline", online);
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", online);
      clearInterval(timer);
    };
  }, []);
  const event = events.find((e) => e.url === selected);
  const visible = filterInvitations(events, filter, now);
  return (
    <AppFrame
      app="events"
      sidebar={
        <div className="ev-sidebar">
          <div className="ev-brand">
            <CalendarDays aria-hidden="true" />
            <strong>Events</strong>
          </div>
          <Button onClick={() => setCreating(true)}>
            <Plus size={17} aria-hidden="true" />
            Create invitation
          </Button>
          <nav aria-label="Event collections">
            {filters.map((name) => (
              <Button
                key={name}
                variant={name === filter ? "secondary" : "ghost"}
                aria-current={name === filter ? "page" : undefined}
                onClick={() => {
                  setSelected(undefined);
                  setFilter(name);
                }}
              >
                <span>{name}</span>
                <span>{filterInvitations(events, name, now).length}</span>
              </Button>
            ))}
          </nav>
          <aside className="ev-sidebar-note">
            <LockKeyhole size={19} aria-hidden="true" />
            <strong>Your occasions. Your pod.</strong>
            <p>Invitations and replies live with you. Share only with the people you choose.</p>
          </aside>
        </div>
      }
      actions={
        <Button onClick={() => setCreating(true)}>
          <Plus size={16} aria-hidden="true" />
          New event
        </Button>
      }
    >
      {offline && session.mode !== "demo" && (
        <p className="ev-offline" role="status">
          You're offline. Loaded invitations are still here. Reconnect before sending changes.
        </p>
      )}
      {saving > 0 && (
        <p className="ev-save-status" role="status">
          Saving {saving === 1 ? "invitation" : "invitations"}…
        </p>
      )}
      {event ? (
        <OrganiserDetail event={event} onBack={() => setSelected(undefined)} />
      ) : (
        <main className="ev-page">
          <header className="ev-page-header">
            <div>
              <span className="ev-eyebrow">Make time for each other</span>
              <AppHeading>Your invitations</AppHeading>
              <p className="ev-muted">
                Little occasions. People you love. Something to look forward to.
              </p>
            </div>
            <span className="ev-header-decoration" aria-hidden="true">
              <Sparkles size={33} strokeWidth={1.4} />
            </span>
          </header>
          <fieldset className="ev-mobile-filters" aria-label="Filter invitations">
            {filters.map((name) => (
              <Button
                key={name}
                variant={name === filter ? "default" : "outline"}
                aria-pressed={name === filter}
                onClick={() => setFilter(name)}
              >
                {name}
              </Button>
            ))}
          </fieldset>
          <div className="ev-section-heading">
            <h2>{filter}</h2>
            <span className="ev-muted">
              {visible.length} {visible.length === 1 ? "occasion" : "occasions"}
            </span>
          </div>
          {error && (
            <ErrorState error="unreachable" actions={{ retry: () => void controller.refresh() }}>
              <p>Your loaded invitations are kept while you reconnect.</p>
            </ErrorState>
          )}
          {loading ? (
            <LoadingSkeleton preset="grid" />
          ) : !visible.length ? (
            <EmptyState
              title={
                filter === "Upcoming"
                  ? "Something lovely starts here"
                  : `No ${filter.toLowerCase()} invitations`
              }
              body={
                filter === "Upcoming"
                  ? "Bring your favourite people together. Create an invitation for your next occasion."
                  : "Invitations in this collection will appear here."
              }
              icon={<CalendarDays aria-hidden="true" />}
              primaryAction={
                <Button onClick={() => setCreating(true)}>Create an invitation</Button>
              }
            />
          ) : (
            <div className="ev-cards">
              {visible.map((row, index) => (
                <article
                  key={row.url}
                  className="ev-card"
                  aria-label={row.name}
                  data-style={index % 3}
                >
                  <div className="ev-card-art">
                    <div className="ev-date">
                      <strong>{row.startDate.getDate()}</strong>
                      <span>{row.startDate.toLocaleDateString("en-GB", { month: "short" })}</span>
                    </div>
                    <span className="ev-card-symbol" aria-hidden="true">
                      <CalendarDays size={66} strokeWidth={0.8} />
                    </span>
                    <span className="ev-card-label">
                      {row.publication === "draft" ? "In the making" : "An occasion to remember"}
                    </span>
                  </div>
                  <div className="ev-card-copy">
                    <p className="ev-eyebrow">
                      {row.startDate.toLocaleDateString("en-GB", { weekday: "long" })} ·{" "}
                      {row.startDate.toLocaleTimeString("en-GB", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                    <h3>
                      <button type="button" onClick={() => setSelected(row.url)}>
                        {row.name}
                        <ArrowUpRight size={19} aria-hidden="true" />
                      </button>
                    </h3>
                    <p>
                      {row.location ??
                        (row.onlineUrl ? "Getting together online" : "A place to be confirmed")}
                    </p>
                    <div className="ev-card-footer">
                      <span>
                        <LockKeyhole size={13} aria-hidden="true" />
                        {row.visibility === "link" ? "Link invitation" : "Invitees only"}
                      </span>
                      <Button variant="ghost" size="sm" onClick={() => setSelected(row.url)}>
                        View invitation
                      </Button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
          <footer className="ev-page-footer">
            An invitation is a small thing. The time together isn't.
          </footer>
        </main>
      )}
      <EventForm
        key={creating ? "create" : "closed"}
        open={creating}
        onClose={() => setCreating(false)}
        owner={session.webId}
        onSave={(data, guests) => {
          const url = controller.save(data, guests);
          setSelected(url);
        }}
      />
    </AppFrame>
  );
}
function SessionGate() {
  const state = usePodSessionState();
  if (state.status === "loading")
    return (
      <div className="ev-page">
        <LoadingSkeleton preset="grid" />
      </div>
    );
  if (state.status === "error")
    return (
      <div className="ev-page">
        <ErrorState error="unreachable" />
      </div>
    );
  if (state.status === "signed-out")
    return (
      <div className="ev-page">
        <EmptyState
          title="Sign in to organise an event"
          body="You can still open an invitation link to reply as a guest."
        />
      </div>
    );
  return (
    <EventsProvider
      key={`${state.session.webId}:${state.session.storageUrl}`}
      session={state.session}
    >
      <EventsWorkspace />
    </EventsProvider>
  );
}
export function EventsApp() {
  return (
    <AppSessionGuard>
      <PodSessionProvider>
        <SessionGate />
        <Toaster position="bottom-center" />
      </PodSessionProvider>
    </AppSessionGuard>
  );
}
