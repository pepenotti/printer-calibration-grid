import test from 'node:test';
import assert from 'node:assert/strict';
import { crc32 as zlibCrc32, deflateSync } from 'node:zlib';
import { crc32, readChunks, setPngMetadata } from '../js/png.js';

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(zlibCrc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

// A valid 1×1 RGBA PNG, optionally with extra chunks between IHDR and IDAT.
function tinyPng(extra = []) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  const pixels = deflateSync(Buffer.from([0, 200, 100, 50, 255])); // filter byte + one pixel
  return new Uint8Array(
    Buffer.concat([Buffer.from(SIGNATURE), chunk('IHDR', ihdr), ...extra, chunk('IDAT', pixels), chunk('IEND', [])]),
  );
}

function physOf(chunks) {
  const phys = chunks.filter((c) => c.type === 'pHYs');
  assert.equal(phys.length, 1, 'exactly one pHYs chunk');
  const view = new DataView(phys[0].data.buffer, phys[0].data.byteOffset, 9);
  return { x: view.getUint32(0), y: view.getUint32(4), unit: phys[0].data[8] };
}

function assertValidCrcs(chunks) {
  for (const c of chunks) {
    const view = new DataView(c.bytes.buffer, c.bytes.byteOffset, c.bytes.length);
    const stored = view.getUint32(c.bytes.length - 4);
    assert.equal(stored, zlibCrc32(c.bytes.subarray(4, c.bytes.length - 4)), `${c.type} CRC`);
  }
}

test('crc32 matches zlib', () => {
  const bytes = new Uint8Array(4096).map((_, i) => (i * 7919) & 0xff);
  assert.equal(crc32(bytes), zlibCrc32(bytes));
  assert.equal(crc32(new Uint8Array()), 0);
  assert.equal(crc32(new TextEncoder().encode('IEND')), 0xae426082);
});

test('adds 300 DPI and sRGB right after IHDR on an untagged PNG', () => {
  const chunks = readChunks(setPngMetadata(tinyPng(), { dpi: 300 }));
  assert.deepEqual(chunks.map((c) => c.type), ['IHDR', 'sRGB', 'pHYs', 'IDAT', 'IEND']);
  assert.deepEqual(physOf(chunks), { x: 11811, y: 11811, unit: 1 });
  assert.deepEqual([...chunks[1].data], [0]);
  assertValidCrcs(chunks);
});

test('replaces an existing pHYs instead of adding a second one', () => {
  const dpi72 = new Uint8Array(9);
  new DataView(dpi72.buffer).setUint32(0, 2835);
  new DataView(dpi72.buffer).setUint32(4, 2835);
  dpi72[8] = 1;
  const chunks = readChunks(setPngMetadata(tinyPng([chunk('pHYs', dpi72)]), { dpi: 300 }));
  assert.deepEqual(physOf(chunks), { x: 11811, y: 11811, unit: 1 });
  assertValidCrcs(chunks);
});

test('keeps an embedded color profile and does not add sRGB next to it', () => {
  const iccp = chunk('iCCP', [...Buffer.from('Display P3\0\0'), 1, 2, 3]);
  const chunks = readChunks(setPngMetadata(tinyPng([iccp]), { dpi: 300 }));
  assert.deepEqual(chunks.map((c) => c.type), ['IHDR', 'pHYs', 'iCCP', 'IDAT', 'IEND']);
  assertValidCrcs(chunks);
});

test('leaves the image data byte for byte', () => {
  const original = readChunks(tinyPng()).find((c) => c.type === 'IDAT');
  const rewritten = readChunks(setPngMetadata(tinyPng(), { dpi: 300 })).find((c) => c.type === 'IDAT');
  assert.deepEqual([...rewritten.bytes], [...original.bytes]);
});

test('rejects files that are not PNGs', () => {
  assert.throws(() => setPngMetadata(new Uint8Array([1, 2, 3]), { dpi: 300 }), /Not a PNG/);
  const truncated = tinyPng().subarray(0, 30);
  assert.throws(() => setPngMetadata(truncated, { dpi: 300 }), /Truncated/);
});
