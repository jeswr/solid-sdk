// AUTHORED-BY Claude Opus 5.5
"use client";
import { LoadingSkeleton } from "@jeswr/suite-ui";
import { usePageRouteParams } from "@/lib/route-params";
import { ContactEditor } from "./contact-form";

/** Reads the contact ref on the client, so the native export's placeholder page works too. */
export function ContactEditRoute() {
  const params = usePageRouteParams<{ ref: string }>("/contacts/c/[ref]/edit");
  if (!params) return <LoadingSkeleton preset="detail" label="Loading contact form" />;
  return <ContactEditor contactRef={params.ref} />;
}
