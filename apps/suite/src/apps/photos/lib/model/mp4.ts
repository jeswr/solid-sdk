// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
/** Bounded ISO BMFF metadata reader and in-place privacy rebuild. */
export interface VideoMetadata {
  created?: string;
  durationSeconds?: number;
  location?: { lat: number; long: number };
}
export class VideoLocationError extends Error {
  override name = "VideoLocationError";
}
interface Box {
  start: number;
  payload: number;
  end: number;
  type: string;
  parent: string;
  metadata: boolean;
  sampleTable: boolean;
}
const CONTAINERS = new Set([
  "moov",
  "moof",
  "traf",
  "udta",
  "trak",
  "mdia",
  "minf",
  "stbl",
  "edts",
  "dinf",
  "meta",
  "ilst",
  "stsd",
]);
const METADATA = new Set(["moov", "trak", "udta", "meta", "ilst", "keys", "xml ", "uuid", "XMP_"]);
const MAX_BOXES = 100_000;
const UNREADABLE = "This video's metadata is unreadable. Turn off Remove location for this video.";
function typeAt(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + 4));
}

/** Invalid child extents invalidate the whole walk; no partial location scrub is safe. */
function* boxes(bytes: Uint8Array): Generator<Box> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pending = [
    { start: 0, end: bytes.length, parent: "", metadata: false, sampleTable: false },
  ];
  let count = 0;
  while (pending.length) {
    const range = pending.pop() as {
      start: number;
      end: number;
      parent: string;
      metadata: boolean;
      sampleTable: boolean;
    };
    let start = range.start;
    while (start < range.end) {
      const remaining = range.end - start;
      // A nested zero size is ambiguous with a QuickTime terminator. Accept only
      // zero padding after it; a to-end child could otherwise hide later metadata.
      if (range.parent && remaining >= 4 && view.getUint32(start) === 0) {
        if (bytes.subarray(start + 4, range.end).some((value) => value !== 0))
          throw new VideoLocationError(UNREADABLE);
        break;
      }
      if (++count > MAX_BOXES || remaining < 8) throw new VideoLocationError(UNREADABLE);
      const size32 = view.getUint32(start);
      const header = size32 === 1 ? 16 : 8;
      if (remaining < header) throw new VideoLocationError(UNREADABLE);
      const size =
        size32 === 1
          ? Number(view.getBigUint64(start + 8))
          : size32 === 0
            ? range.end - start
            : size32;
      if (!Number.isSafeInteger(size) || size < header || size > remaining)
        throw new VideoLocationError(UNREADABLE);
      const end = start + size;
      const type = typeAt(bytes, start + 4);
      const box = {
        start,
        end,
        payload: start + header,
        type,
        parent: range.parent,
        metadata: range.metadata || METADATA.has(type),
        sampleTable: range.sampleTable || type === "stbl" || type === "stsd",
      };
      yield box;
      if (CONTAINERS.has(type)) {
        // QuickTime meta starts directly with hdlr; ISO meta has version/flags first.
        const quickTime =
          type === "meta" && end - box.payload >= 8 && typeAt(bytes, box.payload + 4) === "hdlr";
        const prefix = type === "stsd" ? 8 : type === "meta" && !quickTime ? 4 : 0;
        const childStart = box.payload + prefix;
        if (childStart > end) throw new VideoLocationError(UNREADABLE);
        pending.push({
          start: childStart,
          end,
          parent: type,
          metadata: box.metadata,
          sampleTable: box.sampleTable,
        });
      }
      start = end;
    }
  }
}

function movieHeader(bytes: Uint8Array, box: Box): VideoMetadata {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offset = box.payload;
  const version = bytes[offset];
  if ((version !== 0 && version !== 1) || box.end - offset < (version === 1 ? 32 : 20)) return {};
  const created =
    version === 1 ? view.getBigUint64(offset + 4) : BigInt(view.getUint32(offset + 4));
  const timescale = view.getUint32(offset + (version === 1 ? 20 : 12));
  const duration =
    version === 1 ? view.getBigUint64(offset + 24) : BigInt(view.getUint32(offset + 16));
  const unsetDuration = version === 1 ? BigInt("0xffffffffffffffff") : BigInt("0xffffffff");
  const metadata: VideoMetadata = {};
  // Limit to ordinary ISO years supported by the photo model, before constructing a Date.
  if (created > 0 && created <= BigInt("255485145599"))
    metadata.created = new Date(Number(created) * 1000 - 2082844800000).toISOString();
  if (timescale > 0 && duration !== unsetDuration && duration <= BigInt(Number.MAX_SAFE_INTEGER))
    metadata.durationSeconds = Number(duration) / timescale;
  return metadata;
}

