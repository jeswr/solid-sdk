// AUTHORED-BY Codex GPT-6.1-Sol
/** Synthetic transactional mail: reserved example.test domains, invented bookings and places. */
const organization = (name: string) => ({ "@type": "Organization", name });
export const EMAIL_MARKUP_FIXTURES = [
  {
    "@type": "Order",
    orderNumber: "TEST-ORDER-42",
    seller: organization("Example Retail"),
    price: "39.95",
    priceCurrency: "GBP",
    acceptedOffer: {
      "@type": "Offer",
      price: "39.95",
      itemOffered: { "@type": "Product", name: "Blue travel mug", sku: "MUG-BLUE" },
    },
    orderedItem: {
      "@type": "OrderItem",
      orderItemNumber: "1",
      orderQuantity: "1",
      orderedItem: { "@type": "Product", name: "Blue travel mug" },
    },
    orderDelivery: {
      "@type": "ParcelDelivery",
      trackingNumber: "TEST-PARCEL-42",
      carrier: organization("Example Post"),
      deliveryAddress: {
        "@type": "PostalAddress",
        streetAddress: "1 Example Road",
        postalCode: "TEST 1AA",
      },
    },
  },
  {
    "@type": "ParcelDelivery",
    trackingNumber: "TEST-PARCEL-42",
    carrier: organization("Example Post"),
    expectedArrivalFrom: "2026-12-01T09:00:00Z",
    trackingUrl: "https://delivery.example.test/track/42",
    itemShipped: { "@type": "Product", name: "Blue travel mug" },
  },
  {
    "@type": "FlightReservation",
    reservationNumber: "TEST-FLIGHT-42",
    provider: organization("Example Air"),
    reservationStatus: "https://schema.org/ReservationConfirmed",
    underName: { "@type": "Person", name: "Example Traveller" },
    reservationFor: {
      "@type": "Flight",
      flightNumber: "EX42",
      airline: organization("Example Air"),
      departureAirport: { "@type": "Airport", name: "Example North", iataCode: "AAA" },
      arrivalAirport: { "@type": "Airport", name: "Example South", iataCode: "BBB" },
      departureTime: "2026-12-01T09:00:00Z",
    },
  },
  {
    "@type": "TrainReservation",
    reservationNumber: "TEST-TRAIN-42",
    provider: organization("Example Rail"),
    reservationFor: {
      "@type": "TrainTrip",
      trainNumber: "42",
      departureStation: { "@type": "Place", name: "Example Central" },
      arrivalStation: { "@type": "Place", name: "Example Coast" },
      departureTime: "2026-12-01T10:00:00Z",
    },
  },
  {
    "@type": "BusReservation",
    reservationNumber: "TEST-BUS-42",
    provider: organization("Example Coach"),
    reservationFor: {
      "@type": "BusTrip",
      busNumber: "42",
      departureBusStop: { "@type": "Place", name: "Example Square" },
      arrivalBusStop: { "@type": "Place", name: "Example Park" },
    },
  },
  {
    "@type": "LodgingReservation",
    reservationNumber: "TEST-HOTEL-42",
    provider: organization("Example Hotels"),
    checkinTime: "2026-12-01T15:00:00Z",
    checkoutTime: "2026-12-02T11:00:00Z",
    numAdults: "2",
    reservationFor: {
      "@type": "Hotel",
      name: "Example Hotel",
      address: {
        "@type": "PostalAddress",
        streetAddress: "2 Example Road",
        addressLocality: "Example Town",
      },
    },
  },
  {
    "@type": "FoodEstablishmentReservation",
    reservationNumber: "TEST-FOOD-42",
    provider: organization("Example Dining"),
    startTime: "2026-12-01T19:00:00Z",
    partySize: "2",
    reservationFor: { "@type": "Restaurant", name: "Example Table", telephone: "+12025550100" },
  },
  {
    "@type": "EventReservation",
    reservationNumber: "TEST-EVENT-42",
    provider: organization("Example Tickets"),
    reservationFor: {
      "@type": "Event",
      name: "Example Concert",
      startDate: "2026-12-01T20:00:00Z",
      location: { "@type": "Place", name: "Example Hall" },
    },
    reservedTicket: {
      "@type": "Ticket",
      ticketNumber: "TEST-TICKET-42",
      ticketedSeat: { "@type": "Seat", seatRow: "A", seatNumber: "12" },
    },
  },
  {
    "@type": "RentalCarReservation",
    reservationNumber: "TEST-CAR-42",
    provider: organization("Example Rentals"),
    pickupTime: "2026-12-01T12:00:00Z",
    dropoffTime: "2026-12-02T12:00:00Z",
    pickupLocation: { "@type": "Place", name: "Example Airport" },
    reservationFor: { "@type": "RentalCar", name: "Example compact", model: "Compact" },
  },
] as const;
export function jsonLdFixture(value: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(value)}</script>`;
}
/** Fixture renderer only, independent of extraction: emits explicit metadata value attributes. */
export function microdataFixture(node: object, property?: string): string {
  const entries = Object.entries(node);
  const type = entries.find(([key]) => key === "@type")?.[1];
  const escapeValue = (value: string) =>
    value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  return `<div itemscope itemtype="https://schema.org/${type}"${property ? ` itemprop="${property}"` : ""}>${entries
    .filter(([key]) => key !== "@type")
    .map(([key, value]) =>
      typeof value === "object"
        ? microdataFixture(value, key)
        : `<meta itemprop="${key}" content="${escapeValue(String(value))}">`,
    )
    .join("")}</div>`;
}
