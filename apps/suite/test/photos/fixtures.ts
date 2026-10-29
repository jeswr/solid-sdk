// AUTHORED-BY Codex GPT-6.1-Sol
// Tiny real TIFF/EXIF fixtures, generated as reviewable bytes without image encoding.
type Tag = { tag: number; type: 2 | 3 | 4 | 5; values: string | number[] | Tag[] };
export function tiffFixture(orientation = 1, location = true): ArrayBuffer {
  const bytes = new ArrayBuffer(2048);
  const view = new DataView(bytes);
  let cursor = 8;
  function ifd(tags: Tag[]): number {
    const start = cursor;
    view.setUint16(start, tags.length, true);
    cursor += 2 + tags.length * 12 + 4;
    tags.forEach(({ tag, type, values }, index) => {
      const entry = start + 2 + index * 12;
      view.setUint16(entry, tag, true);
      view.setUint16(entry + 2, type, true);
      if (Array.isArray(values) && typeof values[0] === "object") {
        view.setUint32(entry + 4, 1, true);
        view.setUint32(entry + 8, ifd(values as Tag[]), true);
        return;
      }
      const data =
        typeof values === "string"
          ? [...new TextEncoder().encode(`${values}\0`)]
          : (values as number[]);
      const size = type === 2 ? 1 : type === 3 ? 2 : type === 4 ? 4 : 8;
      view.setUint32(entry + 4, data.length, true);
      let offset = entry + 8;
      if (size * data.length > 4) {
        offset = cursor;
        cursor += size * data.length;
        view.setUint32(entry + 8, offset, true);
      }
      data.forEach((value, i) => {
        const position = offset + size * i;
        if (type === 2) view.setUint8(position, value);
        if (type === 3) view.setUint16(position, value, true);
        if (type === 4) view.setUint32(position, value, true);
        if (type === 5) {
          view.setUint32(position, value * 1000, true);
          view.setUint32(position + 4, 1000, true);
        }
      });
    });
    return start;
  }
  view.setUint16(0, 0x4949, true);
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true);
  const tags: Tag[] = [
    { tag: 271, type: 2, values: "Canon" },
    { tag: 272, type: 2, values: "EOS" },
    { tag: 274, type: 3, values: [orientation] },
    {
      tag: 34665,
      type: 4,
      values: [
        { tag: 36867, type: 2, values: "2026:06:15 09:41:07" },
        { tag: 40962, type: 4, values: [4000] },
        { tag: 40963, type: 4, values: [3000] },
        { tag: 34855, type: 3, values: [200] },
        { tag: 33437, type: 5, values: [2.8] },
        { tag: 33434, type: 5, values: [0.008] },
        { tag: 37386, type: 5, values: [35] },
        { tag: 42036, type: 2, values: "35mm" },
      ],
    },
  ];
  if (location)
    tags.push({
      tag: 34853,
      type: 4,
      values: [
        { tag: 1, type: 2, values: "N" },
        { tag: 2, type: 5, values: [51, 30, 0] },
        { tag: 3, type: 2, values: "W" },
        { tag: 4, type: 5, values: [0, 7, 12] },
      ],
    });
  ifd(tags);
  return bytes.slice(0, cursor);
}