function location(bytes: Uint8Array, box: Box): VideoMetadata["location"] {
  if (box.end - box.payload < 4) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = view.getUint16(box.payload);
  if (length > box.end - box.payload - 4) return undefined;
  const text = new TextDecoder().decode(bytes.subarray(box.payload + 4, box.payload + 4 + length));
  const match = /^([+-]\d{2}(?:\.\d+)?)([+-]\d{3}(?:\.\d+)?)(?:[+-]\d+(?:\.\d+)?)?\/$/u.exec(text);
  if (!match) return undefined;
  const lat = Number(match[1]);
  const long = Number(match[2]);
  return Math.abs(lat) <= 90 && Math.abs(long) <= 180
    ? { lat: lat || 0, long: long || 0 }
    : undefined;
}

export function readVideoMetadata(input: Uint8Array | ArrayBuffer): VideoMetadata {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const result: VideoMetadata = {};
  try {
    for (const box of boxes(bytes)) {
      if (box.type === "mvhd" && box.parent === "moov")
        Object.assign(result, movieHeader(bytes, box));
      if (box.type === "©xyz") {
        const point = location(bytes, box);
        if (point) result.location = point;
      }
    }
  } catch {
    return {};
  }
  return result;
}

const AUDIO_FORMATS = new Set(
  "mp4a ac-3 ec-3 Opus fLaC alac lpcm sowt twos ipcm fpcm in24 in32 fl32 fl64 ulaw alaw".split(" "),
);
const SAMPLE_FORMATS = new Set([
  ...AUDIO_FORMATS,
  ..."avc1 avc3 hvc1 hev1 dvh1 dvhe mp4v av01 vp08 vp09 tmcd apcn apch apcs apco ap4h ap4x jpeg mjpa mjpb".split(
    " ",
  ),
  "raw ",
]);
const CODEC_BOXES = new Set(
  "avcC hvcC dvcC dvvC av1C vpcC esds dOps dfLa alac dac3 dec3 btrt pasp colr clap fiel gama chan wave mdcv clli CoLL SmDm".split(
    " ",
  ),
);
const DATA_REFERENCES = new Set(["alis", "url ", "urn "]);
const SAMPLE_GROUPS = new Set([
  "roll",
  "prol",
  "rap ",
  "sync",
  "tele",
  "alst",
  "tscl",
  "stsa",
  "sap ",
]);
const ALLOWED: Record<string, ReadonlySet<string>> = Object.fromEntries(
  Object.entries({
    "": "ftyp styp moov mdat moof mfra sidx free skip wide",
    moov: "mvhd trak mvex",
    mvex: "mehd trex trep",
    trak: "tkhd edts mdia",
    edts: "elst",
    mdia: "mdhd hdlr minf",
    minf: "vmhd smhd nmhd gmhd dinf stbl",
    gmhd: "gmin tmcd",
    dinf: "dref",
    stbl: "stsd stts ctts cslg stss stps stsh sdtp stsc stsz stz2 stco co64 sbgp sgpd saiz saio subs",
    moof: "mfhd traf",
    traf: "tfhd tfdt trun sbgp sgpd saiz saio subs",
    mfra: "tfra mfro",
  }).map(([parent, types]) => [parent, new Set(types.split(" "))]),
);
// These four-character types include spaces (and QuickTime's wave terminator).
ALLOWED.dref = DATA_REFERENCES;
ALLOWED.wave = new Set(["frma", "esds", "enda", "\0\0\0\0"]);

function readable(condition: unknown): asserts condition {
  if (!condition) throw new VideoLocationError(UNREADABLE);
}

/** Every integer read is bounded by its own box, including variable-width iloc fields. */
class Cursor {
  position: number;
  constructor(
    readonly bytes: Uint8Array,
    readonly end: number,
    start: number,
  ) {
    this.position = start;
  }
  uint(width: number): number {
    readable(width <= 8 && this.position + width <= this.end);
    let value = 0;
    for (let index = 0; index < width; index++)
      value = value * 256 + (this.bytes[this.position++] as number);
    readable(Number.isSafeInteger(value));
    return value;
  }
  done() {
    readable(this.position === this.end);
  }
}
interface Atom {
  start: number;
  payload: number;
  end: number;
  type: string;
  children: Atom[];
  keep: boolean;
  origin: number;
  meta: Atom | undefined;
}
const cursor = (bytes: Uint8Array, atom: Atom) => new Cursor(bytes, atom.end, atom.payload);
function one(atom: Atom, ...types: string[]): Atom {
  const matches = atom.children.filter((child) => types.includes(child.type));
  readable(matches.length === 1);
  return matches[0] as Atom;
}

