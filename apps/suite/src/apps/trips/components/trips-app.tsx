// AUTHORED-BY Codex (GPT-6.1 Sol)
"use client";
import { itinerary, type Reservation, type Trip } from "@jeswr/solid-trips";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  EmptyState,
  ErrorState,
  IconButton,
  LoadingSkeleton,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Toaster,
  toast,
} from "@jeswr/suite-ui";
import {
  ArrowLeft,
  Bus,
  Car,
  Check,
  Copy,
  Hotel,
  LockKeyhole,
  MapPin,
  Plane,
  Plus,
  ScanLine,
  Ticket,
  TrainFront,
  Utensils,
} from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { PodSessionProvider, usePodSessionState } from "@/lib/session/pod-session";
import { AppFrame, AppHeading, AppSessionGuard } from "@/shell/app-frame";
import { useConnectionState } from "@/shell/sync/connection-state";
import { RequiresOnline } from "@/shell/sync/requires-online";
import { TripsProvider, useTrips } from "../state/trips-context";
import { BookingEditor, kindLabels, TripEditor } from "./editors";
import "./trips.css";

const icons = {
  FlightReservation: Plane,
  TrainReservation: TrainFront,
  BusReservation: Bus,
  LodgingReservation: Hotel,
  RentalCarReservation: Car,
  FoodEstablishmentReservation: Utensils,
  EventReservation: Ticket,
};
function LocalTime({ value }: { value?: string | undefined }) {
  return value ? (
    <time dateTime={value}>
      {value.slice(11, 16)}
      {value.endsWith("Z")
        ? " UTC"
        : /[+-]\d{2}:\d{2}$/.test(value)
          ? ` UTC${value.slice(-6)}`
          : " local time"}
    </time>
  ) : (
    <span>Time not provided</span>
  );
}
function BookingCard({ item, trip }: { item: Reservation; trip: Trip }) {
  const { trips, state } = useTrips();
  const Icon = icons[item.kind];
  return (
    <article className="tr-booking" aria-label={item.title ?? kindLabels[item.kind]}>
      <div className="tr-type-icon">
        <Icon size={22} aria-hidden="true" />
      </div>
      <div className="tr-booking-main">
        <div className="tr-card-top">
          <span className="tr-eyebrow">{kindLabels[item.kind]}</span>
          {item.trust !== "verified" && <Badge variant="outline">Unverified sender</Badge>}
        </div>
        <h3>
          {item.title ??
            (item.from || item.to
              ? `${item.from ?? item.fromCode ?? "Departure"} → ${item.to ?? item.toCode ?? "Arrival"}`
              : kindLabels[item.kind])}
        </h3>
        <p>
          {item.provider}
          {item.number ? ` · ${item.number}` : ""}
        </p>
        {(item.fromCode || item.toCode) && (
          <p>
            {item.fromCode} → {item.toCode}
          </p>
        )}
        <p className="tr-time">
          <LocalTime value={item.start} />
          {item.end && (
            <>
              {" "}
              → <LocalTime value={item.end} />
              {item.end.slice(0, 10) !== item.start?.slice(0, 10) && ` (${item.end.slice(0, 10)})`}
            </>
          )}
        </p>
        {item.address && <p>{item.address}</p>}
        {item.underName && <p>Booked under {item.underName}</p>}
        {item.reservationNumber && (
          <div className="tr-confirmation">
            <span>
              Confirmation <strong>{item.reservationNumber}</strong>
            </span>
            <IconButton
              variant="ghost"
              label={`Copy confirmation ${item.reservationNumber}`}
              onClick={() => {
                void navigator.clipboard.writeText(item.reservationNumber as string).then(
                  () => toast.success("Confirmation copied"),
                  () => toast.error("Couldn't copy. You can select the confirmation number."),
                );
              }}
            >
              <Copy size={16} aria-hidden="true" />
            </IconButton>
          </div>
        )}
        {trips.filter((entry) => entry.id !== trip.id && !entry.archived).length > 0 && (
          <Select value="" onValueChange={(target) => state.move(item.id, trip.id, target)}>
            <SelectTrigger
              aria-label={`Move ${item.reservationNumber ?? item.title ?? "booking"} to another trip`}
            >
              <SelectValue placeholder="Move to another trip" />
            </SelectTrigger>
            <SelectContent>
              {trips
                .filter((entry) => entry.id !== trip.id && !entry.archived)
                .map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    {entry.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        )}
      </div>
    </article>
  );
}
function Workspace() {
  const { trips, reservations, store, state, saving, error, session } = useTrips();
  const [tab, setTab] = useState<"upcoming" | "past" | "archive">("upcoming");
  const [selected, setSelected] = useState<string>();
  const [editing, setEditing] = useState<Trip | "new">();
  const [booking, setBooking] = useState(false);
  const [importing, setImporting] = useState(false);
  const [scan, setScan] = useState<Awaited<ReturnType<typeof store.scan>>>();
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const online = useConnectionState() === "online";
  const today = new Date().toISOString().slice(0, 10);
  const trip = trips.find((item) => item.id === (selected ? state.resolveId(selected) : undefined));
  const visible = trips
    .filter((item) =>
      tab === "archive"
        ? item.archived
        : !item.archived && (tab === "past" ? item.endDate < today : item.endDate >= today),
    )
    .sort((a, b) =>
      tab === "past"
        ? b.startDate.localeCompare(a.startDate)
        : a.startDate.localeCompare(b.startDate),
    );
  const suggestions =
    scan?.suggestions.filter(
      (item) =>
        !dismissed.has(item.id) &&
        !item.reservations.some((id) => trips.some((entry) => entry.reservations.includes(id))),
    ) ?? [];
  function runScan() {
    setScanning(true);
    setScanError(false);
    void store
      .scan(trips, reservations)
      .then(setScan, () => {
        setScanError(true);
      })
      .finally(() => setScanning(false));
  }
  const sidebar = (
    <div className="tr-sidebar">
      <div className="tr-brand">
        <Plane size={24} aria-hidden="true" />
        <strong>Trips</strong>
      </div>
      <p>
        All your plans.
        <br />
        One place to land.
      </p>
      <nav aria-label="Trips views">
        {(["upcoming", "past", "archive"] as const).map((value) => (
          <Button
            key={value}
            variant={tab === value ? "secondary" : "ghost"}
            aria-pressed={tab === value}
            onClick={() => {
              setTab(value);
              setSelected(undefined);
            }}
          >
            {value === "upcoming" ? "Upcoming" : value === "past" ? "Past trips" : "Archive"}
          </Button>
        ))}
      </nav>
      <div className="tr-private">
        <LockKeyhole size={16} aria-hidden="true" />
        <span>Stored in your pod</span>
        {session.mode === "demo" && <p>Fictional sample trips</p>}
      </div>
    </div>
  );
  return (
    <AppFrame
      app="trips"
      sidebar={sidebar}
      actions={
        <Button onClick={() => setEditing("new")}>
          <Plus size={16} aria-hidden="true" />
          New trip
        </Button>
      }
      context={<span>Your travel, together</span>}
    >
      <div className="tr-page">
        <div className="tr-toolbar">
          <div>
            <p className="tr-eyebrow">A little less travel admin</p>
            <AppHeading>
              {trip?.name ??
                (tab === "upcoming"
                  ? "Where to next?"
                  : tab === "past"
                    ? "Places you've been"
                    : "Archived trips")}
            </AppHeading>
            <p className="tr-muted">
              {trip
                ? `${trip.startDate} – ${trip.endDate} · ${trip.destination ?? "Your itinerary"}`
                : "Keep confirmations close and enjoy the journey."}
            </p>
          </div>
          <div className="tr-actions">
            <RequiresOnline>
              <Button variant="outline" onClick={runScan} disabled={scanning}>
                <ScanLine size={16} aria-hidden="true" />
                {scanning ? "Scanning…" : "Scan my pod"}
              </Button>
            </RequiresOnline>
            <Button variant="ghost" onClick={() => setImporting(true)}>
              Paste an email
            </Button>
          </div>
        </div>
        {!online && (
          <p className="tr-notice" role="status">
            You're offline. You can view this itinerary. Changes that cannot reach your pod will be
            rolled back.
          </p>
        )}
        <p className="tr-save" role="status" aria-live="polite">
          {saving ? "Saving to your pod…" : (error ?? "")}
        </p>
        {scanning && <LoadingSkeleton preset="list" label="Looking for booking confirmations" />}
        {scanError && (
          <ErrorState error="unreachable" actions={{ retry: runScan }}>
            <p>The scan could not finish. No partial suggestions were accepted.</p>
          </ErrorState>
        )}
        {scan && !scanning && (
          <section className="tr-suggestions" aria-label="Suggested trips">
            <h2>Suggested trips</h2>
            {!suggestions.length ? (
              <p>
                {scan.sources
                  ? "You're all caught up. No new trips to suggest."
                  : "No registered booking sources yet. Connect your mail when reservation extraction becomes available."}
              </p>
            ) : (
              suggestions.map((suggestion) => (
                <article key={suggestion.id}>
                  <div>
                    <h3>{suggestion.name}</h3>
                    <p>
                      {suggestion.startDate} – {suggestion.endDate} ·{" "}
                      {suggestion.reservations.length} bookings
                    </p>
                  </div>
                  <div className="tr-actions">
                    <Button onClick={() => state.accept(suggestion, scan.reservations)}>
                      <Check size={16} aria-hidden="true" />
                      Accept trip
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() =>
                        setDismissed((previous) => new Set([...previous, suggestion.id]))
                      }
                    >
                      Dismiss
                    </Button>
                  </div>
                </article>
              ))
            )}
          </section>
        )}
        {trip ? (
          <>
            <div className="tr-detail-actions">
              <Button variant="ghost" onClick={() => setSelected(undefined)}>
                <ArrowLeft size={16} aria-hidden="true" />
                All trips
              </Button>
              <Button variant="outline" onClick={() => setEditing(trip)}>
                Edit trip
              </Button>
              <Button
                variant="outline"
                onClick={() => state.edit(trip.id, { archived: !trip.archived })}
              >
                {trip.archived ? "Restore trip" : "Archive trip"}
              </Button>
              <Button onClick={() => setBooking(true)}>Add booking</Button>
            </div>
            {trip.notes && <p className="tr-notes">{trip.notes}</p>}
            {itinerary(trip, reservations).length ? (
              itinerary(trip, reservations).map((day) => (
                <section className="tr-day" key={day.date}>
                  <h2>
                    {day.date === "Undated"
                      ? "Date not provided"
                      : new Intl.DateTimeFormat("en-GB", {
                          weekday: "long",
                          day: "numeric",
                          month: "long",
                          timeZone: "UTC",
                        }).format(new Date(`${day.date}T12:00:00Z`))}
                  </h2>
                  {day.items.map((item) => (
                    <BookingCard key={item.id} item={item} trip={trip} />
                  ))}
                </section>
              ))
            ) : (
              <EmptyState
                title="A fresh itinerary"
                body="Add your first booking, then keep the rest of your plans here."
                primaryAction={<Button onClick={() => setBooking(true)}>Add booking</Button>}
              />
            )}
          </>
        ) : visible.length ? (
          <div className="tr-grid">
            {visible.map((item) => (
              <article key={item.id} className="tr-trip">
                <div className="tr-trip-art">
                  {item.cover && /^https?:\/\//.test(item.cover) && (
                    <Image
                      src={item.cover}
                      alt=""
                      fill
                      unoptimized
                      sizes="(max-width: 600px) 100vw, 500px"
                      referrerPolicy="no-referrer"
                    />
                  )}
                  <MapPin size={36} strokeWidth={1.25} aria-hidden="true" />
                  <span>{item.destination ?? "Your next adventure"}</span>
                </div>
                <div className="tr-trip-body">
                  <p className="tr-eyebrow">
                    {item.startDate} – {item.endDate}
                  </p>
                  <h2>
                    <button type="button" onClick={() => setSelected(item.id)}>
                      {item.name}
                    </button>
                  </h2>
                  <p>
                    {item.reservations.length}{" "}
                    {item.reservations.length === 1 ? "booking" : "bookings"}
                  </p>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            title={
              tab === "past" ? "Memories start with a trip" : "Your next adventure starts here"
            }
            body="Create a trip or scan your pod for booking confirmations."
            primaryAction={<Button onClick={() => setEditing("new")}>Create a trip</Button>}
          />
        )}
      </div>
      {editing && (
        <TripEditor
          trip={editing === "new" ? undefined : editing}
          close={() => setEditing(undefined)}
        />
      )}
      {booking && trip && <BookingEditor trip={trip} close={() => setBooking(false)} />}
      <Dialog open={importing} onOpenChange={setImporting}>
        <DialogContent>
          <DialogTitle>Email import is coming soon</DialogTitle>
          <DialogDescription>
            The mail connector will safely extract booking details from your confirmations. You can
            add a booking manually today.
          </DialogDescription>
          <Button onClick={() => setImporting(false)}>Got it</Button>
        </DialogContent>
      </Dialog>
      <Toaster />
    </AppFrame>
  );
}
function Opening({ failed = false, retry }: { failed?: boolean; retry?: () => void }) {
  return (
    <AppFrame app="trips" sidebar={<p>Trips</p>}>
      <div className="tr-page">
        <AppHeading>Your trips</AppHeading>
        {failed ? (
          <ErrorState error="unreachable" actions={retry ? { retry } : undefined}>
            <p>We couldn't open private Trips storage. Check your connection and permissions.</p>
          </ErrorState>
        ) : (
          <LoadingSkeleton preset="grid" label="Opening your private itinerary" />
        )}
      </div>
    </AppFrame>
  );
}
function Session() {
  const session = usePodSessionState();
  if (session.status !== "ready")
    return <Opening failed={session.status === "error"} retry={() => window.location.reload()} />;
  return (
    <TripsProvider
      key={`${session.session.webId}:${session.session.storageUrl}`}
      session={session.session}
      fallback={(failed, retry) => <Opening failed={failed} retry={retry} />}
    >
      <Workspace />
    </TripsProvider>
  );
}
export function TripsApp() {
  return (
    <AppSessionGuard>
      <PodSessionProvider>
        <Session />
      </PodSessionProvider>
    </AppSessionGuard>
  );
}
