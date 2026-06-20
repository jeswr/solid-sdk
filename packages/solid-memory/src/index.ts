// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * `@jeswr/solid-memory` — a typed RDF agent-memory model + Solid-pod store +
 * client-side search.
 *
 * The user-owned, portable, cross-agent AI-memory aggregator CORE: a memory
 * written by one agent is readable + searchable by another, because they share
 * one model (`mem:MemoryItem`, reusing schema.org / Dublin Core / PROV-O /
 * ActivityStreams). Every agent-memory adapter (mem0 / OpenClaw / LangChain /
 * Letta) maps TO this model — mirroring AS2.0's role for chat. Built on the same
 * RDF discipline as `@jeswr/solid-task-model` (typed `@rdfjs/wrapper` accessors,
 * `@jeswr/fetch-rdf` parse, `n3.Writer` serialise — never hand-built triples).
 *
 * @packageDocumentation
 */

export { docOf, httpIriOrUndefined, isHttpIri } from "./iri.js";
export {
  buildMemory,
  type MemoryData,
  MemoryItem,
  memorySubject,
  parseMemory,
  parseMemoryTtl,
  serializeMemory,
  storeToTurtle,
} from "./memory.js";
export {
  assertWithinBase,
  isContainerUrl,
  normalizeContainer,
} from "./scope.js";
export {
  type MemorySearchQuery,
  searchMemories,
} from "./search.js";
export {
  type ContainerMember,
  MemoryStore,
  type MemoryStoreOptions,
  type TypeRegistration,
} from "./store.js";
export {
  AS,
  as,
  DCT,
  dct,
  MEM,
  MEM_EMBEDDING_REF,
  MEMORY_CLASS,
  mem,
  PC,
  PREFIXES,
  PROV,
  pc,
  prov,
  RDF,
  RDF_TYPE,
  rdf,
  SCHEMA,
  schema,
  XSD,
  xsd,
} from "./vocab.js";
