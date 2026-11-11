// AUTHORED-BY Codex (GPT-6.1 Sol)
export const reservationKinds = [
  "FlightReservation",
  "TrainReservation",
  "BusReservation",
  "LodgingReservation",
  "FoodEstablishmentReservation",
  "EventReservation",
  "RentalCarReservation",
] as const;
export type ReservationKind = (typeof reservationKinds)[number];
export interface Trip {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  destination?: string | undefined;
  notes?: string | undefined;
  cover?: string | undefined;
  reservations: string[];
  created?: string | undefined;
  modified?: string | undefined;
  archived?: boolean | undefined;
  etag?: string | null | undefined;
}
export interface ReservationInput {
  kind: ReservationKind;
  reservationNumber?: string | undefined;
  provider?: string | undefined;
  underName?: string | undefined;
  status?: string | undefined;
  title?: string | undefined;
  number?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  fromCode?: string | undefined;
  toCode?: string | undefined;
  location?: string | undefined;
  address?: string | undefined;
  fromAddress?: string | undefined;
  toAddress?: string | undefined;
  start?: string | undefined;
  end?: string | undefined;
  modified?: string | undefined;
  source?: string | undefined;
  trust?: "verified" | "unverified" | undefined;
}
export interface Reservation extends ReservationInput {
  id: string;
  etag?: string | null | undefined;
}
export type ExtractMarkup = (html: string) => Promise<ReservationInput[]>;
export interface ReadNotice {
  skipped: number;
  capped: boolean;
}
export interface TripSnapshot {
  notice?: ReadNotice | undefined;
  trips: Trip[];
  reservations: Reservation[];
}
