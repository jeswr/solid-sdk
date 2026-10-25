// AUTHORED-BY Codex GPT-6.1-Sol
// All bytes are generated here: fictional tags, no recordings or third-party fixtures.
export const text = (value: string) => new TextEncoder().encode(value);
export function join(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
export function uint32(value: number, littleEndian = false) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, littleEndian);
  return bytes;
}
const syncsafe = (value: number) =>
  new Uint8Array([(value >> 21) & 127, (value >> 14) & 127, (value >> 7) & 127, value & 127]);

// Four MPEG-1 Layer III frames, 128 kbps, 44.1 kHz. Payload is deliberately silent data.
export function mpeg() {
  const frame = new Uint8Array(417);
  frame.set([0xff, 0xfb, 0x90, 0]);
  return join(frame, frame, frame, frame);
}

export function id3v1(track = true) {
  const tag = new Uint8Array(128);
  tag.set(text("TAG"));
  tag.set(text("Paper Moon"), 3);
  tag.set(text("Mira Example"), 33);
  tag.set(text("Fictional Skies"), 63);
  tag.set(text("2024"), 93);
  if (track) tag[126] = 7;
  else tag.set(text("A fictional comment spanning 30"), 97);
  return tag;
}

export function id3(
  version: 3 | 4,
  encoding: 0 | 1 | 2 | 3 = version === 3 ? 1 : 3,
  withPicture = true,
  title = "Paper Moon",
) {
  function encoded(value: string) {
    if (encoding === 0) return Uint8Array.from(value, (char) => char.charCodeAt(0));
    if (encoding === 3) return text(value);
    const bytes = new Uint8Array(value.length * 2);
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < value.length; i++)
      view.setUint16(i * 2, value.charCodeAt(i), encoding === 1);
    return encoding === 1 ? join(new Uint8Array([0xff, 0xfe]), bytes) : bytes;
  }
  function frame(id: string, body: Uint8Array) {
    return join(
      text(id),
      version === 4 ? syncsafe(body.length) : uint32(body.length),
      new Uint8Array(2),
      body,
    );
  }
  const entries = [
    ["TIT2", title],
    ["TPE1", "Mira Example"],
    ["TALB", "Fictional Skies"],
    ["TRCK", "7/12"],
    ["TPOS", "2/3"],
    [version === 3 ? "TYER" : "TDRC", "2024"],
  ];
  const frames = entries.map(([id, value]) =>
    frame(id as string, join(new Uint8Array([encoding]), encoded(value as string))),
  );
  if (withPicture) {
    frames.push(
      frame("APIC", join(new Uint8Array([0]), text("image/png"), new Uint8Array([0, 3, 0]), png)),
    );
  }
  // A text frame longer than 127 bytes distinguishes v2.3 sizes from v2.4 syncsafe sizes.
  frames.push(
    frame(
      "TXXX",
      join(new Uint8Array([encoding]), encoded(`source\0https://example.org/${"x".repeat(140)}`)),
    ),
  );
  const body = join(...frames);
  return join(text("ID3"), new Uint8Array([version, 0, 0]), syncsafe(body.length), body);
}

// A synthetic PNG signature suffices for MIME sniffing; no image is rendered.
export const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
export function picture(mime = "image/png") {
  return join(
    uint32(3),
    uint32(mime.length),
    text(mime),
    uint32(0),
    uint32(1),
    uint32(1),
    uint32(24),
    uint32(0),
    uint32(png.length),
    png,
  );
}

function base64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes));
}
export function comments(withPicture = true) {
  const fields = [
    "TITLE=Paper Moon",
    "ARTIST=Mira Example",
    "ALBUM=Fictional Skies",
    "TRACKNUMBER=7",
    "DISCNUMBER=2",
    "DATE=2024-05-06",
    "ARTIST=Rowan Fiction",
    "URL=https://example.org/music",
  ];
  if (withPicture) fields.push(`METADATA_BLOCK_PICTURE=${base64(picture())}`);
  const vendor = text("example.org synthetic fixture");
  return join(
    uint32(vendor.length, true),
    vendor,
    uint32(fields.length, true),
    ...fields.map((field) => join(uint32(text(field).length, true), text(field))),
  );
}