/** Iterative tree walk: codec bitstreams and mdat are always opaque. */
function layout(bytes: Uint8Array): { roots: Atom[]; atoms: Atom[] } {
  const roots: Atom[] = [];
  const atoms: Atom[] = [];
  const pending = [
    {
      start: 0,
      end: bytes.length,
      parent: "",
      children: roots,
      keep: true,
      count: -1,
      origin: 0,
      meta: undefined as Atom | undefined,
    },
  ];
  while (pending.length) {
    const range = pending.pop() as (typeof pending)[number];
    const reader = new Cursor(bytes, range.end, range.start);
    while (reader.position < range.end) {
      const start = reader.position;
      const size32 = reader.uint(4);
      if (range.parent && size32 === 0) {
        readable(bytes.subarray(reader.position, range.end).every((byte) => byte === 0));
        reader.position = range.end;
        break;
      }
      readable(atoms.length < MAX_BOXES);
      reader.uint(4);
      const type = typeAt(bytes, start + 4);
      const size = size32 === 1 ? reader.uint(8) : size32 === 0 ? range.end - start : size32;
      const payload = reader.position;
      const end = start + size;
      readable(end >= payload && end <= range.end);
      const sample = range.parent === "stsd";
      const allowed = sample
        ? SAMPLE_FORMATS
        : SAMPLE_FORMATS.has(range.parent)
          ? CODEC_BOXES
          : ALLOWED[range.parent];
      const atom: Atom = {
        start,
        payload,
        end,
        type,
        children: [],
        keep: range.keep && !!allowed?.has(type),
        origin: range.origin,
        meta: range.meta,
      };
      range.children.push(atom);
      atoms.push(atom);
      reader.position = end;
      if (atom.keep) {
        if (range.parent === "dref") {
          const reference = cursor(bytes, atom);
          readable(reference.uint(1) === 0 && (reference.uint(3) & 1) !== 0);
        } else if (type === "hdlr") readable(end - payload >= 24);
        else if (type === "sbgp" || type === "sgpd") {
          const grouping = cursor(bytes, atom);
          grouping.uint(4); // version/flags
          const group = typeAt(bytes, grouping.position);
          grouping.uint(4);
          atom.keep = SAMPLE_GROUPS.has(group);
        }
      }
      let prefix: number | undefined;
      let count = -1;
      if (sample && SAMPLE_FORMATS.has(type)) {
        prefix = type === "tmcd" ? 26 : AUDIO_FORMATS.has(type) ? 28 : 78;
        // FFmpeg appends either a name atom or two zero padding bytes to tmcd.
        if (type === "tmcd" && end - payload === 28) {
          readable(bytes[payload + 26] === 0 && bytes[payload + 27] === 0);
          prefix = 28;
        }
        if (AUDIO_FORMATS.has(type)) {
          const version = new Cursor(bytes, end, payload + 8).uint(2);
          readable(version <= 2);
          prefix += version === 1 ? 16 : version === 2 ? 36 : 0;
        }
      } else if (type === "stsd" || type === "dref") {
        const entries = cursor(bytes, atom);
        readable(entries.uint(4) === 0);
        count = entries.uint(4);
        prefix = 8;
      } else if (type === "meta") {
        prefix = end - payload >= 8 && typeAt(bytes, payload + 4) === "hdlr" ? 0 : 4;
      } else if (
        CONTAINERS.has(type) ||
        ["mvex", "mfra", "gmhd", "wave", "meco", "sinf", "schi"].includes(type)
      ) {
        prefix = 0;
      }
      if (prefix !== undefined) {
        readable(payload + prefix <= end);
        pending.push({
          start: payload + prefix,
          end,
          parent: type,
          children: atom.children,
          keep: atom.keep,
          count,
          origin: type === "moof" ? start : range.origin,
          meta: type === "meta" ? atom : range.meta,
        });
      }
    }
    readable(range.count < 0 || range.count === range.children.length);
  }
  return { roots, atoms };
}

