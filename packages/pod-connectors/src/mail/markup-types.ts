// AUTHORED-BY Codex GPT-6.1-Sol
/** Deliberately closed schema.org subset. Values are sender assertions, never instructions. */
export const EMAIL_MARKUP_TYPES = [
  "Order",
  "ParcelDelivery",
  "FlightReservation",
  "TrainReservation",
  "BusReservation",
  "LodgingReservation",
  "FoodEstablishmentReservation",
  "EventReservation",
  "RentalCarReservation",
] as const;
export type EmailMarkupType = (typeof EMAIL_MARKUP_TYPES)[number];
export const MARKUP_NODE_TYPES = [
  ...EMAIL_MARKUP_TYPES,
  "OrderItem",
  "Offer",
  "Product",
  "Organization",
  "Airline",
  "TrainStation",
  "BusStation",
  "BusStop",
  "AutoRental",
  "Country",
  "Brand",
  "QuantitativeValue",
  "ProgramMembership",
  "PropertyValue",
  "Person",
  "PostalAddress",
  "Place",
  "Airport",
  "Flight",
  "TrainTrip",
  "BusTrip",
  "LodgingBusiness",
  "Hotel",
  "Restaurant",
  "FoodEstablishment",
  "Event",
  "RentalCar",
  "Car",
  "Ticket",
  "Seat",
  "DeliveryEvent",
  "PriceSpecification",
] as const;
export type MarkupNodeType = (typeof MARKUP_NODE_TYPES)[number];
export const MARKUP_PROPERTIES = [
  "name",
  "description",
  "identifier",
  "url",
  "image",
  "orderNumber",
  "orderDate",
  "orderStatus",
  "price",
  "priceCurrency",
  "priceSpecification",
  "totalPrice",
  "paymentMethod",
  "paymentDueDate",
  "seller",
  "merchant",
  "broker",
  "provider",
  "organizer",
  "customer",
  "acceptedOffer",
  "offers",
  "itemOffered",
  "orderedItem",
  "orderQuantity",
  "orderItemNumber",
  "orderItemStatus",
  "orderDelivery",
  "partOfOrder",
  "trackingNumber",
  "trackingUrl",
  "carrier",
  "deliveryAddress",
  "originAddress",
  "expectedArrivalFrom",
  "expectedArrivalUntil",
  "hasDeliveryMethod",
  "deliveryStatus",
  "itemShipped",
  "reservationNumber",
  "reservationId",
  "reservationStatus",
  "reservationFor",
  "underName",
  "bookingAgent",
  "bookingTime",
  "modifiedTime",
  "dateModified",
  "confirmedThrough",
  "checkinTime",
  "checkoutTime",
  "numAdults",
  "numChildren",
  "lodgingUnitType",
  "lodgingUnitDescription",
  "arrivalTime",
  "departureTime",
  "arrivalAirport",
  "departureAirport",
  "arrivalStation",
  "departureStation",
  "arrivalBusStop",
  "departureBusStop",
  "arrivalPlatform",
  "departurePlatform",
  "arrivalGate",
  "departureGate",
  "arrivalTerminal",
  "departureTerminal",
  "flightNumber",
  "airline",
  "iataCode",
  "icaoCode",
  "trainNumber",
  "trainName",
  "busNumber",
  "busName",
  "boardingGroup",
  "ticketNumber",
  "ticketToken",
  "ticketedSeat",
  "ticketedSeatSection",
  "ticketedSeatRow",
  "seatNumber",
  "seatRow",
  "seatSection",
  "ticketedSeatNumber",
  "reservedTicket",
  "programMembershipUsed",
  "startTime",
  "endTime",
  "startDate",
  "endDate",
  "location",
  "address",
  "streetAddress",
  "addressLocality",
  "addressRegion",
  "postalCode",
  "addressCountry",
  "telephone",
  "email",
  "partySize",
  "pickupLocation",
  "dropoffLocation",
  "pickupTime",
  "dropoffTime",
  "rentalCompany",
  "model",
  "brand",
  "sku",
  "productID",
  "numberOfItems",
] as const;
export type MarkupProperty = (typeof MARKUP_PROPERTIES)[number];
export type MarkupValue = string | number | boolean | MarkupNode;
export type MarkupProperties = Partial<Record<MarkupProperty, readonly MarkupValue[]>>;
export interface MarkupNode {
  readonly type?: MarkupNodeType;
  readonly properties: MarkupProperties;
}
export type EmailMarkupItem = {
  [T in EmailMarkupType]: MarkupNode & { readonly type: T };
}[EmailMarkupType];
export type Order = Extract<EmailMarkupItem, { type: "Order" }>;
export type ParcelDelivery = Extract<EmailMarkupItem, { type: "ParcelDelivery" }>;
export type FlightReservation = Extract<EmailMarkupItem, { type: "FlightReservation" }>;
export type TrainReservation = Extract<EmailMarkupItem, { type: "TrainReservation" }>;
export type BusReservation = Extract<EmailMarkupItem, { type: "BusReservation" }>;
export type LodgingReservation = Extract<EmailMarkupItem, { type: "LodgingReservation" }>;
export type FoodEstablishmentReservation = Extract<
  EmailMarkupItem,
  { type: "FoodEstablishmentReservation" }
>;
export type EventReservation = Extract<EmailMarkupItem, { type: "EventReservation" }>;
export type RentalCarReservation = Extract<EmailMarkupItem, { type: "RentalCarReservation" }>;
export type OrderItem = MarkupNode & { readonly type: "OrderItem" };
export type Offer = MarkupNode & { readonly type: "Offer" };

export interface EmailMarkupOptions {
  /** UTF-8 bytes of the entire HTML; oversized input yields no items. Default 1 MiB, hard cap 8 MiB. */
  readonly maxBytes?: number;
  /** Returned root items; default 100, hard cap 1,000. */
  readonly maxItems?: number;
}
/** Trusted host evidence from stored receiver authentication, never raw sender-supplied MIME headers. */
export interface MailMarkupAuthentication {
  readonly dmarc?: "pass" | "fail";
  readonly spf?: "pass" | "fail";
  readonly dkim?: "pass" | "fail";
  readonly spfAligned?: boolean;
  readonly dkimAligned?: boolean;
}
export type MailMarkupTrust = "verified" | "unverified";
export function emailMarkupTrust(auth?: MailMarkupAuthentication): MailMarkupTrust {
  return auth?.dmarc === "pass" ||
    (auth?.dmarc !== "fail" &&
      auth?.spf === "pass" &&
      auth.dkim === "pass" &&
      auth.spfAligned === true &&
      auth.dkimAligned === true)
    ? "verified"
    : "unverified";
}
