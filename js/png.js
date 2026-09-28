// PNG chunk surgery. canvas.toBlob() writes no print resolution, so without a pHYs chunk
// Preview would open a 2480 × 3508 sheet as a 34-inch-wide image instead of an A4 page.

const SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
const COLOR_SPACE_CHUNKS = new Set(['iCCP', 'sRGB', 'cICP']);

let crcTable = null;

/** CRC-32 as used by PNG chunks (the same polynomial as zlib). */
export function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Splits a PNG into chunks: { type, data, bytes }, where bytes spans length, type, data and CRC. */
export function readChunks(png) {
  if (png.length < SIGNATURE.length || SIGNATURE.some((b, i) => png[i] !== b)) {
    throw new Error('Not a PNG file.');
  }
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const chunks = [];
  let offset = SIGNATURE.length;
  while (offset + 12 <= png.length) {
    const length = view.getUint32(offset);
    const end = offset + 12 + length;
    if (end > png.length) throw new Error('Truncated PNG chunk.');
    const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
    chunks.push({ type, data: png.subarray(offset + 8, offset + 8 + length), bytes: png.subarray(offset, end) });
    offset = end;
    if (type === 'IEND') break;
  }
  return chunks;
}

/**
 * Returns a copy of `png` with a single pHYs chunk set to `dpi`, plus an sRGB chunk when the
 * file does not already declare a color space (iCCP, sRGB or cICP). Both go right after IHDR,
 * which satisfies the spec's "before PLTE and IDAT" rule.
 */
export function setPngMetadata(png, { dpi }) {
  const chunks = readChunks(png);
  if (chunks[0]?.type !== 'IHDR') throw new Error('PNG is missing its IHDR chunk.');

  const pixelsPerMeter = Math.round(dpi / 0.0254);
  const phys = new Uint8Array(9);
  const view = new DataView(phys.buffer);
  view.setUint32(0, pixelsPerMeter);
  view.setUint32(4, pixelsPerMeter);
  phys[8] = 1; // unit: meter

  const added = [makeChunk('pHYs', phys)];
  if (!chunks.some((chunk) => COLOR_SPACE_CHUNKS.has(chunk.type))) {
    added.unshift(makeChunk('sRGB', Uint8Array.of(0))); // 0 = perceptual rendering intent
  }

  const kept = chunks.slice(1).filter((chunk) => chunk.type !== 'pHYs').map((chunk) => chunk.bytes);
  const parts = [SIGNATURE, chunks[0].bytes, ...added, ...kept];
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function makeChunk(type, data) {
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) chunk[4 + i] = type.charCodeAt(i);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  return chunk;
}
