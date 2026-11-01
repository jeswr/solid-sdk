// AUTHORED-BY Codex GPT-6.1-Sol
// Standard IRIs retained from apps/pod-photos. No private vocabulary is minted.
export const SCHEMA = "https://schema.org/";
export const EXIF = "http://www.w3.org/2003/12/exif/ns#";
export const GEO = "http://www.w3.org/2003/01/geo/wgs84_pos#";
export const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
export const DCT = "http://purl.org/dc/terms/";
export const XSD = "http://www.w3.org/2001/XMLSchema#";
export const PHOTOGRAPH_CLASS = `${SCHEMA}Photograph`;
export const IMAGE_GALLERY_CLASS = `${SCHEMA}ImageGallery`;
export const PREFIXES = { schema: SCHEMA, exif: EXIF, geo: GEO, dct: DCT, xsd: XSD } as const;
export const PHOTOS_SLUG = "photos/";
export const ALBUMS_SLUG = "photos/albums/";
