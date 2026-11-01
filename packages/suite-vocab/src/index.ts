// AUTHORED-BY Codex GPT-6.1-Sol

/** Canonical suite and standard namespace bases. These constants never build RDF. */
export const NS = {
  CORE: "https://jeswr.org/ns/core#",
  TASK: "https://jeswr.org/ns/task#",
  FED: "https://jeswr.org/ns/fed#",
  FEDREG: "https://jeswr.org/ns/fedreg#",
  FEDGEN: "https://jeswr.org/ns/fedgen#",
  FEDTRUST: "https://jeswr.org/ns/fedtrust#",
  MEMORY: "https://jeswr.org/ns/memory#",
  SOLID_VC: "https://jeswr.org/ns/solid-vc#",
  ODRL_DELEGATION: "https://jeswr.org/ns/odrl-delegation#",
  ACCESS_MANAGER: "https://jeswr.org/ns/accm#",
  BOOKMARKS: "https://jeswr.org/ns/sectors/bookmarks#",
  COLLECTIBLES: "https://jeswr.org/ns/sectors/collectibles#",
  CONTACTS: "https://jeswr.org/ns/sectors/contacts#",
  DRAWING: "https://jeswr.org/ns/sectors/drawing#",
  EQUINE: "https://jeswr.org/ns/sectors/equine#",
  FINANCE: "https://jeswr.org/ns/sectors/finance#",
  FUTURES: "https://jeswr.org/ns/sectors/futures#",
  HEALTH: "https://jeswr.org/ns/sectors/health#",
  HEALTH_DIET: "https://jeswr.org/ns/sectors/health/diet#",
  IDENTITY: "https://jeswr.org/ns/sectors/identity#",
  MEDIA: "https://jeswr.org/ns/sectors/media#",
  SCHEDULING: "https://jeswr.org/ns/sectors/scheduling#",
  SOCIAL: "https://jeswr.org/ns/sectors/social#",
  POD_DOCS: "https://jeswr.org/ns/pod-docs#",
  POD_DRIVE: "https://jeswr.org/ns/pod-drive#",
  POD_CHAT: "https://jeswr.org/ns/pod-chat#",
  POD_HEALTH: "https://jeswr.org/ns/pod-health#",
  POD_MONEY: "https://jeswr.org/ns/pod-money#",
  SOLID_SD: "https://jeswr.org/ns/solid-sd#",
  AGENT: "https://jeswr.org/ns/agent#",
  BOOKMARK: "https://jeswr.org/ns/bookmark#",
  DRAWING_APP: "https://jeswr.org/ns/drawing#",
  FEDCON: "https://jeswr.org/fedcon#",
  RDF: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  RDFS: "http://www.w3.org/2000/01/rdf-schema#",
  XSD: "http://www.w3.org/2001/XMLSchema#",
  OWL: "http://www.w3.org/2002/07/owl#",
  DCT: "http://purl.org/dc/terms/",
  DC: "http://purl.org/dc/elements/1.1/",
  PROV: "http://www.w3.org/ns/prov#",
  SOLID: "http://www.w3.org/ns/solid/terms#",
  LDP: "http://www.w3.org/ns/ldp#",
  PIM: "http://www.w3.org/ns/pim/space#",
  POSIX: "http://www.w3.org/ns/posix/stat#",
  SCHEMA: "https://schema.org/",
  TIME: "http://www.w3.org/2006/time#",
  UNIT: "http://qudt.org/vocab/unit/",
  QUDT: "http://qudt.org/schema/qudt/",
  GEO: "http://www.w3.org/2003/01/geo/wgs84_pos#",
  FOAF: "http://xmlns.com/foaf/0.1/",
  VCARD: "http://www.w3.org/2006/vcard/ns#",
  SKOS: "http://www.w3.org/2004/02/skos/core#",
  OA: "http://www.w3.org/ns/oa#",
  ACL: "http://www.w3.org/ns/auth/acl#",
  ACP: "http://www.w3.org/ns/solid/acp#",
  ODRL: "http://www.w3.org/ns/odrl/2/",
  SH: "http://www.w3.org/ns/shacl#",
  VANN: "http://purl.org/vocab/vann/",
  WF: "http://www.w3.org/2005/01/wf/flow#",
  CAL: "http://www.w3.org/2002/12/cal/ical#",
  INTEROP: "http://www.w3.org/ns/solid/interop#",
  SIOC: "http://rdfs.org/sioc/ns#",
  MEETING: "http://www.w3.org/ns/pim/meeting#",
  AS: "https://www.w3.org/ns/activitystreams#",
  NOTIFY: "http://www.w3.org/ns/solid/notifications#",
  DCAT: "http://www.w3.org/ns/dcat#",
  VC: "https://www.w3.org/2018/credentials#",
  SEC: "https://w3id.org/security#",
  CREDENTIAL_STATUS: "https://www.w3.org/ns/credentials/status#",
  ANP_AD: "https://w3id.org/agent-description#",
  DPV: "https://w3id.org/dpv#",
  DID: "https://www.w3.org/ns/did#",
  GUFO: "http://purl.org/nemo/gufo#",
} as const;

