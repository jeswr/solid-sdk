// AUTHORED-BY Codex GPT-6.2 Sol
import { digestBytes, digestOf, isIri } from "../core/canonical.js";
import type { JsonObject } from "../core/types.js";
import type { VerifiedStatement } from "../trace/recorder.js";
import { decodeAdapterJson } from "../wire/inspect.js";

export interface RefusedStatement {
  readonly id: string;
  readonly claimDigest: string;
  readonly wireDigest: string;
  readonly wire?: string;
  readonly statement: JsonObject;
}

interface NativeProjection {
  readonly subjects: ReadonlySet<string>;
  readonly repeatedProof?: string;
}

interface RefusedScan {
  readonly matchValue?: (key: string) => boolean;
  readonly checkReferences?: boolean;
  readonly carried?: ReadonlySet<string>;
  readonly projection?: NativeProjection;
  readonly referencesOnly?: boolean;
}

type RecordValue = Record<string, unknown>;
const recordOf = (value: unknown): RecordValue | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as RecordValue) : undefined;

function leaves(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(leaves);
  const record = recordOf(value);
  return record ? Object.values(record).flatMap(leaves) : [value];
}

function wholeValue(value: string): RegExp {
  const identifier = "[\\p{L}\\p{M}\\p{N}_]";
  const connector = "[.:/+%#-]";
  const literal = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Punctuation joins identifier components only if there is a component on the other side.
  return new RegExp(
    `(?<!${identifier})(?<!${identifier}${connector})${literal}(?!${identifier}|${connector}${identifier})`,
    "giu",
  );
}

interface SourceValue {
  readonly source: string;
  readonly field?: string;
  readonly owner?: SourceObject;
}

type JsonPath = readonly (string | number)[];

interface SourceObject {
  readonly members: RecordValue;
  readonly parent?: SourceObject;
}

/** Lex the original member values, including any a parsed object would overwrite. */
function sourceValues(
  json: string,
  stringAt?: (start: number, source: string, path: JsonPath) => void,
): SourceValue[] {
  type Frame = {
    readonly object?: SourceObject;
    readonly owner?: SourceObject;
    readonly path?: JsonPath;
    readonly start: number;
    field?: string;
    index: number;
  };
  const frames: Frame[] = [];
  const values: SourceValue[] = [];
  const tokens = /"(?:[^"\\]|\\[\s\S])*"(\s*:)?|[{}[\],:]|[^{}[\],:"\s]+/g;
  const path = (frame: Frame | undefined) =>
    frame ? [...(frame.path ?? []), frame.object ? (frame.field ?? "") : frame.index] : [];
  for (const token of json.matchAll(tokens)) {
    const [source, member] = token;
    const frame = frames.at(-1);
    if (member && frame?.object) {
      frame.field = unquote(source.slice(0, -member.length));
      frame.object.members[frame.field] = undefined;
    } else if (source === "{" || source === "[") {
      const owner = frame?.object ?? frame?.owner;
      const childPath = stringAt ? path(frame) : undefined;
      frames.push(
        source === "{"
          ? {
              object: { members: Object.create(null), parent: owner },
              index: 0,
              path: childPath,
              start: token.index,
            }
          : { field: frame?.field, owner, index: 0, path: childPath, start: token.index },
      );
    } else if (source === "}" || source === "]") {
      const closed = frames.pop();
      const parent = frames.at(-1);
      if (!stringAt && closed)
        values.push({
          source: json.slice(closed.start, token.index + 1),
          field: parent?.field,
          owner: parent?.object ?? parent?.owner,
        });
    } else if (source === ",") {
      if (stringAt && frame && !frame.object) frame.index++;
    } else if (source !== ":") {
      const { field, object } = frame ?? {};
      values.push({ source, field, owner: object ?? frame?.owner });
      if (source.startsWith('"')) {
        if (object && field !== undefined) object.members[field] = unquote(source);
        if (stringAt) stringAt(token.index, source, path(frame));
      }
    }
  }
  return values;
}

/** Replace only the selected JSON string tokens, preserving the source for every other value. */
export function maskJsonStrings(
  json: string,
  mask: (path: JsonPath, value: string) => string | null | undefined,
): string {
  let end = 0;
  const parts: string[] = [];
  sourceValues(json, (start, source, path) => {
    const value = mask(path, unquote(source));
    if (value === undefined) return;
    parts.push(json.slice(end, start), JSON.stringify(value));
    end = start + source.length;
  });
  return parts.length ? parts.join("") + json.slice(end) : json;
}

