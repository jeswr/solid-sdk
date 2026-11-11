// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Claude Opus 5.5
"use client";
import {
  bookingTime,
  type ReservationInput,
  reservationKinds,
  type Trip,
} from "@jeswr/solid-trips";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@jeswr/suite-ui";
import { useState } from "react";
import { useTrips } from "../state/trips-context";
export const kindLabels = {
  FlightReservation: "Flight",
  TrainReservation: "Train",
  BusReservation: "Bus",
  LodgingReservation: "Hotel",
  FoodEstablishmentReservation: "Restaurant",
  EventReservation: "Event",
  RentalCarReservation: "Car hire",
};
function TextField({
  name,
  label,
  type = "text",
  value = "",
  required = false,
}: {
  name: string;
  label: string;
  type?: string;
  value?: string | undefined;
  required?: boolean;
}) {
  return (
    <div className="tr-field">
      <Label htmlFor={`tr-${name}`}>{label}</Label>
      <Input id={`tr-${name}`} name={name} type={type} defaultValue={value} required={required} />
    </div>
  );
}
export function TripEditor({ trip, close }: { trip?: Trip | undefined; close: () => void }) {
  const { state } = useTrips();
  const [error, setError] = useState("");
  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="tr-dialog">
        <DialogTitle>{trip ? "Edit trip" : "New trip"}</DialogTitle>
        <DialogDescription>Give your plans a home in your private pod.</DialogDescription>
        <form
          className="tr-form"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const text = (key: string) => String(data.get(key) ?? "").trim();
            if (text("startDate") > text("endDate")) {
              setError("The end date must be on or after the start date.");
              return;
            }
            const patch = {
              name: text("name"),
              destination: text("destination"),
              startDate: text("startDate"),
              endDate: text("endDate"),
              notes: text("notes"),
              cover: text("cover") || undefined,
            };
            if (trip) state.edit(trip.id, patch);
            else state.add({ ...patch, id: `pending:${crypto.randomUUID()}`, reservations: [] });
            close();
          }}
        >
          <TextField name="name" label="Trip name" value={trip?.name} required />
          <TextField name="destination" label="Destination" value={trip?.destination} />
          <div className="tr-fields">
            <TextField
              name="startDate"
              label="Start date"
              type="date"
              value={trip?.startDate}
              required
            />
            <TextField name="endDate" label="End date" type="date" value={trip?.endDate} required />
          </div>
          <TextField name="cover" label="Cover image URL" type="url" value={trip?.cover} />
          <div className="tr-field">
            <Label htmlFor="tr-notes">Notes</Label>
            <Textarea id="tr-notes" name="notes" defaultValue={trip?.notes} />
          </div>
          {error && <p role="alert">{error}</p>}
          <Button type="submit">Save trip</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
export function BookingEditor({ trip, close }: { trip: Trip; close: () => void }) {
  const { state } = useTrips();
  const [kind, setKind] = useState<ReservationInput["kind"]>("FlightReservation");
  const [error, setError] = useState("");
  const transport = [
    "FlightReservation",
    "TrainReservation",
    "BusReservation",
    "RentalCarReservation",
  ].includes(kind);
  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="tr-dialog">
        <DialogTitle>Add a booking</DialogTitle>
        <DialogDescription>
          Use the local times on your confirmation. Include the UTC offset if it is given.
        </DialogDescription>
        <form
          className="tr-form"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const value = (key: string) => String(data.get(key) ?? "").trim() || undefined;
            let start: string | undefined, end: string | undefined;
            try {
              start = bookingTime(value("start") ?? "", value("startOffset"));
              end = bookingTime(value("end") ?? "", value("endOffset"));
              // Local times carry no inferred zone. Compare their calendar/clock values
              // unless both confirmations supplied explicit offsets.
              const bothOffsets =
                !!start &&
                !!end &&
                [start, end].every((time) => /(?:Z|[+-]\d{2}:\d{2})$/.test(time));
              const stamp = (time: string) =>
                Date.parse(bothOffsets ? time : `${time.replace(/(?:Z|[+-]\d{2}:\d{2})$/, "")}Z`);
              if (!start || (end && stamp(end) < stamp(start)))
                throw new Error("Use an end time after the start time");
            } catch {
              setError(
                "Choose valid local times, with the end after the start. Optional UTC offsets look like +01:00 or Z.",
              );
              return;
            }
            state.addBooking(trip.id, {
              kind,
              title: value("title"),
              provider: value("provider"),
              reservationNumber: value("reservationNumber"),
              underName: value("underName"),
              from: value("from"),
              to: value("to"),
              fromCode: value("fromCode"),
              toCode: value("toCode"),
              address: value("address"),
              number: value("number"),
              start,
              end,
              // A manual booking makes no email-markup trust claim; the owner-only manual
              // container is what makes it trusted (see isTrusted).
              status: "http://schema.org/ReservationConfirmed",
            });
            close();
          }}
        >
          <div className="tr-field">
            <Label htmlFor="tr-kind">Booking type</Label>
            <Select
              value={kind}
              onValueChange={(value) => setKind(value as ReservationInput["kind"])}
            >
              <SelectTrigger id="tr-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {reservationKinds.map((value) => (
                  <SelectItem key={value} value={value}>
                    {kindLabels[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <TextField name="title" label="Booking name" required />
          <TextField name="provider" label="Provider" required />
          <div className="tr-fields">
            <TextField name="reservationNumber" label="Confirmation number" />
            <TextField name="underName" label="Booked under" />
          </div>
          {transport ? (
            <>
              <div className="tr-fields">
                <TextField name="from" label="From" />
                <TextField name="to" label="To" />
              </div>
              <TextField name="number" label="Flight, train or bus number" />
              {kind === "FlightReservation" && (
                <div className="tr-fields">
                  <TextField name="fromCode" label="Departure airport code" />
                  <TextField name="toCode" label="Arrival airport code" />
                </div>
              )}
            </>
          ) : (
            <TextField name="address" label="Address" />
          )}
          <TextField
            name="start"
            label={kind === "LodgingReservation" ? "Check-in time" : "Start time"}
            type="datetime-local"
            value={`${trip.startDate}T12:00`}
            required
          />
          <TextField name="startOffset" label="Start UTC offset (optional)" />
          {kind !== "EventReservation" && (
            <>
              <TextField
                name="end"
                type="datetime-local"
                label={kind === "LodgingReservation" ? "Check-out time" : "End time"}
              />
              <TextField name="endOffset" label="End UTC offset (optional)" />
            </>
          )}
          {error && <p role="alert">{error}</p>}
          <Button type="submit">Save booking</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
