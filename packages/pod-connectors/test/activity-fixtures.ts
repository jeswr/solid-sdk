// AUTHORED-BY Codex GPT-6.1-Sol
/** Synthetic, non-personal vendor-shaped exports; no provider traffic. */
export const START = "2026-06-01T06:30:00Z";
export const END = "2026-06-01T06:31:00Z";
export const STRAVA_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="StravaGPX" xmlns="http://www.topografix.com/GPX/1/1">
<trk><name>Synthetic morning run</name><type>running</type><trkseg>
<trkpt lat="51.5" lon="-0.12"><ele>10</ele><time>${START}</time></trkpt>
<trkpt lat="51.501" lon="-0.12"><ele>15</ele><time>${END}</time></trkpt>
</trkseg></trk></gpx>`;
export const GARMIN_GPX = STRAVA_GPX.replace("StravaGPX", "Garmin Connect").replace(
  "<time>",
  '<extensions><gpxtpx:TrackPointExtension xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1"><gpxtpx:hr>150</gpxtpx:hr><gpxtpx:cad>90</gpxtpx:cad><gpxtpx:atemp>18</gpxtpx:atemp></gpxtpx:TrackPointExtension></extensions><time>',
);
export const GARMIN_TCX = `<?xml version="1.0"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
<Activities><Activity Sport="Running"><Id>${START}</Id>
<Lap StartTime="${START}"><TotalTimeSeconds>30</TotalTimeSeconds><DistanceMeters>55</DistanceMeters><Calories>5</Calories><AverageHeartRateBpm><Value>140</Value></AverageHeartRateBpm><MaximumHeartRateBpm><Value>170</Value></MaximumHeartRateBpm>
<Track><Trackpoint><Time>${START}</Time><Position><LatitudeDegrees>51.5</LatitudeDegrees><LongitudeDegrees>-0.12</LongitudeDegrees></Position><AltitudeMeters>10</AltitudeMeters><DistanceMeters>0</DistanceMeters><HeartRateBpm><Value>140</Value></HeartRateBpm><Cadence>85</Cadence><Extensions><TPX><Speed>3.2</Speed><Watts>200</Watts></TPX></Extensions></Trackpoint></Track></Lap>
<Lap StartTime="${START}"><TotalTimeSeconds>30</TotalTimeSeconds><DistanceMeters>56</DistanceMeters><Calories>6</Calories><AverageHeartRateBpm><Value>160</Value></AverageHeartRateBpm><MaximumHeartRateBpm><Value>180</Value></MaximumHeartRateBpm>
<Track><Trackpoint><Time>${END}</Time><Position><LatitudeDegrees>51.501</LatitudeDegrees><LongitudeDegrees>-0.12</LongitudeDegrees></Position><AltitudeMeters>15</AltitudeMeters><HeartRateBpm><Value>160</Value></HeartRateBpm></Trackpoint></Track></Lap>
<Creator><Name>Synthetic Garmin</Name><UnitId>42</UnitId></Creator></Activity></Activities></TrainingCenterDatabase>`;
export const FIT_EPOCH = Date.UTC(1989, 11, 31);
export const FIT_START = (Date.parse(START) - FIT_EPOCH) / 1000;
export interface TestField {
  id: number;
  size: number;
  type: number;
}
interface Definition {
  fields: TestField[];
  dev: number[];
  little: boolean;
}
/** Independent bitwise reference CRC, implemented differently from the decoder. */
export function crc16(bytes: Uint8Array): number {
  let crc = 0;
  for (const byte of bytes)
    for (let bit = 0; bit < 8; bit++) {
      const mix = (crc ^ (byte >>> bit)) & 1;
      crc >>>= 1;
      if (mix) crc ^= 0xa001;
    }
  return crc;
}
export class FitEncoder {
  readonly body: number[] = [];
  readonly defs = new Map<number, Definition>();
  definition(
    local: number,
    global: number,
    fields: TestField[],
    dev: number[] = [],
    little = true,
  ): this {
    const globalBytes = little ? [global & 255, global >> 8] : [global >> 8, global & 255];
    this.body.push(
      64 | (dev.length ? 32 : 0) | local,
      0,
      little ? 0 : 1,
      ...globalBytes,
      fields.length,
    );
    for (const f of fields) this.body.push(f.id, f.size, f.type);
    if (dev.length) {
      this.body.push(dev.length);
      dev.forEach((size, i) => {
        this.body.push(i, size, 0);
      });
    }
    this.defs.set(local, { fields, dev, little });
    return this;
  }
  data(local: number, values: Record<number, number>, compressed?: number): this {
    const def = this.defs.get(local);
    if (!def) throw new Error("Missing test definition.");
    this.body.push(compressed === undefined ? local : 128 | (local << 5) | (compressed & 31));
    for (const f of def.fields) {
      if (compressed !== undefined && f.id === 253) continue;
      const bytes = new Uint8Array(f.size).fill(255);
      const view = new DataView(bytes.buffer);
      const n = values[f.id];
      if (n !== undefined) {
        switch (f.type & 31) {
          case 0:
          case 2:
          case 10:
          case 13:
            view.setUint8(0, n);
            break;
          case 1:
            view.setInt8(0, n);
            break;
          case 3:
            view.setInt16(0, n, def.little);
            break;
          case 4:
          case 11:
            view.setUint16(0, n, def.little);
            break;
          case 5:
            view.setInt32(0, n, def.little);
            break;
          case 6:
          case 12:
            view.setUint32(0, n, def.little);
            break;
          case 8:
            view.setFloat32(0, n, def.little);
            break;
          case 9:
            view.setFloat64(0, n, def.little);
            break;
        }
      }
      this.body.push(...bytes);
    }
    for (const size of def.dev) this.body.push(...new Array<number>(size).fill(165));
    return this;
  }
  file(headerSize = 14): Uint8Array {
    const bytes = new Uint8Array(headerSize + this.body.length + 2);
    const view = new DataView(bytes.buffer);
    bytes[0] = headerSize;
    bytes[1] = 32;
    view.setUint16(2, 2100, true);
    view.setUint32(4, this.body.length, true);
    bytes.set([46, 70, 73, 84], 8);
    if (headerSize === 14) view.setUint16(12, crc16(bytes.subarray(0, 12)), true);
    bytes.set(this.body, headerSize);
    view.setUint16(bytes.length - 2, crc16(bytes.subarray(0, -2)), true);
    return bytes;
  }
}
export const U8 = (id: number): TestField => ({ id, size: 1, type: 2 });
export const U16 = (id: number): TestField => ({ id, size: 2, type: 132 });
export const U32 = (id: number): TestField => ({ id, size: 4, type: 134 });
export const S32 = (id: number): TestField => ({ id, size: 4, type: 133 });
export const semi = (n: number) => Math.round((n * 2147483648) / 180);
export function syntheticFit(): Uint8Array {
  return new FitEncoder()
    .definition(0, 0, [U8(0), U16(1), U16(2), U32(3)])
    .data(0, { 0: 4, 1: 1, 2: 100, 3: 42 })
    .definition(
      1,
      20,
      [
        U32(253),
        S32(0),
        S32(1),
        U16(2),
        U8(3),
        U8(4),
        U32(5),
        U16(6),
        U16(7),
        { id: 13, size: 1, type: 1 },
        U32(78),
        U32(73),
      ],
      [3],
    )
    .data(1, {
      253: FIT_START,
      0: semi(51.5),
      1: semi(-0.12),
      2: 2550,
      3: 140,
      4: 85,
      5: 0,
      6: 3000,
      7: 200,
      13: -2,
      78: 2560,
      73: 3200,
    })
    .data(1, { 0: semi(51.5001), 1: semi(-0.12), 3: 150, 4: 86 }, FIT_START + 5)
    .data(1, { 253: FIT_START + 60, 0: semi(51.501), 1: semi(-0.12), 3: 160, 5: 11100 })
    .definition(2, 999, [U32(1), { id: 2, size: 7, type: 7 }], [4])
    .data(2, { 1: 7 })
    .definition(3, 19, [U32(253), U32(2), U32(7), U16(11)])
    .data(3, { 253: FIT_START + 60, 2: FIT_START, 7: 60000, 11: 11 })
    .definition(4, 18, [U32(253), U32(2), U8(5), U32(7), U32(9), U16(11), U8(16), U8(17), U16(22)])
    .data(4, {
      253: FIT_START + 60,
      2: FIT_START,
      5: 1,
      7: 60000,
      9: 11100,
      11: 11,
      16: 150,
      17: 180,
      22: 5,
    })
    .file();
}