function unquote(source: string): string {
  return source
    .slice(1, -1)
    .replace(/\\(?:u([\da-fA-F]{4})|(["\\/bfnrt]))/g, (sequence, hex, char) => {
      if (hex) return String.fromCharCode(Number.parseInt(hex, 16));
      return (
        ({ b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" } as Record<string, string>)[char] ??
        char ??
        sequence
      );
    });
}

const scalar = (value: unknown): value is number | boolean =>
  typeof value === "number" || typeof value === "boolean";
function rdfValueWrapper(record: RecordValue): boolean {
  const keys = Object.keys(record);
  if (Object.hasOwn(record, "@value"))
    return keys.every((key) => ["@value", "@type", "@language", "type"].includes(key));
  return keys.length === 1 && (keys[0] === "id" || keys[0] === "@id");
}

// These members disappear during RDF expansion, so a verified graph cannot attest their text.
const rdfMember = (field?: string) => field !== "@context" && field !== "@index";

export function refusedContent(refused: RefusedStatement) {
  const {
    id: _id,
    issuer: _issuer,
    subject: _subject,
    claimType: _claimType,
    method: _method,
    asOf: _asOf,
    issuedAt: _issuedAt,
    validUntil: _validUntil,
    period: _period,
    derivation: _derivation,
    ...fields
  } = refused.statement;
  const references = [refused.id, refused.claimDigest, refused.wireDigest, refused.wire];
  const values = leaves(fields);
  const textValues = new Set(
    values.filter((value): value is string => typeof value === "string" && !!value),
  );
  const texts = [...textValues].filter((value) => !isIri(value)).map(wholeValue);
  const iris = new Set([...textValues].filter(isIri).map((value) => value.toLowerCase()));
  const exactTexts = new Set([...textValues].map((value) => value.toLowerCase()));
  const scalars = [...new Set(values.filter(scalar).map(String))].map((value) => ({
    pattern: wholeValue(value),
    long: value.replace(/\D/g, "").length >= 3,
  }));
  const claimEntries = Object.entries(fields).filter(([field]) => field !== "terms");
  const claimFieldsDigest = digestOf(Object.fromEntries(claimEntries));

  function inspect(input: unknown, options: RefusedScan = {}): boolean {
    const { checkReferences = true, projection, carried, matchValue = () => true } = options;
    const fieldValue = (field?: string) =>
      field !== undefined && Object.hasOwn(fields, field) ? fields[field] : undefined;
    const referenceIn = (value: string) =>
      checkReferences && references.some((reference) => reference && value.includes(reference));
    const scalarMatch = (value: string) => matchValue(`scalar:${value.toLowerCase()}`);
    const textMatch = (value: string) => matchValue(`text:${value}`);
    const hasValue = (pattern: RegExp, value: string, match: (value: string) => boolean) => {
      for (const [occurrence] of value.matchAll(pattern)) if (match(occurrence)) return true;
      return false;
    };

    const hasIri = (value: string) => {
      if (!iris.size || isIri(value)) return false; // Entire IRIs are checked as exact strings.
      for (const match of value.matchAll(/[A-Za-z][A-Za-z0-9+.-]*:[^\s<>"{}|\\^\x60]+/g)) {
        const [token] = match;
        if (iris.has(token.toLowerCase()) && textMatch(token)) return true;
        // Strip prose punctuation without dropping a query or fragment delimiter.
        let iri = token.replace(/[.,;!]+$/, "");
        const opener = value[match.index - 1];
        const closer = opener === "(" ? ")" : opener === "[" ? "]" : opener;
        if (closer && (opener === "(" || opener === "[" || opener === "'") && iri.endsWith(closer))
          iri = iri.slice(0, -1);
        if (iris.has(iri.toLowerCase()) && textMatch(iri)) return true;
      }
      return false;
    };

    function plain(value: string, field: string | undefined, referencesOnly: boolean): boolean {
      if (referenceIn(value)) return true;
      if (referencesOnly) return false;
      const original = fieldValue(field);
      return (
        hasIri(value) ||
        texts.some((pattern) => hasValue(pattern, value, textMatch)) ||
        (scalar(original) && value.toLowerCase() === String(original) && scalarMatch(value)) ||
        scalars.some(
          ({ pattern, long }) =>
            (long || field === "text" || !checkReferences) && hasValue(pattern, value, scalarMatch),
        )
      );
    }

    function location(field: string | undefined, record: RecordValue | undefined, native: boolean) {
      const namedField =
        native && record?.type === "PropertyValue" && typeof record.name === "string"
          ? record.name
          : undefined;
      return {
        field: field === "domainValue" && namedField !== undefined ? namedField : field,
        key: namedField !== undefined && (field === "name" || field === "propertyID"),
      };
    }

    function projected(record: RecordValue, parent: boolean): boolean {
      const id = record.id ?? record["@id"];
      return (
        (typeof id === "string" && projection?.subjects.has(id) === true) ||
        (parent && rdfValueWrapper(record))
      );
    }

    function projectedSource(owner?: SourceObject): boolean {
      return (
        owner !== undefined &&
        (projected(owner.members, false) ||
          (rdfValueWrapper(owner.members) && projectedSource(owner.parent)))
      );
    }

    function sourceCopies(
      json: string,
      field: string | undefined,
      referencesOnly: boolean,
      native: boolean,
    ) {
      return sourceValues(json).some(({ source, field: member, owner }) => {
        const context = location(member ?? field, owner?.members, native);
        if (context.key) return false;
        const onlyReferences =
          referencesOnly || (native && rdfMember(member) && projectedSource(owner));
        if (source.startsWith('"')) {
          const raw = source.slice(1, -1);
          const decoded = unquote(source);
          return (
            (raw !== decoded &&
              !/^\s*[[{]/.test(decoded) &&
              plain(raw, context.field, onlyReferences)) ||
            scanString(decoded, context.field, onlyReferences, false)
          );
        }
        if (source.startsWith("{") || source.startsWith("[")) {
          const original =
            fieldValue(context.field) ?? (source.startsWith("{") ? fields.value : undefined);
          if (onlyReferences || !original || typeof original !== "object") return false;
          let decoded: unknown;
          try {
            decoded = decodeAdapterJson(source);
          } catch {
            return false;
          }
          return structured(decoded, original);
        }
        // A number or boolean in an overwritten member gets the same check as a parsed scalar.
        if (!onlyReferences && /^(?:true|false|-?\d)/.test(source)) {
          const value = source === "true" ? true : source === "false" ? false : Number(source);
          return primitive(value, fieldValue(context.field));
        }
        return false;
      });
    }

    function scanJson(
      value: string,
      field: string | undefined,
      referencesOnly: boolean,
      native: boolean,
    ) {
      if (sourceCopies(value, field, referencesOnly, native)) return true;
      let decoded: unknown;
      try {
        decoded = decodeAdapterJson(value);
      } catch {
        return plain(value, field, referencesOnly);
      }
      return scan(decoded, field, referencesOnly, native);
    }

    function scanString(
      value: string,
      field: string | undefined,
      referencesOnly: boolean,
      native: boolean,
    ): boolean {
      if (checkReferences && references.includes(value)) return true;
      const exactCarried = carried?.has(value) === true;
      const onlyReferences = referencesOnly || exactCarried;
      if (!onlyReferences && exactTexts.has(value.toLowerCase()) && textMatch(value)) return true;
      const serialized = /^\s*[[{]/.test(value);
      if (serialized) return scanJson(value, field, onlyReferences, native);
      if (plain(value, field, onlyReferences)) return true;
      // Look ahead so a dotted word preceding a compact JWS cannot hide its payload.
      for (const [, token, payload] of value.matchAll(
        /(?<![\w-])(?=([\w-]+\.([\w-]+)\.[\w-]+))/g,
      )) {
        if (!token || !payload) continue;
        if (checkReferences && digestBytes(token) === refused.wireDigest) return true;
        if (token === projection?.repeatedProof) continue; // The document bytes are scanned directly.
        const json = Buffer.from(payload, "base64url").toString("utf8");
        if (scanJson(json, undefined, onlyReferences || carried?.has(token) === true, false))
          return true;
      }
      return false;
    }

    function primitive(value: unknown, original: unknown): boolean {
      return (
        scalar(value) &&
        (value === original || (!checkReferences && values.includes(value))) &&
        scalarMatch(String(value))
      );
    }

    function structured(value: unknown, original: unknown): boolean {
      if (!original || typeof original !== "object" || value == null) return false;
      const digest = digestOf(original);
      return digestOf(value) === digest && matchValue(digest);
    }

    function scan(
      value: unknown,
      field?: string,
      referencesOnly = options.referencesOnly ?? false,
      native = projection !== undefined,
      projectedParent = false,
    ): boolean {
      if (typeof value === "string")
        return scanString(value, field, referencesOnly || projectedParent, native);
      const record = recordOf(value);
      const projectedValue =
        record && native ? projected(record, projectedParent) : projectedParent;
      const original = fieldValue(field) ?? (record ? fields.value : undefined);
      if (
        !referencesOnly &&
        !projectedValue &&
        (structured(value, original) || primitive(value, original))
      )
        return true;
      if (Array.isArray(value)) {
        if (
          field === "bytes" &&
          value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
        )
          return scan(
            new TextDecoder().decode(Uint8Array.from(value)),
            undefined,
            referencesOnly,
            false,
          );
        return value.some((item) => scan(item, field, referencesOnly, native, projectedParent));
      }
      if (!record) return false;
      if (
        checkReferences &&
        record.claimType === refused.statement.claimType &&
        digestOf(record) === refused.claimDigest
      )
        return true;
      if (
        !referencesOnly &&
        !projectedValue &&
        claimEntries.length &&
        claimEntries.every(
          ([key, expected]) =>
            record[key] !== undefined && digestOf(record[key]) === digestOf(expected),
        ) &&
        matchValue(claimFieldsDigest)
      )
        return true;
      return Object.entries(record).some(([key, child]) => {
        const context = location(key, record, native);
        // Only native PropertyValue nodes encode object keys as RDF values.
        return (
          !context.key &&
          scan(
            child,
            context.field,
            referencesOnly,
            native && typeof child === "object",
            projectedValue && rdfMember(key),
          )
        );
      });
    }

    return scan(input);
  }

  return { refused, inspect };
}

export type RefusedContent = ReturnType<typeof refusedContent>;

export function explainedValues(content: RefusedContent, statements: readonly VerifiedStatement[]) {
  const values = new Set<string>();
  for (const { statement } of statements)
    content.inspect(statement, {
      checkReferences: false,
      matchValue: (key) => {
        values.add(key);
        return false;
      },
    });
  return (key: string) => !values.has(key);
}
