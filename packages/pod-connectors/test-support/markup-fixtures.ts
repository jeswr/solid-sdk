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

const TRACE_DATE = "Thu, 01 Jan 2026 08:00:00 +0000";
/** Google's inbound MX receipt as Gmail folds it (synthetic hosts, ids and documentation IPs). */
export function googleMxReceived(date = TRACE_DATE, protocol = "ESMTPS"): string[] {
  return [
    "Received: from mta.example.test (mta.example.test. [192.0.2.10])",
    `        by mx.google.com with ${protocol} id s1-20020a17090a000100b0012345si1.2026.01.01.08.00.00`,
    "        for <alex@example.test>",
    "        (version=TLS1_3 cipher=TLS_AES_256_GCM_SHA384 bits=256/256);",
    `        ${date}`,
  ];
}
/** Google's receiver assertion for `dmarc` (a full result clause), folded as Gmail writes it. */
export function googleAuthenticationResults(dmarc: string): string[] {
  return [
    "Authentication-Results: mx.google.com;",
    "       dkim=pass header.i=@example.test header.s=s1 header.b=synthetic;",
    "       spf=pass (google.com: domain of bounce@mta.example.test designates 192.0.2.10 as permitted sender) smtp.mailfrom=bounce@mta.example.test;",
    `       ${dmarc}`,
  ];
}
/** A genuine Gmail header layout: an internal IPv6 relay hop, the inbound MX receipt, then
 * Google's Authentication-Results directly below it. */
export function gmailTrace(dmarc: string, date = TRACE_DATE): string[] {
  return [
    `Received: by 2002:a05:6a10:1234:b0:5ab:cdef:1234 with SMTP id a1b2c3d4e5f6; ${date}`,
    `X-Received: by 2002:a17:90a:1234:b0:2a1:1234:abcd with SMTP id x9y8z7; ${date}`,
    "ARC-Seal: i=1; a=rsa-sha256; t=1767254400; cv=none; d=google.com; s=arc-20240605; b=synthetic",
    "Return-Path: <bounce@mta.example.test>",
    ...googleMxReceived(date),
    "Received-SPF: pass (google.com: domain of bounce@mta.example.test designates 192.0.2.10 as permitted sender) client-ip=192.0.2.10;",
    ...googleAuthenticationResults(dmarc),
  ];
}
