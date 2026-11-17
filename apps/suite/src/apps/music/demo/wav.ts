// AUTHORED-BY Codex GPT-6.1-Sol
/** A quiet, original four-second chime; generated PCM, no remote media or recordings. */
export function sampleWav(): ArrayBuffer {
  const rate = 8000;
  const count = rate * 4;
  const bytes = new ArrayBuffer(44 + count * 2);
  const view = new DataView(bytes);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, bytes.byteLength - 8, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, count * 2, true);
  for (let i = 0; i < count; i++)
    view.setInt16(
      44 + i * 2,
      Math.sin((i / rate) * 2 * Math.PI * 440) * 1800 * Math.exp(-i / rate),
      true,
    );
  return bytes;
}
