import test from 'node:test';
import assert from 'node:assert/strict';
import { NEUTRAL } from '../js/adjust.js';
import { buildPattern, describeSettings, validateRange } from '../js/patterns.js';

const options = (overrides = {}) => ({
  pattern: 'hexagon',
  preset: { ...NEUTRAL },
  hexagon: { rings: 2, step: 5 },
  grid: { size: 3, step: 10 },
  strip: { axis: 'magenta', min: -20, max: 20, step: 10 },
  ...overrides,
});

const cmy = ({ settings: s }) => `${s.cyan},${s.magenta},${s.yellow}`;

test('the 19-variation hexagon at step 5 matches Canon’s pattern print', () => {
  // Read off Canon's sheet, column by column from the left, top to bottom.
  const canon = [
    [[10, -20, 10], [15, -15, 0], [20, -10, -10]],
    [[0, -15, 15], [5, -10, 5], [10, -5, -5], [15, 0, -15]],
    [[-10, -10, 20], [-5, -5, 10], [0, 0, 0], [5, 5, -10], [10, 10, -20]],
    [[-15, 0, 15], [-10, 5, 5], [-5, 10, -5], [0, 15, -15]],
    [[-20, 10, 10], [-15, 15, 0], [-10, 20, -10]],
  ];
  const pattern = buildPattern(options());
  assert.equal(pattern.cells.length, 19);
  canon.forEach((column, col) => {
    const cells = pattern.cells.filter((c) => c.col === col).sort((a, b) => a.row - b.row);
    assert.deepEqual(cells.map(cmy), column.map((v) => v.join(',')), `column ${col}`);
  });
});

test('hexagon directions keep C + M + Y constant and center on the preset', () => {
  const preset = { ...NEUTRAL, cyan: 5, magenta: -10, yellow: 5, brightness: 10, contrast: -5 };
  for (const rings of [1, 2, 3]) {
    const pattern = buildPattern(options({ preset, hexagon: { rings, step: 4 } }));
    assert.equal(pattern.cells.length, { 1: 7, 2: 19, 3: 37 }[rings]);
    for (const { settings } of pattern.cells) {
      assert.equal(settings.cyan + settings.magenta + settings.yellow, 0);
      assert.equal(settings.brightness, 10);
      assert.equal(settings.contrast, -5);
      assert.ok(Object.values(settings).every(Number.isInteger));
    }
    const center = pattern.cells.filter((c) => c.current);
    assert.equal(center.length, 1);
    assert.equal(cmy(center[0]), '5,-10,5');
    assert.equal(center[0].label[0], 'C +5   M −10   Y +5');
  }
});

test('hexagon cells fill a honeycomb of columns 3-4-5-4-3', () => {
  const { cells, cols, rows } = buildPattern(options());
  assert.deepEqual([cols, rows], [5, 5]);
  const perColumn = [0, 1, 2, 3, 4].map((col) => cells.filter((c) => c.col === col).length);
  assert.deepEqual(perColumn, [3, 4, 5, 4, 3]);
  assert.deepEqual(cells.filter((c) => c.col === 1).map((c) => c.row), [0.5, 1.5, 2.5, 3.5]);
  assert.equal(new Set(cells.map((c) => `${c.col}/${c.row}`)).size, 19);
});

test('the brightness × contrast grid varies across and down around the preset', () => {
  const preset = { ...NEUTRAL, cyan: 5, brightness: 10 };
  const pattern = buildPattern(options({ pattern: 'grid', preset, grid: { size: 3, step: 10 } }));
  assert.equal(pattern.cells.length, 9);
  const at = (col, row) => pattern.cells.find((c) => c.col === col && c.row === row).settings;
  assert.deepEqual([at(0, 0).brightness, at(0, 0).contrast], [0, -10]);
  assert.deepEqual([at(2, 2).brightness, at(2, 2).contrast], [20, 10]);
  assert.ok(pattern.cells.every((c) => c.settings.cyan === 5));
  assert.deepEqual(pattern.cells.find((c) => c.current).label, ['Brightness +10', 'Contrast 0']);
  assert.equal(pattern.labelLines, 2);
});

test('the strip varies one adjustment and keeps the rest of the preset', () => {
  const preset = { ...NEUTRAL, cyan: 5, magenta: 10 };
  const pattern = buildPattern(options({ pattern: 'strip', preset, strip: { axis: 'magenta', min: -15, max: 15, step: 5 } }));
  assert.deepEqual(pattern.cells.map((c) => c.settings.magenta), [-15, -10, -5, 0, 5, 10, 15]);
  assert.ok(pattern.cells.every((c) => c.settings.cyan === 5));
  assert.equal(pattern.cells.find((c) => c.current).settings.magenta, 10);
  assert.equal(pattern.cells[0].label[0], 'Magenta: −15');
  assert.equal(pattern.title, 'Magenta −15 to +15, step 5');
  assert.equal(pattern.arrangement, 'auto');
});

test('patterns that would pass ±100 are refused with the value that overflows', () => {
  const preset = { ...NEUTRAL, yellow: 90 };
  assert.match(buildPattern(options({ preset })).error, /Yellow \+105/);
  assert.match(buildPattern(options({ pattern: 'grid', grid: { size: 7, step: 40 } })).error, /Brightness −120/);
});

test('bad input comes back as a readable error', () => {
  assert.match(buildPattern(options({ preset: { ...NEUTRAL, cyan: 1.5 } })).error, /Preset values/);
  assert.match(buildPattern(options({ hexagon: { rings: 4, step: 5 } })).error, /7, 19 or 37/);
  assert.match(buildPattern(options({ hexagon: { rings: 2, step: 0 } })).error, /Step/);
  assert.match(buildPattern(options({ pattern: 'grid', grid: { size: 4, step: 5 } })).error, /3 × 3/);
  assert.match(buildPattern(options({ pattern: 'strip', strip: { axis: 'cyan', min: 5, max: -5, step: 1 } })).error, /greater than max/);
});

test('validateRange explains every invalid strip range', () => {
  assert.equal(validateRange({ min: -20, max: 20, step: 10 }), null);
  assert.match(validateRange({ min: 1.5, max: 20, step: 10 }), /whole numbers/);
  assert.match(validateRange({ min: Number.NaN, max: 20, step: 10 }), /whole numbers/);
  assert.match(validateRange({ min: -120, max: 20, step: 10 }), /between/);
  assert.match(validateRange({ min: 150, max: 120, step: 10 }), /between/);
  assert.match(validateRange({ min: 0, max: 10, step: 0 }), /at least 1/);
  assert.match(validateRange({ min: -50, max: 50, step: 1 }), /101 variations/);
});

test('describeSettings lists adjustments by name', () => {
  assert.equal(describeSettings({ ...NEUTRAL, magenta: -10 }, ['magenta', 'contrast']), 'Magenta −10 · Contrast 0');
});
