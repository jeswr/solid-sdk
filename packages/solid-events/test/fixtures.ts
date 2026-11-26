// AUTHORED-BY Codex GPT-6
import { EVENT_STATUS, type EventData, RSVP_RESPONSE, type RsvpData } from "../src/index.js";
export const event: EventData = {
  name: "Lantern supper",
  startDate: new Date("2027-02-01T18:00:00Z"),
  organizer: "https://host.example/profile#me",
  eventStatus: EVENT_STATUS.scheduled,
  guestListVisible: false,
  visibility: "link",
  publication: "published",
  created: new Date("2026-11-11T12:00:00Z"),
  modified: new Date("2026-11-11T12:00:00Z"),
};
export const rsvp: RsvpData = {
  agent: "https://guest.example/profile#me",
  event: "https://host.example/events/1/index.ttl#it",
  response: RSVP_RESPONSE.yes,
  additionalGuests: 1,
  repliedAt: new Date("2026-11-12T12:00:00Z"),
};
