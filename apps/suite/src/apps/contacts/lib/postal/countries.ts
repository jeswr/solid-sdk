// AUTHORED-BY Codex GPT-6.1-Sol
/** Assigned ISO codes, excluding reserved, withdrawn and user-assigned codes (including UK/XK).
 * https://www.iso.org/obp/ui/#search/code/ — fixed snapshot, 2026-10-27.
 */
export const ISO_COUNTRY_CODES: readonly string[] = Object.freeze(
  (
    "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
    "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR " +
    "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT " +
    "JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ " +
    "NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW " +
    "SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ " +
    "UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW"
  ).split(" "),
);

export const SUPPORTED_POSTAL_COUNTRIES = Object.freeze([
  "US",
  "CA",
  "GB",
  "IE",
  "AU",
  "NZ",
  "DE",
  "FR",
  "NL",
  "ES",
  "IT",
  "JP",
] as const);

/**
 * Fixed syntax checks only: no claim that a code is allocated or deliverable.
 * Alphabetic codes are case-insensitive; a single internal space is optional.
 * No trimming, rewriting or network lookup is performed on stored values.
 *
 * Country | Regex (all anchored; CA/GB/IE/NL use the i flag)
 * US | [0-9]{5}(?:-[0-9]{4})?
 * CA | [ABCEGHJ-NPRSTVXY][0-9][ABCEGHJ-NPRSTV-Z] ?[0-9][ABCEGHJ-NPRSTV-Z][0-9]
 * GB | (?:GIR ?0AA|[A-PR-UWYZ](?:[0-9]{1,2}|[A-HK-Y][0-9]{1,2}|[0-9][A-HJKPSTUW]|[A-HK-Y][0-9][ABEHMNPRVWXY]) ?[0-9][ABD-HJLNP-UW-Z]{2})
 * IE | (?:[AC-FHKNPRTV-Y][0-9]{2}|D6W) ?[0-9AC-FHKNPRTV-Y]{4}
 * AU | [0-9]{4}
 * NZ | [0-9]{4}
 * DE | [0-9]{5}
 * FR | [0-9]{5}
 * NL | [1-9][0-9]{3} ?[A-Z]{2}
 * ES | (?:0[1-9]|[1-4][0-9]|5[0-2])[0-9]{3}
 * IT | [0-9]{5}
 * JP | [0-9]{3}-?[0-9]{4}
 *
 * Reference shapes: https://github.com/google/libaddressinput/blob/master/testdata/countryinfo.txt
 * Eircode structure: https://www.eircode.ie/what-is-eircode
 * These deliberately fixed patterns produce advisory warnings, including for unusual real data.
 */
export const POSTAL_CODE_PATTERNS: Readonly<Record<string, RegExp>> = Object.freeze({
  US: /^[0-9]{5}(?:-[0-9]{4})?$/,
  CA: /^[ABCEGHJ-NPRSTVXY][0-9][ABCEGHJ-NPRSTV-Z] ?[0-9][ABCEGHJ-NPRSTV-Z][0-9]$/i,
  GB: /^(?:GIR ?0AA|[A-PR-UWYZ](?:[0-9]{1,2}|[A-HK-Y][0-9]{1,2}|[0-9][A-HJKPSTUW]|[A-HK-Y][0-9][ABEHMNPRVWXY]) ?[0-9][ABD-HJLNP-UW-Z]{2})$/i,
  IE: /^(?:[AC-FHKNPRTV-Y][0-9]{2}|D6W) ?[0-9AC-FHKNPRTV-Y]{4}$/i,
  AU: /^[0-9]{4}$/,
  NZ: /^[0-9]{4}$/,
  DE: /^[0-9]{5}$/,
  FR: /^[0-9]{5}$/,
  NL: /^[1-9][0-9]{3} ?[A-Z]{2}$/i,
  ES: /^(?:0[1-9]|[1-4][0-9]|5[0-2])[0-9]{3}$/,
  IT: /^[0-9]{5}$/,
  JP: /^[0-9]{3}-?[0-9]{4}$/,
});
