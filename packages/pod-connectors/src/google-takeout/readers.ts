// AUTHORED-BY Codex GPT-6.1-Sol
import type { GCalEvent, GCalEventDateTime } from "../google-calendar/fixtures.js";
import type { GoogleName, GooglePerson } from "../google-contacts/fixtures.js";
import { sha256 } from "./mbox.js";

interface Property {
  name: string;
  params: Record<string, string>;
  value: string;
  line: string;
}

/** RFC 5545/vCard unfolding, quoted parameters and vCard 2.1-style QP soft breaks. */
function properties(text: string): Property[] {
  const unfolded = text.split(/\r?\n/);
  const lines: string[] = [];
  for (let i = 0; i < unfolded.length; i++) {
    let line = unfolded[i] as string;
    if (/;ENCODING=QUOTED-PRINTABLE[;:]/i.test(line)) {
      while (line.endsWith("=") && i + 1 < unfolded.length)
        line = line.slice(0, -1) + unfolded[++i];
    }
    if (/^[ \t]/.test(line) && lines.length) lines[lines.length - 1] += line.slice(1);
    else lines.push(line);
  }
  const result: Property[] = [];
  for (const line of lines) {
    let quoted = false;
    let colon = -1;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') quoted = !quoted;
      else if (line[i] === ":" && !quoted) {
        colon = i;
        break;
      }
    }
    if (colon < 0) continue;
    const [rawName, ...parameters] = line.slice(0, colon).split(/;(?=(?:[^"]*"[^"]*")*[^"]*$)/);
    const params: Record<string, string> = {};
    for (const param of parameters) {
      const equal = param.indexOf("=");
      const key = equal >= 0 ? param.slice(0, equal).toUpperCase() : "TYPE";
      const value = (equal >= 0 ? param.slice(equal + 1) : param).replace(/^"|"$/g, "");
      params[key] = key === "TYPE" && params[key] ? `${params[key]},${value}` : value;
    }
    result.push({
      name: (rawName as string).split(".").pop()?.toUpperCase() as string,
      params,
      value: line.slice(colon + 1),
      line,
    });
  }
  return result;
}

function unescapeText(value: string): string {
  return value.replace(/\\([nN,;\\])/g, (_, c: string) => (c.toLowerCase() === "n" ? "\n" : c));
}
function components(value: string): string[] {
  return value.split(/(?<!\\);/).map(unescapeText);
}
function textValue(property: Property): string {
  if (property.params.ENCODING?.toUpperCase() !== "QUOTED-PRINTABLE") return property.value;
  const bytes: number[] = [];
  const encoded = new TextEncoder().encode(property.value);
  for (let i = 0; i < encoded.length; i++) {
    const pair = String.fromCharCode(encoded[i + 1] ?? 0, encoded[i + 2] ?? 0);
    if (encoded[i] === 61 && /^[0-9a-f]{2}$/i.test(pair)) {
      bytes.push(Number.parseInt(pair, 16));
      i += 2;
    } else bytes.push(encoded[i] as number);
  }
  return new TextDecoder(property.params.CHARSET ?? "utf-8").decode(new Uint8Array(bytes));
}
function date(property: Property): GCalEventDateTime | undefined {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(property.value);
  if (!match) return undefined;
  const day = `${match[1]}-${match[2]}-${match[3]}`;
  return match[4] === undefined || property.params.VALUE === "DATE"
    ? { date: day }
    : {
        dateTime: `${day}T${match[4]}:${match[5]}:${match[6]}${match[7] ?? ""}`,
        timeZone: property.params.TZID,
      };
}

/** Convert only VEVENT components into the existing Google Calendar mapping input. */
export function readIcs(text: string, limit: number): GCalEvent[] {
  const events: GCalEvent[] = [];
  let event: GCalEvent | undefined;
  const stack: string[] = [];
  let hasCalendar = false;
  for (const property of properties(text)) {
    const { name, value } = property;
    if (name === "BEGIN") {
      if (
        (!stack.length && value !== "VCALENDAR") ||
        (value === "VCALENDAR" && stack.length) ||
        (value === "VEVENT" && stack.at(-1) !== "VCALENDAR")
      )
        throw new Error("Invalid Takeout calendar component nesting.");
      stack.push(value);
      if (value === "VCALENDAR") hasCalendar = true;
      if (value === "VEVENT") event = { id: "", status: "confirmed" };
      continue;
    }
    if (name === "END") {
      if (!stack.length || stack.pop() !== value)
        throw new Error("Mismatched Takeout calendar component END.");
      if (value === "VEVENT") {
        // A VEVENT can only be opened directly inside VCALENDAR.
        const completed = event as GCalEvent;
        if (events.length >= limit) throw new Error("Takeout calendar row cap exceeded.");
        if (completed.originalStartTime) {
          completed.recurringEventId = completed.id;
          completed.id += `-${completed.originalStartTime.date ?? completed.originalStartTime.dateTime}`;
        }
        events.push(completed);
        event = undefined;
      }
      continue;
    }
    if (!event || stack.at(-1) !== "VEVENT") continue;
    switch (name) {
      case "UID":
        event.id = unescapeText(value);
        break;
      case "SUMMARY":
        event.summary = unescapeText(value);
        break;
      case "DESCRIPTION":
        event.description = unescapeText(value);
        break;
      case "LOCATION":
        event.location = unescapeText(value);
        break;
      case "DTSTART":
        event.start = date(property);
        break;
      case "DTEND":
        event.end = date(property);
        break;
      case "RECURRENCE-ID":
        event.originalStartTime = date(property);
        break;
      case "STATUS":
        event.status = value.toUpperCase() === "CANCELLED" ? "cancelled" : "confirmed";
        break;
      case "RRULE":
      case "EXDATE":
      case "RDATE":
        event.recurrence ??= [];
        event.recurrence.push(
          `${name}${Object.entries(property.params)
            .map(([key, param]) => `;${key}=${param}`)
            .join("")}:${value}`,
        );
        break;
    }
  }
  if (stack.length) throw new Error("Incomplete Takeout calendar component.");
  if (text.trim() && !hasCalendar) throw new Error("No Takeout calendar component.");
  return events;
}

/** vCard 3/4 → People API person shape; field writes remain owned by personDocument. */
export async function readVcards(
  text: string,
  limit: number,
): Promise<{ id: string; person: GooglePerson }[]> {
  const result: { id: string; person: GooglePerson }[] = [];
  let card: Property[] | undefined;
  for (const property of properties(text)) {
    if (property.name === "BEGIN") {
      if (card || property.value.toUpperCase() !== "VCARD")
        throw new Error("Invalid Takeout vCard component nesting.");
      card = [];
      continue;
    }
    if (property.name !== "END") {
      card?.push(property);
      continue;
    }
    if (!card || property.value.toUpperCase() !== "VCARD")
      throw new Error("Mismatched Takeout vCard component END.");
    if (result.length >= limit) throw new Error("Takeout contacts row cap exceeded.");
    const name: GoogleName = {};
    const person: GooglePerson = { names: [name] };
    let uid: string | undefined;
    for (const p of card) {
      const decoded = textValue(p);
      const value = unescapeText(decoded);
      switch (p.name) {
        case "UID":
          uid = value;
          break;
        case "FN":
          name.displayName = value;
          break;
        case "N":
          {
            const [familyName, givenName, middleName, honorificPrefix, honorificSuffix] =
              components(decoded);
            Object.assign(name, {
              familyName,
              givenName,
              middleName,
              honorificPrefix,
              honorificSuffix,
            });
          }
          break;
        case "EMAIL":
          person.emailAddresses ??= [];
          person.emailAddresses.push({
            value: value.replace(/^mailto:/i, ""),
            type: contactType(p.params.TYPE),
          });
          break;
        case "TEL":
          person.phoneNumbers ??= [];
          person.phoneNumbers.push({
            value: value.replace(/^tel:/i, ""),
            type: contactType(p.params.TYPE),
          });
          break;
        case "ADR": {
          const [po, extra, street, city, region, postalCode, country] = components(decoded);
          person.addresses ??= [];
          person.addresses.push({
            type: contactType(p.params.TYPE),
            streetAddress: [po, extra, street].filter(Boolean).join("\n"),
            city,
            region,
            postalCode,
            country,
          });
          break;
        }
        case "ORG":
          person.organizations ??= [];
          person.organizations.push({ name: components(decoded).join(" / ") });
          break;
        case "TITLE": {
          person.organizations ??= [];
          const organization = person.organizations;
          if (!organization.length) organization.push({});
          (organization[0] as NonNullable<GooglePerson["organizations"]>[number]).title = value;
          break;
        }
        case "BDAY": {
          const match = /^(?:(\d{4})-?|--)(\d{2})-?(\d{2})$/.exec(value);
          if (match)
            person.birthdays = [
              {
                date: {
                  year: Number(match[1] ?? 0),
                  month: Number(match[2]),
                  day: Number(match[3]),
                },
              },
            ];
          break;
        }
      }
    }
    const id = `takeout-${await sha256(uid || card.map((p) => p.line).join("\n"))}`;
    person.resourceName = `people/${id}`;
    result.push({ id, person });
    card = undefined;
  }
  if (card) throw new Error("Incomplete Takeout vCard.");
  if (text.trim() && !result.length) throw new Error("No Takeout vCard component.");
  return result;
}

function contactType(value: string | undefined): string | undefined {
  const tokens = value
    ?.toLowerCase()
    .split(",")
    .map((token) => token.trim().replace(/^"|"$/g, ""));
  return tokens?.find((token) => token === "home" || token === "work") ?? tokens?.[0];
}
