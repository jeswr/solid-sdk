// AUTHORED-BY Codex (GPT-6.1 Sol)
"use client";
import {
  CATEGORIES,
  dayBounds,
  entities,
  mapLinks,
  type PlaceData,
  type PlacesSnapshot,
  periodBounds,
  periodStats,
  placeVisitIndex,
  type RecordValue,
  timelineForDay,
} from "@jeswr/solid-places";
import {
  Button,
  EmptyState,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@jeswr/suite-ui";
import { ArrowUpRight, Bike, Footprints, MapPin, Star } from "lucide-react";
import { useMemo, useState } from "react";

const time = (date: Date) =>
  date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
const date = (value: Date) =>
  value.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
const distance = (metres: number) =>
  metres >= 1000
    ? `${(metres / 1000).toLocaleString("en-GB", { maximumFractionDigits: 1 })} km`
    : `${Math.round(metres)} m`;
function recentDay(snapshot: PlacesSnapshot) {
  let latest = "";
  for (const { data } of [...snapshot.visits, ...snapshot.journeys]) {
    const day = data.startTime.toISOString().slice(0, 10);
    if (day > latest) latest = day;
  }
  return latest || new Date().toISOString().slice(0, 10);
}
function Category({
  value,
  change,
  label,
}: {
  value: string;
  change: (value: string) => void;
  label: string;
}) {
  return (
    <Select value={value} onValueChange={change}>
      <SelectTrigger aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {value === "all" && <SelectItem value="all">All categories</SelectItem>}
        {CATEGORIES.map((category) => (
          <SelectItem value={category} key={category}>
            {category[0]!.toUpperCase() + category.slice(1)}
          </SelectItem>
        ))}
        {value !== "all" && label === "Filter by category" && (
          <SelectItem value="all">All categories</SelectItem>
        )}
      </SelectContent>
    </Select>
  );
}
export function TimelineView({
  snapshot,
  select,
}: {
  snapshot: PlacesSnapshot;
  select: (url: string) => void;
}) {
  const [chosen, setChosen] = useState("");
  const day = chosen || recentDay(snapshot);
  const rows = timelineForDay(snapshot, day);
  const bounds = dayBounds(day);
  const places = new Map(
    snapshot.places.map((place) => [entities.Place.subject(place.url), place]),
  );
  return (
    <section aria-label="Timeline by day">
      <div className="pl-toolbar">
        <label htmlFor="pl-day">
          Day
          <Input
            id="pl-day"
            type="date"
            value={day}
            onChange={(event) => setChosen(event.target.value)}
          />
        </label>
        <p className="pl-muted">
          Times shown in UTC · {rows.filter((row) => row.kind === "visit").length} visits
        </p>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          title="A quiet page in your timeline"
          body="There’s no history for this day. Try another date or import a Timeline export."
        />
      ) : (
        <ol className="pl-timeline" aria-label="Day’s visits and journeys">
          {rows.map((row) => {
            const start = new Date(Math.max(+row.data.startTime, +bounds.start));
            const end = new Date(Math.min(+row.data.endTime, +bounds.end));
            const minutes = Math.round((+end - +start) / 60000);
            const duration =
              minutes >= 60
                ? `${Math.floor(minutes / 60)} h ${minutes % 60} min`
                : `${minutes} min`;
            const place = row.kind === "visit" ? places.get(row.data.place) : undefined;
            return (
              <li key={row.url} className={`pl-event pl-event-${row.kind}`}>
                <div className="pl-event-time">
                  <time dateTime={start.toISOString()}>{time(start)}</time>
                  <span>{time(end)}</span>
                </div>
                <span className="pl-event-icon" aria-hidden="true">
                  {row.kind === "visit" ? (
                    <MapPin size={20} />
                  ) : row.data.activityType === "cycling" ? (
                    <Bike size={20} />
                  ) : (
                    <Footprints size={20} />
                  )}
                </span>
                <div className="pl-event-content">
                  {row.kind === "visit" ? (
                    <>
                      <Button
                        variant="link"
                        onClick={() => place && select(place.url)}
                        disabled={!place}
                      >
                        {place?.data.name ?? "Unknown place"}
                      </Button>
                      <p className="pl-muted">{place?.data.address ?? "Private visit"}</p>
                      <p>
                        {duration} · {row.data.source.replaceAll("-", " ")}
                        {row.data.confidence !== undefined
                          ? ` · ${Math.round(row.data.confidence * 100)}% confidence`
                          : ""}
                      </p>
                    </>
                  ) : (
                    <>
                      <h3>
                        {row.data.activityType[0]!.toUpperCase() + row.data.activityType.slice(1)}
                      </h3>
                      <p className="pl-muted">
                        {distance(row.data.distance)} · {duration}
                      </p>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
export function PlacesList({
  snapshot,
  query,
  select,
}: {
  snapshot: PlacesSnapshot;
  query: string;
  select: (url: string) => void;
}) {
  const [category, setCategory] = useState("all");
  const [saved, setSaved] = useState(false);
  const index = useMemo(() => placeVisitIndex(snapshot), [snapshot]);
  const rows = snapshot.places
    .filter(
      ({ data }) =>
        (category === "all" || data.category === category) &&
        (!saved || data.saved) &&
        `${data.name} ${data.address ?? ""} ${data.notes ?? ""}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) => a.data.name.localeCompare(b.data.name));
  return (
    <section aria-label="Places collection">
      <div className="pl-toolbar">
        <Category value={category} change={setCategory} label="Filter by category" />
        <Button
          variant={saved ? "secondary" : "outline"}
          aria-pressed={saved}
          onClick={() => setSaved((value) => !value)}
        >
          <Star size={16} aria-hidden="true" />
          Saved places
        </Button>
        <span className="pl-muted">{rows.length} places</span>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          title="No places to show"
          body="Try changing your search or filters, or import your first history file."
        />
      ) : (
        <div className="pl-place-grid">
          {rows.map((place) => {
            const stats = index.get(entities.Place.subject(place.url));
            return (
              <article key={place.url} className="pl-place-card">
                <div className="pl-card-icon">
                  <MapPin size={24} aria-hidden="true" />
                  {place.data.saved && <Star size={14} aria-label="Saved" />}
                </div>
                <p className="pl-eyebrow">{place.data.category}</p>
                <h3>
                  <Button variant="link" onClick={() => select(place.url)}>
                    {place.data.name}
                  </Button>
                </h3>
                <p className="pl-muted">{place.data.address ?? "No address added"}</p>
                <p>
                  {stats?.count ?? 0} visits{stats ? ` · Last ${date(stats.last)}` : ""}
                </p>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
export function PlaceDetail({
  place,
  snapshot,
  offline,
  save,
}: {
  place: RecordValue<PlaceData>;
  snapshot: PlacesSnapshot;
  offline: boolean;
  save: (patch: Partial<Pick<PlaceData, "name" | "category" | "notes" | "saved">>) => Promise<void>;
}) {
  const [name, setName] = useState(place.data.name);
  const [notes, setNotes] = useState(place.data.notes ?? "");
  const [category, setCategory] = useState(place.data.category);
  const [map, setMap] = useState(false);
  const links = mapLinks(place.data.latitude, place.data.longitude);
  const visits = snapshot.visits
    .filter((item) => item.data.place === entities.Place.subject(place.url))
    .sort((a, b) => +b.data.startTime - +a.data.startTime);
  return (
    <section className="pl-detail" aria-label="Place details">
      <p className="pl-eyebrow">A PLACE IN YOUR STORY</p>
      <h2>{place.data.name}</h2>
      <p className="pl-muted">{place.data.address}</p>
      <Button
        variant="outline"
        disabled={offline}
        aria-pressed={place.data.saved}
        onClick={() => void save({ saved: !place.data.saved })}
      >
        <Star size={16} aria-hidden="true" />
        {place.data.saved ? "Saved place" : "Save place"}
      </Button>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const patch: Partial<Pick<PlaceData, "name" | "category" | "notes">> = {};
          if (name.trim() !== place.data.name) patch.name = name.trim();
          if (notes !== (place.data.notes ?? "")) patch.notes = notes;
          if (category !== place.data.category) patch.category = category;
          void save(patch);
        }}
      >
        <Label htmlFor="pl-place-name">Name</Label>
        <Input
          id="pl-place-name"
          value={name}
          required
          maxLength={256}
          onChange={(event) => setName(event.target.value)}
          disabled={offline}
        />
        <Label>Category</Label>
        <Category
          value={category}
          change={(value) => setCategory(value as PlaceData["category"])}
          label="Place category"
        />
        <Label htmlFor="pl-place-notes">Notes</Label>
        <Textarea
          id="pl-place-notes"
          value={notes}
          maxLength={10000}
          onChange={(event) => setNotes(event.target.value)}
          disabled={offline}
        />
        <Button type="submit" disabled={offline || !name.trim()}>
          Save changes
        </Button>
      </form>
      <div className="pl-map">
        <h3>Your choice to explore</h3>
        <p className="pl-muted" id="pl-map-notice">
          OpenStreetMap will see this place’s coordinates when you show the map or open the link.
        </p>
        <Button
          variant="outline"
          aria-pressed={map}
          aria-describedby="pl-map-notice"
          disabled={offline && !map}
          onClick={() => setMap((value) => !value)}
        >
          {map ? "Hide map" : "Show on map"}
        </Button>
        {map && (
          <iframe
            title={`Map of ${place.data.name}`}
            src={links.embed}
            referrerPolicy="no-referrer"
            sandbox="allow-scripts allow-same-origin"
            loading="lazy"
          />
        )}
        <a href={links.open} target="_blank" rel="noopener noreferrer">
          Open {place.data.name} in OpenStreetMap <ArrowUpRight size={14} aria-hidden="true" />
        </a>
      </div>
      <h3>{visits.length} visits</h3>
      {visits.length === 0 ? (
        <p className="pl-muted">No visits recorded yet.</p>
      ) : (
        <ol className="pl-visits">
          {visits.map(({ url, data }) => (
            <li key={url}>
              <strong>{date(data.startTime)}</strong>
              <p>
                {time(data.startTime)}–{time(data.endTime)} UTC ·{" "}
                {Math.round((+data.endTime - +data.startTime) / 60000)} min
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
export function StatsView({ snapshot }: { snapshot: PlacesSnapshot }) {
  const [unit, setUnit] = useState("month");
  const [chosen, setChosen] = useState("");
  const recent = recentDay(snapshot);
  const value = chosen || (unit === "month" ? recent.slice(0, 7) : recent.slice(0, 4));
  let stats: ReturnType<typeof periodStats> | undefined;
  try {
    stats = periodStats(snapshot, periodBounds(value));
  } catch {}
  return (
    <section aria-label="Places statistics">
      <div className="pl-toolbar">
        <Select
          value={unit}
          onValueChange={(next) => {
            setUnit(next);
            setChosen("");
          }}
        >
          <SelectTrigger aria-label="Statistics period">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="month">Month</SelectItem>
            <SelectItem value="year">Year</SelectItem>
          </SelectContent>
        </Select>
        <label htmlFor="pl-period">
          {unit === "month" ? "Month" : "Year"}
          <Input
            id="pl-period"
            type={unit === "month" ? "month" : "number"}
            min={unit === "year" ? "100" : "0100-01"}
            max={unit === "year" ? "9998" : "9998-12"}
            value={value}
            onChange={(event) => setChosen(event.target.value)}
          />
        </label>
      </div>
      {!stats ? (
        <p role="status">Choose a valid {unit} to see your statistics.</p>
      ) : (
        <>
          <div className="pl-stats">
            <article>
              <p className="pl-muted">Places visited</p>
              <strong>{stats.placesVisited}</strong>
            </article>
            <article>
              <p className="pl-muted">Visits</p>
              <strong>{stats.visits}</strong>
            </article>
            <article>
              <p className="pl-muted">Distance travelled</p>
              <strong>
                {distance(Object.values(stats.distanceByMode).reduce((a, b) => a + b, 0))}
              </strong>
            </article>
          </div>
          <h3>Distance by mode</h3>
          {Object.keys(stats.distanceByMode).length === 0 ? (
            <EmptyState
              title="No journeys this period"
              body="Import some activity segments to see distance by mode."
            />
          ) : (
            <ul className="pl-mode-list">
              {Object.entries(stats.distanceByMode)
                .sort((a, b) => b[1] - a[1])
                .map(([mode, metres]) => (
                  <li key={mode}>
                    <span>{mode[0]!.toUpperCase() + mode.slice(1)}</span>
                    <strong>{distance(metres)}</strong>
                  </li>
                ))}
            </ul>
          )}
          <p className="pl-muted">
            UTC periods. Distance across a period boundary is estimated from elapsed time.
          </p>
        </>
      )}
    </section>
  );
}