/** Read-only aliases. Writers use NS; schema.org always canonicalizes to HTTPS. */
export const LEGACY_NAMESPACES: Readonly<Record<string, string>> = {
  "https://w3id.org/jeswr/core#": NS.CORE,
  "https://w3id.org/jeswr/task#": NS.TASK,
  "https://w3id.org/jeswr/fed#": NS.FED,
  "https://w3id.org/jeswr/fedreg#": NS.FEDREG,
  "https://w3id.org/jeswr/fedgen#": NS.FEDGEN,
  "https://w3id.org/jeswr/fedtrust#": NS.FEDTRUST,
  "https://w3id.org/jeswr/memory#": NS.MEMORY,
  "https://w3id.org/jeswr/solid-vc#": NS.SOLID_VC,
  "https://w3id.org/jeswr/odrl-delegation#": NS.ODRL_DELEGATION,
  "https://w3id.org/jeswr/accm#": NS.ACCESS_MANAGER,
  "https://w3id.org/jeswr/sectors/bookmarks#": NS.BOOKMARKS,
  "https://w3id.org/jeswr/sectors/collectibles#": NS.COLLECTIBLES,
  "https://w3id.org/jeswr/sectors/contacts#": NS.CONTACTS,
  "https://w3id.org/jeswr/sectors/drawing#": NS.DRAWING,
  "https://w3id.org/jeswr/sectors/equine#": NS.EQUINE,
  "https://w3id.org/jeswr/sectors/finance#": NS.FINANCE,
  "https://w3id.org/jeswr/sectors/futures#": NS.FUTURES,
  "https://w3id.org/jeswr/sectors/health#": NS.HEALTH,
  "https://w3id.org/jeswr/sectors/health/diet#": NS.HEALTH_DIET,
  "https://w3id.org/jeswr/sectors/identity#": NS.IDENTITY,
  "https://w3id.org/jeswr/sectors/media#": NS.MEDIA,
  "https://w3id.org/jeswr/sectors/scheduling#": NS.SCHEDULING,
  "https://w3id.org/jeswr/sectors/social#": NS.SOCIAL,
  "https://w3id.org/jeswr/pod-docs#": NS.POD_DOCS,
  "https://w3id.org/jeswr/pod-drive#": NS.POD_DRIVE,
  "https://w3id.org/jeswr/pod-chat#": NS.POD_CHAT,
  "https://w3id.org/jeswr/pod-health#": NS.POD_HEALTH,
  // DECISIONS V9: read-only legacy; the app also retires Category and parent.
  "https://w3id.org/jeswr/pod-money#": NS.POD_MONEY,
  "https://w3id.org/jeswr/solid-sd#": NS.SOLID_SD,
  "https://w3id.org/jeswr/agent#": NS.AGENT,
  "https://w3id.org/jeswr/bookmark#": NS.BOOKMARK,
  "https://w3id.org/jeswr/drawing#": NS.DRAWING_APP,
  "https://w3id.org/jeswr/": "https://jeswr.org/ns/",
  "https://TBD.example/solid/health#": NS.HEALTH,
  "https://TBD.example/solid/core#": NS.CORE,
  "http://schema.org/": NS.SCHEMA,
};

/** Resolve a known legacy namespace, preserving its local name and unknown IRIs. */
export function canonicalize(iri: string): string {
  for (const [legacy, canonical] of Object.entries(LEGACY_NAMESPACES)) {
    if (iri.startsWith(legacy)) return canonical + iri.slice(legacy.length);
  }
  return iri;
}

/** Whether an IRI uses a known read-only legacy namespace. */
export function isLegacy(iri: string): boolean {
  return canonicalize(iri) !== iri;
}

/** Compare IRI strings after resolving known namespace aliases (case-sensitive). */
export function termsEqual(a: string, b: string): boolean {
  return canonicalize(a) === canonicalize(b);
}
