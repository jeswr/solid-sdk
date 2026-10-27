// AUTHORED-BY Codex GPT-6.1-Sol
import {
  MAX_ADDRESS_COMPONENT_LENGTH,
  MAX_ADR_VALUE_LENGTH,
  MAX_STREET_LINES,
  type PostalAddress,
  PostalAddressError,
} from "./types";
import { assertCountryCode, assertPostalAddress } from "./validation";

/** Only an ADR VALUE, without property name, parameters, folding or transport encoding.
 * RFC 6350 §6.3.1: https://www.rfc-editor.org/rfc/rfc6350.html#section-6.3.1
 * Street is a comma-separated text list. Other fields are single text values.
 * Unsupported lists, line breaks and escapes are rejected, never flattened.
 */
export function fromVCardAdr(value: string): PostalAddress {
  if (typeof value !== "string") throw new PostalAddressError("INVALID_ADR");
  if (value.length > MAX_ADR_VALUE_LENGTH) throw new PostalAddressError("ADDRESS_TOO_LARGE");
  const components: string[][] = [[]];
  let text = "";
  for (let i = 0; i < value.length; i++) {
    let char = value.charAt(i);
    const component = components[components.length - 1] as string[];
    if (char === ";" || char === ",") {
      component.push(text);
      text = "";
      if (char === ";") {
        if (components.length === 7) throw new PostalAddressError("INVALID_ADR");
        components.push([]);
      } else {
        if (components.length !== 3) throw new PostalAddressError("INVALID_ADR");
        if (component.length === MAX_STREET_LINES)
          throw new PostalAddressError("ADDRESS_TOO_LARGE");
      }
    } else {
      if (char === "\\") {
        char = value.charAt(++i);
        if (char !== ";" && char !== "," && char !== "\\") {
          throw new PostalAddressError("INVALID_ADR");
        }
      }
      // Incremental decoded bound: do not allocate an oversized text component.
      if (text.length === MAX_ADDRESS_COMPONENT_LENGTH) {
        throw new PostalAddressError("ADDRESS_TOO_LARGE");
      }
      text += char;
    }
  }
  (components[components.length - 1] as string[]).push(text);
  if (components.length !== 7) throw new PostalAddressError("INVALID_ADR");
  const [poBox, extended, street, locality, region, postalCode, country] = components as [
    [string],
    [string],
    string[],
    [string],
    [string],
    [string],
    [string],
  ];
  let countryFields: Pick<PostalAddress, "countryCode" | "countryName"> = {};
  if (/^[A-Za-z]{2}$/.test(country[0])) {
    assertCountryCode(country[0]);
    countryFields = { countryCode: country[0] };
  } else if (country[0] !== "") {
    countryFields = { countryName: country[0] };
  }
  const address: PostalAddress = {
    street: street.length === 1 && street[0] === "" ? [] : street,
    locality: locality[0],
    region: region[0],
    postalCode: postalCode[0],
    ...countryFields,
    ...(poBox[0] === "" ? {} : { poBox: poBox[0] }),
    ...(extended[0] === "" ? {} : { extended: extended[0] }),
  };
  assertPostalAddress(address);
  return address;
}

function escapeAdrText(value: string): string {
  return value.replace(/[\\;,]/g, (char) => `\\${char}`);
}

/** Preserve spelling, empty street-list entries, and literal punctuation in all seven positions. */
export function toVCardAdr(address: PostalAddress): string {
  assertPostalAddress(address);
  return [
    escapeAdrText(address.poBox ?? ""),
    escapeAdrText(address.extended ?? ""),
    address.street.map(escapeAdrText).join(","),
    escapeAdrText(address.locality),
    escapeAdrText(address.region),
    escapeAdrText(address.postalCode),
    escapeAdrText(address.countryCode ?? address.countryName ?? ""),
  ].join(";");
}
