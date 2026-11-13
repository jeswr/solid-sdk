// AUTHORED-BY Codex GPT-6.1-Sol
import { Zip, ZipPassThrough } from "fflate";
import { abortable, addZipBytes } from "./scope.js";
import type { ExportPodOptions } from "./types.js";

/** Remove the provisional suffix without changing any ZIP offsets, using an extra-field pad. */
function completedHeader(header: Uint8Array, central: boolean): Uint8Array {
  const copy = header.slice();
  const view = new DataView(copy.buffer);
  const lengthOffset = central ? 28 : 26;
  const nameOffset = central ? 46 : 30;
  const length = view.getUint16(lengthOffset, true) - 8;
  view.setUint16(lengthOffset, length, true);
  view.setUint16(lengthOffset + 2, 8, true);
  // Private padding extra field; .partial is eight UTF-8 bytes.
  copy.fill(0, nameOffset + length, nameOffset + length + 8);
  view.setUint16(nameOffset + length, 0xffff, true);
  view.setUint16(nameOffset + length + 2, 4, true);
  return copy;
}

/** Keep forward-only output conservative; seekable sinks promote completed member names. */
export function streamingZip(
  options: Pick<ExportPodOptions, "sink" | "patch">,
  signal: AbortSignal,
) {
  let output: Uint8Array[] = [];
  let error: Error | undefined;
  let generated = 0;
  let delivered = 0;
  let ending = false;
  const records: {
    complete: boolean;
    provisional: boolean;
    header?: Uint8Array;
    offset?: number;
  }[] = [];
  let current: (typeof records)[number];
  const zip = new Zip((failure, chunk) => {
    if (failure) {
      error = failure;
      return;
    }
    if (ending) {
      let offset = 0;
      for (const record of records) {
        const view = new DataView(chunk.buffer, chunk.byteOffset + offset);
        const length =
          46 + view.getUint16(28, true) + view.getUint16(30, true) + view.getUint16(32, true);
        if (record.complete && record.provisional)
          chunk.set(completedHeader(chunk.subarray(offset, offset + length), true), offset);
        offset += length;
      }
    } else if (current && !current.header) {
      current.header = chunk;
      current.offset = generated;
    }
    generated += chunk.byteLength;
    output.push(chunk);
  });
  const drain = async () => {
    if (error) throw error;
    const chunks = output;
    output = [];
    for (const chunk of chunks) {
      signal.throwIfAborted();
      delivered = addZipBytes(delivered, chunk.byteLength);
      await abortable(Promise.resolve(options.sink(chunk)), signal);
    }
  };
  return {
    add(path: string, provisional = false) {
      const record = { complete: false, provisional } as (typeof records)[number];
      current = record;
      records.push(record);
      const file = new ZipPassThrough(path + (provisional ? ".partial" : ""));
      zip.add(file);
      return {
        file,
        async finish(success: boolean) {
          file.push(new Uint8Array(), true);
          await drain();
          if (success && provisional && options.patch) {
            await abortable(
              Promise.resolve(
                options.patch(
                  record.offset as number,
                  completedHeader(record.header as Uint8Array, false),
                ),
              ),
              signal,
            );
            record.complete = true;
            return path;
          }
          return file.filename;
        },
      };
    },
    drain,
    async end() {
      ending = true;
      zip.end();
      await drain();
    },
    terminate: () => zip.terminate(),
  };
}