interface DataRange {
  start: number;
  end: number;
  remove: boolean;
}
interface Track {
  remove: boolean;
  descriptions: number;
}

function staticSamples(bytes: Uint8Array, table: Atom, track: Track, ranges: DataRange[]) {
  const sizes = one(table, "stsz", "stz2");
  const sizeReader = cursor(bytes, sizes);
  readable(sizeReader.uint(4) === 0);
  let fixed = 0;
  let field = 32;
  if (sizes.type === "stsz") fixed = sizeReader.uint(4);
  else {
    sizeReader.uint(3);
    field = sizeReader.uint(1);
    readable([4, 8, 16].includes(field));
  }
  const sampleCount = sizeReader.uint(4);
  readable(sampleCount <= bytes.length);
  readable(sizeReader.position + (fixed ? 0 : Math.ceil((sampleCount * field) / 8)) === sizes.end);
  const offsets = one(table, "stco", "co64");
  const chunks = cursor(bytes, offsets);
  readable(chunks.uint(4) === 0);
  const chunkCount = chunks.uint(4);
  readable(chunks.position + chunkCount * (offsets.type === "co64" ? 8 : 4) === offsets.end);
  const mapping = cursor(bytes, one(table, "stsc"));
  readable(mapping.uint(4) === 0);
  const entryCount = mapping.uint(4);
  readable(mapping.position + entryCount * 12 === mapping.end);
  const entries: { first: number; samples: number }[] = [];
  let previous = 0;
  for (let index = 0; index < entryCount; index++) {
    const first = mapping.uint(4);
    const samples = mapping.uint(4);
    const description = mapping.uint(4);
    readable(
      first > previous &&
        first <= chunkCount &&
        samples > 0 &&
        description > 0 &&
        description <= track.descriptions,
    );
    entries.push({ first, samples });
    previous = first;
  }
  readable(chunkCount === 0 ? entryCount === 0 && sampleCount === 0 : entries[0]?.first === 1);
  let entryIndex = 0;
  let used = 0;
  let packed = 0;
  for (let chunk = 1; chunk <= chunkCount; chunk++) {
    if (entries[entryIndex + 1]?.first === chunk) entryIndex++;
    const samples = (entries[entryIndex] as { samples: number }).samples;
    readable(used + samples <= sampleCount);
    const start = chunks.uint(offsets.type === "co64" ? 8 : 4);
    let length = fixed * samples;
    if (!fixed)
      for (let index = 0; index < samples; index++) {
        if (field === 4) {
          if (used % 2 === 0) packed = sizeReader.uint(1);
          length += used % 2 === 0 ? packed >>> 4 : packed & 15;
        } else length += sizeReader.uint(field / 8);
        used++;
      }
    else used += samples;
    ranges.push({ start, end: start + length, remove: track.remove });
  }
  readable(used === sampleCount);
}

function itemExtents(bytes: Uint8Array, atom: Atom, erase: DataRange[]) {
  const reader = cursor(bytes, atom);
  const version = reader.uint(1);
  readable(version <= 2);
  reader.uint(3);
  const sizes = reader.uint(1);
  const baseAndIndex = reader.uint(1);
  const offsetWidth = sizes >>> 4;
  const lengthWidth = sizes & 15;
  const baseWidth = baseAndIndex >>> 4;
  const indexWidth = version === 0 ? 0 : baseAndIndex & 15;
  readable([offsetWidth, lengthWidth, baseWidth, indexWidth].every((width) => width <= 8));
  const count = reader.uint(version < 2 ? 2 : 4);
  readable(count <= bytes.length);
  let references: Atom[] | undefined;
  for (let item = 0; item < count; item++) {
    reader.uint(version < 2 ? 2 : 4);
    const method = version === 0 ? 0 : reader.uint(2);
    readable(method <= 2);
    const reference = reader.uint(2);
    let local = reference === 0;
    if (method === 0 && !local) {
      readable(atom.meta);
      references ??= one(one(atom.meta, "dinf"), "dref").children;
      const entry = references[reference - 1];
      readable(entry && DATA_REFERENCES.has(entry.type));
      const dataReference = cursor(bytes, entry);
      readable(dataReference.uint(1) === 0);
      local = (dataReference.uint(3) & 1) !== 0;
    }
    const base = reader.uint(baseWidth);
    const extents = reader.uint(2);
    for (let extent = 0; extent < extents; extent++) {
      reader.uint(indexWidth);
      const start = atom.origin + base + reader.uint(offsetWidth);
      const length = reader.uint(lengthWidth);
      if (method === 0 && local) {
        readable(length > 0 && Number.isSafeInteger(start) && start + length <= bytes.length);
        erase.push({ start, end: start + length, remove: true });
      }
    }
  }
  reader.done();
}

