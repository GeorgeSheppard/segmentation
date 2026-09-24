/**
 * Run-length encoding for a `PointLabel` array — the pipeline's *final* per-point verdict,
 * not the trace it took to get there (that stays too irregular, and too large, to be worth
 * compressing: see `FrameTrace` in `src/patchwork/trace.ts`).
 *
 * Points arrive in sweep order, so neighbours in the array are neighbours in the world —
 * adjacent rings of the same surface get the same label for long stretches, broken only at
 * object edges. That makes this format effective for exactly the reason a general-purpose
 * compressor would be wasted on it: byte-for-byte, `gzip`/`brotli` do only a little better
 * (see `scripts/rle-estimate.ts`), and this format needs no library to read back in the
 * browser.
 *
 *   magic   4 bytes  "RLE1"
 *   count   uint32   points this decodes back to, for a cheap mismatch check against a
 *                    cloud it is paired with
 *   runs    repeating: label (uint8), run length (LEB128 varint, 1-based)
 *
 * Little-endian throughout.
 */
export const LABELS_RLE_MAGIC = 0x31454c52; // "RLE1" read as a little-endian uint32
export const LABELS_RLE_HEADER_BYTES = 8;

export function encodeLabelsRle(labels: Uint8Array): ArrayBuffer {
  const bytes: number[] = [];
  let i = 0;
  while (i < labels.length) {
    const value = labels[i];
    let run = 1;
    while (i + run < labels.length && labels[i + run] === value) run++;
    bytes.push(value);
    pushVarint(bytes, run);
    i += run;
  }

  const buffer = new ArrayBuffer(LABELS_RLE_HEADER_BYTES + bytes.length);
  const view = new DataView(buffer);
  view.setUint32(0, LABELS_RLE_MAGIC, true);
  view.setUint32(4, labels.length, true);
  new Uint8Array(buffer, LABELS_RLE_HEADER_BYTES).set(bytes);
  return buffer;
}

export function decodeLabelsRle(buffer: ArrayBuffer): Uint8Array {
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== LABELS_RLE_MAGIC) throw new Error("Not an RLE1 label stream");
  const count = view.getUint32(4, true);

  const labels = new Uint8Array(count);
  const bytes = new Uint8Array(buffer, LABELS_RLE_HEADER_BYTES);
  let out = 0;
  let i = 0;
  while (i < bytes.length && out < count) {
    const value = bytes[i++];
    const [run, next] = readVarint(bytes, i);
    i = next;
    labels.fill(value, out, out + run);
    out += run;
  }
  if (out !== count) {
    throw new Error(`RLE1 stream decoded ${out} labels, header promised ${count}`);
  }
  return labels;
}

/** LEB128: 7 bits of magnitude per byte, high bit set on every byte but the last. */
function pushVarint(bytes: number[], value: number): void {
  let v = value;
  while (v > 0x7f) {
    bytes.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  bytes.push(v);
}

function readVarint(bytes: Uint8Array, start: number): [value: number, next: number] {
  let value = 0;
  let shift = 0;
  let i = start;
  for (;;) {
    const byte = bytes[i++];
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }
  return [value >>> 0, i];
}