export function flac(withTags = true, withPicture = true, samples = BigInt(88200)) {
  const streamInfo = new Uint8Array(34);
  // sample rate 44100, stereo, 16-bit, 36-bit sample count.
  new DataView(streamInfo.buffer).setBigUint64(
    10,
    (BigInt(44100) << BigInt(44)) |
      (BigInt(1) << BigInt(41)) |
      (BigInt(15) << BigInt(36)) |
      samples,
  );
  function block(type: number, data: Uint8Array, last: boolean) {
    return join(new Uint8Array([type | (last ? 128 : 0)]), uint32(data.length).subarray(1), data);
  }
  return join(
    text("fLaC"),
    block(0, streamInfo, !withTags),
    ...(withTags
      ? [
          block(4, comments(false), !withPicture),
          ...(withPicture ? [block(6, picture(), true)] : []),
        ]
      : []),
  );
}

export function ogg(withPicture = true) {
  function page(packet: Uint8Array, sequence: number, flags: number, granule = BigInt(0)) {
    const header = new Uint8Array(27);
    header.set(text("OggS"));
    header[5] = flags;
    const view = new DataView(header.buffer);
    view.setBigUint64(6, granule, true);
    view.setUint32(14, 1, true);
    view.setUint32(18, sequence, true);
    const lacing = new Uint8Array(Math.floor(packet.length / 255) + 1).fill(255);
    lacing[lacing.length - 1] = packet.length % 255;
    header[26] = lacing.length;
    // CRC is not needed for metadata extraction (the parser does not validate it).
    return join(header, lacing, packet);
  }
  const identification = join(
    new Uint8Array([1]),
    text("vorbis"),
    uint32(0, true),
    new Uint8Array([2]),
    uint32(44100, true),
    new Uint8Array(12),
    new Uint8Array([0xb8, 1]),
  );
  return join(
    page(identification, 0, 2),
    page(
      join(new Uint8Array([3]), text("vorbis"), comments(withPicture), new Uint8Array([1])),
      1,
      0,
    ),
    page(new Uint8Array([0]), 2, 4, BigInt(88200)),
  );
}

export function atom(name: string, ...payload: Uint8Array[]) {
  const body = join(...payload);
  // Atom names are Latin-1 (including the copyright byte), not UTF-8.
  return join(
    uint32(body.length + 8),
    Uint8Array.from(name, (char) => char.charCodeAt(0)),
    body,
  );
}
export function mp4(withTags = true) {
  function item(name: string, type: number, bytes: Uint8Array) {
    return atom(name, atom("data", uint32(type), uint32(0), bytes));
  }
  const mvhd = new Uint8Array(100);
  new DataView(mvhd.buffer).setUint32(12, 1000);
  new DataView(mvhd.buffer).setUint32(16, 2500);
  const tags = [
    item("©nam", 1, text("Paper Moon")),
    item("©ART", 1, text("Mira Example")),
    item("©alb", 1, text("Fictional Skies")),
    item("©day", 1, text("2024-05-06")),
    item("trkn", 0, new Uint8Array([0, 0, 0, 7, 0, 12, 0, 0])),
    item("disk", 0, new Uint8Array([0, 0, 0, 2, 0, 3])),
    item("covr", 14, png),
  ];
  return join(
    atom("ftyp", text("M4A "), uint32(0), text("M4A isom")),
    atom(
      "moov",
      atom("mvhd", mvhd),
      ...(withTags ? [atom("udta", atom("meta", uint32(0), atom("ilst", ...tags)))] : []),
    ),
  );
}