function fragmentSamples(
  bytes: Uint8Array,
  moof: Atom,
  tracks: Map<number, Track>,
  defaults: Map<number, number>,
  ranges: DataRange[],
) {
  let implicitBase = moof.start;
  let retainedBase = moof.start;
  for (const traf of moof.children.filter((atom) => atom.type === "traf")) {
    const header = cursor(bytes, one(traf, "tfhd"));
    readable(header.uint(1) === 0);
    const flags = header.uint(3);
    readable((flags & ~0x03003b) === 0);
    const id = header.uint(4);
    const track = tracks.get(id);
    readable(track);
    const base = flags & 1 ? header.uint(8) : flags & 0x020000 ? moof.start : implicitBase;
    const remove = track.remove || !traf.keep;
    // Dropping a preceding traf must not silently shift a retained implicit base.
    readable(remove || (flags & 0x020001) !== 0 || base === retainedBase);
    if (flags & 2) {
      const description = header.uint(4);
      readable(description > 0 && description <= track.descriptions);
    }
    if (flags & 8) header.uint(4); // default_sample_duration
    const defaultSize = flags & 16 ? header.uint(4) : defaults.get(id);
    if (flags & 32) header.uint(4); // default_sample_flags
    header.done();
    let runEnd = base;
    for (const run of traf.children.filter((atom) => atom.type === "trun")) {
      const reader = cursor(bytes, run);
      readable(reader.uint(1) <= 1);
      const runFlags = reader.uint(3);
      readable((runFlags & ~0x000f05) === 0);
      const count = reader.uint(4);
      readable(!(flags & 0x010000) || count === 0);
      let start = runEnd;
      if (runFlags & 1) {
        const offset = reader.uint(4);
        start = base + (offset >= 0x80000000 ? offset - 0x100000000 : offset);
      }
      if (runFlags & 4) reader.uint(4); // first_sample_flags
      const stride =
        ((runFlags & 0x100 ? 1 : 0) +
          (runFlags & 0x200 ? 1 : 0) +
          (runFlags & 0x400 ? 1 : 0) +
          (runFlags & 0x800 ? 1 : 0)) *
        4;
      readable(count * stride <= reader.end - reader.position);
      let length: number;
      if (runFlags & 0x200) {
        length = 0;
        for (let sample = 0; sample < count; sample++) {
          if (runFlags & 0x100) reader.uint(4);
          length += reader.uint(4);
          if (runFlags & 0x400) reader.uint(4);
          if (runFlags & 0x800) reader.uint(4);
        }
      } else {
        readable(count === 0 || defaultSize !== undefined);
        length = count === 0 ? 0 : count * (defaultSize as number);
        reader.position += count * stride;
      }
      reader.done();
      runEnd = start + length;
      if (count > 0) ranges.push({ start, end: runEnd, remove });
    }
    implicitBase = runEnd;
    if (remove) traf.keep = false;
    else retainedBase = runEnd;
  }
}

