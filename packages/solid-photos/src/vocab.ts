// AUTHORED-BY Codex (GPT-6.1 Sol)
import { NS } from "@jeswr/suite-vocab";

export const SCHEMA = NS.SCHEMA;
// EXIF has no suite-vocab constant; retain its standard W3C namespace.
export const EXIF = "http://www.w3.org/2003/12/exif/ns#";
export const GEO = NS.GEO;
export const RDF_TYPE = `${NS.RDF}type`;
export const DCT = NS.DCT;
export const XSD = NS.XSD;
export const PROV = NS.PROV;
export const PHOTOGRAPH_CLASS = `${SCHEMA}Photograph`;
export const IMAGE_GALLERY_CLASS = `${SCHEMA}ImageGallery`;
export const PREFIXES = { schema: SCHEMA, exif: EXIF, geo: GEO, dct: DCT, xsd: XSD } as const;
export const PHOTOS_SLUG = "photos/";
export const ALBUMS_SLUG = "photos/albums/";
