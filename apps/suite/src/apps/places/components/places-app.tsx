// AUTHORED-BY Codex (GPT-6.1 Sol)
"use client";
import {
  Button,
  EmptyState,
  ErrorState,
  Input,
  LoadingSkeleton,
  Toaster,
  toast,
} from "@jeswr/suite-ui";
import { CalendarDays, ChartNoAxesColumn, FileUp, LockKeyhole, MapPin } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { type PodSession, PodSessionProvider, usePodSessionState } from "@/lib/session/pod-session";
import { AppFrame, AppHeading, AppSessionGuard } from "@/shell/app-frame";
import { useConnectionState } from "@/shell/sync/connection-state";
import { openPlaces } from "../lib/data";
import { type PlacesController, placesController } from "../state/controller";
import { ImportView } from "./import-view";
import { PlaceDetail, PlacesList, StatsView, TimelineView } from "./views";

type View = "timeline" | "places" | "import" | "stats";
function Connected({ controller, session }: { controller: PlacesController; session: PodSession }) {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const connection = useConnectionState();
  const offline = connection !== "online";
  const [view, setView] = useState<View>("timeline");
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const place = state.snapshot.places.find((item) => item.url === selected);
  useEffect(
    () =>
      session.subscribe((url) => {
        if (url.startsWith(new URL("places/", session.storageUrl).href)) void controller.refresh();
      }),
    [session, controller],
  );
  const nav = [
    { id: "timeline", label: "Timeline", Icon: CalendarDays },
    { id: "places", label: "Places", Icon: MapPin },
    { id: "import", label: "Import", Icon: FileUp },
    { id: "stats", label: "Stats", Icon: ChartNoAxesColumn },
  ] as const;
  return (
    <AppFrame
      app="places"
      context={<span>Places · Private timeline</span>}
      sidebar={
        <div className="pl-sidebar">
          <div className="pl-brand">
            <MapPin aria-hidden="true" />
            <strong>Places</strong>
          </div>
          <p className="pl-muted">A little history of being here.</p>
          <nav aria-label="Places views">
            {nav.map(({ id, label, Icon }) => (
              <Button
                key={id}
                variant={view === id ? "secondary" : "ghost"}
                aria-pressed={view === id}
                onClick={() => setView(id)}
              >
                <Icon size={18} aria-hidden="true" />
                {label}
              </Button>
            ))}
          </nav>
          <div className="pl-privacy">
            <LockKeyhole size={18} aria-hidden="true" />
            <strong>Just for you</strong>
            <p>Your history stays in your pod. Maps are always your choice.</p>
            {session.mode === "demo" && <p>Fictional sample week · Merewick</p>}
          </div>
        </div>
      }
      actions={
        <Button size="sm" onClick={() => setView("import")}>
          <FileUp size={16} aria-hidden="true" />
          Import history
        </Button>
      }
      details={
        state.status === "ready" && place ? (
          <PlaceDetail
            key={place.url}
            place={place}
            snapshot={state.snapshot}
            offline={offline}
            save={(patch) => controller.save(place, patch)}
          />
        ) : undefined
      }
      onDetailsClose={() => setSelected(null)}
    >
      <div className="pl-page">
        {offline && (
          <p role="status" className="pl-notice">
            You’re offline. Places already open stay visible. Reconnect to save or import history.
          </p>
        )}
        {state.status === "loading" ? (
          <>
            <AppHeading>Opening your places</AppHeading>
            <LoadingSkeleton preset="list" label="Loading private places" />
          </>
        ) : state.status === "error" ? (
          <>
            <AppHeading>Your places need attention</AppHeading>
            <ErrorState error="unreachable" actions={{ retry: () => void controller.open() }}>
              <p>{state.error}</p>
            </ErrorState>
          </>
        ) : (
          <>
            <header className="pl-heading">
              <div>
                <p className="pl-eyebrow">YOUR WORLD, REMEMBERED</p>
                <AppHeading>
                  {view === "timeline"
                    ? "Your timeline"
                    : view === "places"
                      ? "Your places"
                      : view === "stats"
                        ? "A sense of distance"
                        : "Bring your history home"}
                </AppHeading>
                <p className="pl-muted">
                  {view === "timeline"
                    ? "The stops and small journeys that made your day."
                    : view === "places"
                      ? "Favourite corners and places you’ve been."
                      : view === "stats"
                        ? "A view of the ground you’ve covered."
                        : "Import an export you already own, straight into your private pod."}
                </p>
              </div>
              <span className="pl-private-pill">
                <LockKeyhole size={14} aria-hidden="true" />
                Owner only
              </span>
            </header>
            {view === "timeline" && <TimelineView snapshot={state.snapshot} select={setSelected} />}
            {view === "places" && (
              <>
                <label className="pl-search" htmlFor="pl-search">
                  Search places
                  <Input
                    type="search"
                    id="pl-search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Name, address or notes"
                  />
                </label>
                <PlacesList snapshot={state.snapshot} query={query} select={setSelected} />
              </>
            )}
            {view === "stats" && <StatsView snapshot={state.snapshot} />}
            {view === "import" && <ImportView controller={controller} offline={offline} />}
            {state.snapshot.places.length === 0 && view !== "import" && (
              <Button variant="outline" onClick={() => setView("import")}>
                Import your first Timeline file
              </Button>
            )}
          </>
        )}
        <p role="status" aria-live="polite" className="pl-saving">
          {state.saving ? "Saving to your private pod…" : ""}
        </p>
      </div>
    </AppFrame>
  );
}
function AccountPlaces({ session }: { session: PodSession }) {
  const [controller, setController] = useState<PlacesController | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt retries opening the selected storage
  useEffect(() => {
    let active = true;
    let store: PlacesController | undefined;
    setError(false);
    setController(null);
    void openPlaces(session).then(
      (repo) => {
        if (!active) return;
        store = placesController(repo, session.mode === "demo", (message) => toast.error(message));
        setController(store);
        void store.open();
      },
      () => {
        if (active) setError(true);
      },
    );
    return () => {
      active = false;
      store?.dispose();
    };
  }, [session, attempt]);
  if (error)
    return (
      <div className="pl-page">
        <AppHeading>Can’t open Places</AppHeading>
        <ErrorState
          error="unreachable"
          actions={{ retry: () => setAttempt((value) => value + 1) }}
        />
      </div>
    );
  return controller ? (
    <Connected controller={controller} session={session} />
  ) : (
    <div className="pl-page">
      <LoadingSkeleton preset="list" label="Opening Places" />
    </div>
  );
}
function SessionPlaces() {
  const result = usePodSessionState();
  if (result.status === "loading")
    return <LoadingSkeleton preset="list" label="Opening Places session" />;
  if (result.status === "signed-out")
    return (
      <EmptyState
        title="Sign in to open your places"
        body="Your private timeline will be here when you sign in."
      />
    );
  if (result.status === "error")
    return <ErrorState error="unreachable" actions={{ retry: () => location.reload() }} />;
  return (
    <AccountPlaces
      key={`${result.session.webId}:${result.session.storageUrl}`}
      session={result.session}
    />
  );
}
export function PlacesApp() {
  return (
    <AppSessionGuard>
      <PodSessionProvider>
        <SessionPlaces />
        <Toaster />
      </PodSessionProvider>
    </AppSessionGuard>
  );
}