/** Validate all references first; refusal never changes the caller's single buffer. */
export function stripVideoLocation(
  input: Uint8Array<ArrayBuffer> | ArrayBuffer,
): Uint8Array<ArrayBuffer> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const { roots, atoms } = layout(bytes);
  const mdats = roots.filter((atom) => atom.type === "mdat");
  const ranges: DataRange[] = [];
  const erase: DataRange[] = [];
  const tracks = new Map<number, Track>();
  const defaults = new Map<number, number>();
  for (const atom of atoms) {
    if (atom.type === "iloc") itemExtents(bytes, atom, erase);
    if (atom.type === "trex") {
      const reader = cursor(bytes, atom);
      readable(reader.uint(4) === 0);
      const id = reader.uint(4);
      reader.uint(4); // default_sample_description_index
      reader.uint(4); // default_sample_duration
      const size = reader.uint(4);
      reader.uint(4); // default_sample_flags
      reader.done();
      readable(!defaults.has(id));
      defaults.set(id, size);
    }
    if (atom.type !== "trak") continue;
    const tkhd = cursor(bytes, one(atom, "tkhd"));
    const version = tkhd.uint(1);
    readable(version <= 1);
    tkhd.uint(3);
    tkhd.uint(version === 1 ? 8 : 4);
    tkhd.uint(version === 1 ? 8 : 4);
    const id = tkhd.uint(4);
    readable(id !== 0 && !tracks.has(id));
    const mdia = one(atom, "mdia");
    const handler = cursor(bytes, one(mdia, "hdlr"));
    handler.uint(8);
    const handlerType = typeAt(bytes, handler.position);
    handler.uint(4);
    const table = one(one(mdia, "minf"), "stbl");
    const descriptions = one(table, "stsd").children;
    const remove =
      !atom.keep ||
      !["vide", "soun", "tmcd"].includes(handlerType) ||
      descriptions.some((entry) => !SAMPLE_FORMATS.has(entry.type));
    const track = { remove, descriptions: descriptions.length };
    tracks.set(id, track);
    staticSamples(bytes, table, track, ranges);
    if (remove) atom.keep = false;
  }
  for (const atom of atoms)
    if (atom.type === "moof") fragmentSamples(bytes, atom, tracks, defaults, ranges);
  // Sorted extents allow linear validation against mdat and reject aliasing of samples.
  ranges.sort((left, right) => left.start - right.start);
  const retained: DataRange[] = [];
  let mdatIndex = 0;
  let previousEnd = 0;
  for (const range of ranges) {
    readable(
      Number.isSafeInteger(range.end) && range.start >= previousEnd && range.end >= range.start,
    );
    while (mdatIndex < mdats.length && range.start >= (mdats[mdatIndex] as Atom).end) mdatIndex++;
    const mdat = mdats[mdatIndex];
    readable(mdat && range.start >= mdat.payload && range.end <= mdat.end);
    previousEnd = range.end;
    if (!range.remove) {
      const last = retained.at(-1);
      if (last && range.start === last.end) last.end = range.end;
      else retained.push({ ...range });
    }
  }
  // Item extents must belong to media or erased payloads, never retained box headers.
  const erasable = atoms
    .filter((atom) => !atom.keep || ["mdat", "free", "skip", "wide"].includes(atom.type))
    .sort((left, right) => left.payload - right.payload);
  erase.sort((left, right) => left.start - right.start);
  let regionIndex = 0;
  let regionEnd = 0;
  let sampleIndex = 0;
  for (const extent of erase) {
    while (regionIndex < erasable.length && (erasable[regionIndex] as Atom).payload <= extent.start)
      regionEnd = Math.max(regionEnd, (erasable[regionIndex++] as Atom).end);
    readable(extent.end <= regionEnd);
    while (
      sampleIndex < retained.length &&
      (retained[sampleIndex] as DataRange).end <= extent.start
    )
      sampleIndex++;
    readable(
      sampleIndex === retained.length || extent.end <= (retained[sampleIndex] as DataRange).start,
    );
  }
  // Only now touch bytes. Parent erasure also removes every nested header and payload.
  for (const range of erase) bytes.fill(0, range.start, range.end);
  // Preserve only retained samples, erasing removed samples and every unreferenced byte.
  // Ranges were sorted/merged once above; the complement walk is linear in their count.
  let retainedIndex = 0;
  for (const mdat of mdats) {
    let position = mdat.payload;
    while (
      retainedIndex < retained.length &&
      (retained[retainedIndex] as DataRange).start < mdat.end
    ) {
      const range = retained[retainedIndex++] as DataRange;
      bytes.fill(0, position, range.start);
      position = range.end;
    }
    bytes.fill(0, position, mdat.end);
  }
  // Erase outermost boxes once, so deeply nested rejected metadata takes linear writes.
  let erasedUntil = 0;
  for (const atom of atoms.sort((left, right) => left.start - right.start)) {
    if (atom.start < erasedUntil) continue;
    if (!atom.keep) {
      bytes.set([102, 114, 101, 101], atom.start + 4);
      bytes.fill(0, atom.payload, atom.end);
      erasedUntil = atom.end;
    } else if (["free", "skip", "wide"].includes(atom.type)) bytes.fill(0, atom.payload, atom.end);
    else if (atom.type === "hdlr") bytes.fill(0, atom.payload + 24, atom.end);
    else if (DATA_REFERENCES.has(atom.type)) bytes.fill(0, atom.payload + 4, atom.end);
    else if (SAMPLE_FORMATS.has(atom.type) && atom.type !== "tmcd" && !AUDIO_FORMATS.has(atom.type))
      bytes.fill(0, atom.payload + 42, atom.payload + 74);
  }
  return bytes;
}
