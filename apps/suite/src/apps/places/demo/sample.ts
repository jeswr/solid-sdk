// AUTHORED-BY Codex (GPT-6.1 Sol)
import type { TimelineImport } from "@jeswr/solid-places";
/** Merewick is fictional; these Atlantic coordinates are illustrative, never a home address. */
export function sampleWeek(): TimelineImport {
  const places: TimelineImport["places"] = [
    {
      id: "demo-home",
      data: {
        name: "The little blue house",
        address: "Merewick · fictional town",
        latitude: 48.2,
        longitude: -27.4,
        category: "home",
        saved: true,
        notes: "A fictional home for this sample week.",
      },
    },
    {
      id: "demo-cafe",
      data: {
        name: "Fern & Finch café",
        address: "Market Square, Merewick · fictional",
        latitude: 48.204,
        longitude: -27.397,
        category: "food",
        saved: true,
        notes: "Good coffee and a quiet window seat.",
      },
    },
    {
      id: "demo-park",
      data: {
        name: "Willowbank gardens",
        address: "Merewick · fictional",
        latitude: 48.209,
        longitude: -27.389,
        category: "outdoors",
        saved: false,
      },
    },
    {
      id: "demo-library",
      data: {
        name: "Merewick library",
        address: "Merewick · fictional",
        latitude: 48.206,
        longitude: -27.394,
        category: "culture",
        saved: true,
      },
    },
  ];
  const visits: TimelineImport["visits"] = [];
  const journeys: TimelineImport["journeys"] = [];
  for (let day = 5; day <= 11; day++) {
    const date = `2026-11-${String(day).padStart(2, "0")}`;
    const destination = day % 2 === 0 ? places[2]! : places[1]!;
    visits.push(
      {
        id: `demo-${day}-home`,
        placeId: "demo-home",
        data: {
          startTime: new Date(`${date}T07:00:00Z`),
          endTime: new Date(`${date}T09:00:00Z`),
          source: "manual",
        },
      },
      {
        id: `demo-${day}-visit`,
        placeId: destination.id,
        data: {
          startTime: new Date(`${date}T09:20:00Z`),
          endTime: new Date(`${date}T10:15:00Z`),
          source: "check-in",
          confidence: 1,
        },
      },
    );
    journeys.push({
      id: `demo-${day}-walk`,
      data: {
        startTime: new Date(`${date}T09:00:00Z`),
        endTime: new Date(`${date}T09:20:00Z`),
        startLatitude: 48.2,
        startLongitude: -27.4,
        endLatitude: destination.data.latitude,
        endLongitude: destination.data.longitude,
        activityType: day % 2 === 0 ? "cycling" : "walking",
        distance: day % 2 === 0 ? 1500 : 650,
        source: "manual",
      },
    });
  }
  visits.push({
    id: "demo-library-visit",
    placeId: "demo-library",
    data: {
      startTime: new Date("2026-11-11T11:00:00Z"),
      endTime: new Date("2026-11-11T12:00:00Z"),
      source: "manual",
    },
  });
  return { places, visits, journeys, skipped: 0 };
}
