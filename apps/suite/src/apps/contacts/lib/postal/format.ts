// AUTHORED-BY Codex GPT-6.1-Sol
import type { PostalAddress } from "./types";
import { assertCountryCode, assertPostalAddress } from "./validation";

type Field = "locality" | "region" | "postalCode";
type Line = readonly (Field | readonly Field[])[];
const localityRegionCode: readonly Line[] = [[["locality", "region", "postalCode"]]];
const codeLocalityRegion: readonly Line[] = [[["postalCode", "locality"]], ["region"]];

/** Each array is one line; nested groups join with a space, outer groups with ', '.
 * All templates begin with poBox / extended / street[] and end with a foreign country.
 * US: locality, region postalCode; CA/AU: locality region postalCode
 * GB/IE: locality / region / postalCode; NZ: locality postalCode / region
 * DE/FR/NL/ES: postalCode locality / region; IT: postalCode locality region
 * JP (Latin script): locality, region / postalCode
 * Generic: postalCode locality / region
 * Reference order: https://github.com/google/libaddressinput/blob/master/testdata/countryinfo.txt
 * Retain supplied region fields even where the national template normally omits them.
 */
const templates: Readonly<Record<string, readonly Line[]>> = Object.freeze({
  US: [["locality", ["region", "postalCode"]]],
  CA: localityRegionCode,
  GB: [["locality"], ["region"], ["postalCode"]],
  IE: [["locality"], ["region"], ["postalCode"]],
  AU: localityRegionCode,
  NZ: [[["locality", "postalCode"]], ["region"]],
  DE: codeLocalityRegion,
  FR: codeLocalityRegion,
  NL: codeLocalityRegion,
  ES: codeLocalityRegion,
  IT: [[["postalCode", "locality", "region"]]],
  JP: [["locality", "region"], ["postalCode"]],
});

function join(parts: readonly string[], separator: string): string {
  return parts.filter((part) => part !== "").join(separator);
}

function lines(input: PostalAddress, homeCountry: string): string[] {
  assertCountryCode(homeCountry);
  const address = assertPostalAddress(input);
  const fields = {
    locality: address.locality.trim(),
    region: address.region.trim(),
    postalCode: address.postalCode.trim(),
  };
  const template = templates[address.countryCode ?? ""] ?? codeLocalityRegion;
  const country =
    address.countryCode === homeCountry ? "" : (address.countryCode ?? address.countryName ?? "");
  return [
    address.poBox ?? "",
    address.extended ?? "",
    ...address.street,
    ...template.map((line) =>
      join(
        line.map((group) =>
          typeof group === "string"
            ? fields[group]
            : join(
                group.map((key) => fields[key]),
                " ",
              ),
        ),
        ", ",
      ),
    ),
    country,
  ]
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/** Display-only whitespace trimming; never changes the stored address or validates deliverability. */
export function formatAddressMultiline(address: PostalAddress, homeCountry: string): string {
  return lines(address, homeCountry).join("\n");
}

/** Exactly the nonempty multi-line display lines joined with ', '. */
export function formatAddressSingleLine(address: PostalAddress, homeCountry: string): string {
  return lines(address, homeCountry).join(", ");
}
