import test from 'node:test';
import assert from 'node:assert/strict';
import { NEUTRAL } from '../js/adjust.js';
import { computeLayout, computePatternLayout, PAPERS, SHEET } from '../js/layout.js';
import { buildPattern } from '../js/patterns.js';

const ASPECTS = [1 / 3, 0.5, 2 / 3, 3 / 4, 1, 4 / 3, 3 / 2, 16 / 9, 3];

// Every image and its label band sits inside the margins, and no two overlap.
function assertClean(layout, where) {
  const { margin, labelGap } = SHEET;
  const boxes = layout.cells.map((cell) => {
    assert.ok([cell.x, cell.y, cell.width, cell.height].every(Number.isInteger), where);
    const bottom = cell.y + cell.height + layout.band;
    assert.ok(cell.x >= margin && cell.x + cell.width <= layout.width - margin, `${where}: x`);
    assert.ok(cell.y > layout.header.y && bottom <= layout.height - margin, `${where}: y`);
    assert.equal(cell.label.y, cell.y + cell.height + labelGap, where);
    return { x: cell.x, y: cell.y, right: cell.x + cell.width, bottom };
  });
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const [a, b] = [boxes[i], boxes[j]];
      assert.ok(a.right <= b.x || b.right <= a.x || a.bottom <= b.y || b.bottom <= a.y, `${where}: ${i} overlaps ${j}`);
    }
  }
}

test('pages are A4 and Letter at 300 DPI, in either orientation', () => {
  const tall = computeLayout({ count: 1, aspect: 0.75, paper: 'a4' });
  const wide = computeLayout({ count: 1, aspect: 1.5, paper: 'letter' });
  assert.deepEqual([tall.orientation, tall.width, tall.height], ['portrait', 2480, 3508]);
  assert.deepEqual([wide.orientation, wide.width, wide.height], ['landscape', 3300, 2550]);
});

test('strips of 1 to 36 fit inside the margins without overlaps', () => {
  for (const paper of Object.keys(PAPERS)) {
    for (const aspect of ASPECTS) {
      for (let count = 1; count <= 36; count++) {
        const layout = computeLayout({ count, aspect, paper });
        const where = `${paper}, aspect ${aspect.toFixed(2)}, ${count} cells`;
        assert.equal(layout.cells.length, count, where);
        assert.ok(layout.cols * layout.rows >= count, where);
        assertClean(layout, where);
      }
    }
  }
});

test('hexagons and grids fit inside the margins without overlaps', () => {
  const preset = { ...NEUTRAL };
  const patterns = [
    ...[1, 2, 3].map((rings) => buildPattern({ pattern: 'hexagon', preset, hexagon: { rings, step: 5 } })),
    ...[3, 5, 7].map((size) => buildPattern({ pattern: 'grid', preset, grid: { size, step: 5 } })),
  ];
  for (const paper of Object.keys(PAPERS)) {
    for (const aspect of ASPECTS) {
      for (const p of patterns) {
        const layout = computePatternLayout({ slots: p.cells, cols: p.cols, rows: p.rows, aspect, paper, labelLines: p.labelLines });
        assertClean(layout, `${paper}, aspect ${aspect.toFixed(2)}, ${p.title}`);
      }
    }
  }
});

test('hexagon columns step down half a row away from the center column', () => {
  const p = buildPattern({ pattern: 'hexagon', preset: { ...NEUTRAL }, hexagon: { rings: 2, step: 5 } });
  const layout = computePatternLayout({ slots: p.cells, cols: 5, rows: 5, aspect: 2 / 3, paper: 'a4' });
  const topOf = (col) => Math.min(...layout.cells.filter((_, i) => p.cells[i].col === col).map((c) => c.y));
  const pitch = layout.image.height + layout.band + SHEET.gutter;
  for (const [col, rowsDown] of [[0, 1], [1, 0.5], [3, 0.5], [4, 1]]) {
    assert.ok(Math.abs(topOf(col) - topOf(2) - rowsDown * pitch) <= 1, `column ${col}`);
  }
});

test('picks the grids a person would pick', () => {
  const shape = (count, aspect, paper = 'a4') => {
    const { cols, rows, orientation } = computeLayout({ count, aspect, paper });
    return `${cols}x${rows} ${orientation}`;
  };
  assert.equal(shape(1, 2 / 3), '1x1 portrait');
  assert.equal(shape(4, 1), '2x2 portrait');
  assert.equal(shape(9, 1), '3x3 portrait');
  assert.equal(shape(16, 1), '4x4 portrait');
  assert.equal(shape(5, 3 / 2), '2x3 portrait'); // landscape photos stack in two columns
  assert.equal(shape(7, 3 / 2), '2x4 portrait');
  assert.equal(shape(5, 2 / 3), '3x2 portrait'); // portrait photos sit three to a row
});

test('the page turns sideways only when that shows the photos larger', () => {
  const preset = { ...NEUTRAL };
  const orientation = (p, aspect) => computePatternLayout({
    slots: p.cells, cols: p.cols, rows: p.rows, aspect, paper: 'a4', labelLines: p.labelLines,
  }).orientation;
  const hexagon = buildPattern({ pattern: 'hexagon', preset, hexagon: { rings: 2, step: 5 } });
  const grid3 = buildPattern({ pattern: 'grid', preset, grid: { size: 3, step: 5 } });
  const grid5 = buildPattern({ pattern: 'grid', preset, grid: { size: 5, step: 5 } });
  assert.equal(orientation(hexagon, 16 / 9), 'landscape');
  assert.equal(orientation(hexagon, 2 / 3), 'portrait');
  assert.equal(orientation(grid3, 3 / 2), 'landscape');
  assert.equal(orientation(grid5, 3 / 2), 'portrait'); // two-line labels eat a sideways page's height
});

test('the grid is centered horizontally', () => {
  for (const count of [1, 2, 5, 9]) {
    const layout = computeLayout({ count, aspect: 1.5, paper: 'letter' });
    const left = Math.min(...layout.cells.map((c) => c.x));
    const right = Math.max(...layout.cells.map((c) => c.x + c.width));
    assert.ok(Math.abs(left - (layout.width - right)) <= 1, `${count} cells`);
  }
});

test('rejects bad input', () => {
  assert.throws(() => computeLayout({ count: 0, aspect: 1, paper: 'a4' }), RangeError);
  assert.throws(() => computeLayout({ count: 3, aspect: 0, paper: 'a4' }), RangeError);
  assert.throws(() => computeLayout({ count: 3, aspect: 1, paper: 'a3' }), /Unknown paper/);
});
