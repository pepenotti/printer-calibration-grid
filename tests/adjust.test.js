import test from 'node:test';
import assert from 'node:assert/strict';
import { applyLuts, buildLuts, formatValue, inkGamma, meanLuma } from '../js/adjust.js';

const INKS = { cyan: 0, magenta: 1, yellow: 2 };
const everyValue = Array.from({ length: 201 }, (_, i) => i - 100);
const identity = [...Array(256).keys()];

test('no adjustments leave every channel unchanged', () => {
  for (const lut of buildLuts({}, 97)) assert.deepEqual([...lut], identity);
  for (const lut of buildLuts({ cyan: 0, magenta: 0, yellow: 0, brightness: 0, contrast: 0 }, 200)) {
    assert.deepEqual([...lut], identity);
  }
});

test('Magenta ±10 moves a mid gray in green only: 128 → 115 / 141', () => {
  const [red, green, blue] = buildLuts({ magenta: 10 });
  assert.deepEqual([red[128], green[128], blue[128]], [128, 115, 128]);
  assert.equal(buildLuts({ magenta: -10 })[1][128], 141);
});

test('each ink changes only its complementary channel (C→R, M→G, Y→B)', () => {
  for (const [ink, channel] of Object.entries(INKS)) {
    buildLuts({ [ink]: 30 }).forEach((lut, i) => {
      if (i === channel) assert.ok(lut[128] < 128, `${ink} should darken channel ${i}`);
      else assert.equal(lut[128], 128, `${ink} should not touch channel ${i}`);
    });
  }
});

test('ink curves keep paper white and solid black at every value, including ±100', () => {
  for (const [ink, channel] of Object.entries(INKS)) {
    for (const v of everyValue) {
      const lut = buildLuts({ [ink]: v })[channel];
      assert.equal(lut[0], 0, `${ink} ${v}`);
      assert.equal(lut[255], 255, `${ink} ${v}`);
    }
  }
});

test('a 50% tone gets exactly v% more ink', () => {
  for (const v of [-99, -60, -10, 10, 60, 99]) {
    const ink = 1 - 0.5 ** inkGamma(v);
    assert.ok(Math.abs(ink - 0.5 * (1 + v / 100)) < 1e-12, `v = ${v}`);
  }
});

test('ink curves are monotonic in the pixel value and darken as v grows', () => {
  let previous = null;
  for (const v of everyValue) {
    const [lut] = buildLuts({ cyan: v });
    for (let x = 1; x < 256; x++) assert.ok(lut[x] >= lut[x - 1], `v = ${v}, x = ${x}`);
    if (previous) for (let x = 0; x < 256; x++) assert.ok(lut[x] <= previous[x], `v = ${v}, x = ${x}`);
    previous = lut;
  }
});

test('extreme ink values saturate instead of wrapping', () => {
  const full = buildLuts({ yellow: 100 })[2];
  const none = buildLuts({ yellow: -100 })[2];
  for (let x = 1; x < 255; x++) {
    assert.equal(full[x], 0);
    assert.equal(none[x], 255);
  }
});

test('brightness scales every channel and clamps at 0..255', () => {
  const luts = buildLuts({ brightness: 20 });
  for (const lut of luts) {
    assert.equal(lut[100], 120);
    assert.equal(lut[250], 255);
  }
  assert.ok(buildLuts({ brightness: -100 })[0].every((x) => x === 0));
});

test('contrast pivots on the rounded mean luma and clamps', () => {
  const [lut] = buildLuts({ contrast: 50 }, 99.6);
  assert.equal(lut[100], 100);
  assert.equal(lut[120], 130);
  assert.equal(lut[80], 70);
  assert.equal(lut[0], 0);
  assert.equal(lut[255], 255);
  assert.ok(buildLuts({ contrast: -100 }, 64)[0].every((x) => x === 64));
});

test('combined adjustments run contrast, then brightness, then ink, rounding once', () => {
  const mean = 100;
  const [red, green] = buildLuts({ contrast: 20, brightness: 10, magenta: 10 }, mean);
  const tone = (x) => Math.min(255, Math.max(0, (mean + (x - mean) * 1.2) * 1.1));
  assert.equal(red[128], Math.round(tone(128)));
  assert.equal(green[128], Math.round(255 * (tone(128) / 255) ** inkGamma(10)));
  // Brightness first would give a different result than ink first:
  const [, inkFirst] = buildLuts({ magenta: 10 });
  assert.notEqual(green[128], Math.round(Math.min(255, (mean + (inkFirst[128] - mean) * 1.2) * 1.1)));
});

test('buildLuts rejects out-of-range values', () => {
  assert.throws(() => buildLuts({ cyan: 101 }), RangeError);
  assert.throws(() => buildLuts({ contrast: Number.NaN }), /Contrast out of range/);
});

test('applyLuts maps RGB through the tables and leaves alpha alone', () => {
  const data = Uint8ClampedArray.of(128, 128, 128, 77, 255, 255, 255, 255);
  applyLuts(data, buildLuts({ magenta: 10 }));
  assert.deepEqual([...data], [128, 115, 128, 77, 255, 255, 255, 255]);
});

test('meanLuma uses Rec. 601 weights and ignores alpha', () => {
  const data = Uint8ClampedArray.of(255, 0, 0, 0, 0, 255, 0, 255);
  assert.ok(Math.abs(meanLuma(data) - (0.299 * 255 + 0.587 * 255) / 2) < 1e-9);
});

test('values print with a true minus sign', () => {
  assert.deepEqual([formatValue(-5), formatValue(0), formatValue(5)], ['−5', '0', '+5']);
});
