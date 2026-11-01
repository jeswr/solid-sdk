// AUTHORED-BY Codex GPT-6.1-Sol
export { fromVCardAdr, toVCardAdr } from "./adr";
export { ISO_COUNTRY_CODES, SUPPORTED_POSTAL_COUNTRIES } from "./countries";
export { formatAddressMultiline, formatAddressSingleLine } from "./format";
export {
  MAX_ADDRESS_COMPONENT_LENGTH,
  MAX_ADR_VALUE_LENGTH,
  MAX_STREET_LINES,
  type PostalAddress,
  PostalAddressError,
  type PostalAddressErrorCode,
  type PostalCodeWarning,
} from "./types";
export { validatePostalAddress } from "./validation";
