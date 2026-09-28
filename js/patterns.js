// The three kinds of sheet, as lists of cells to draw. Pure functions (no DOM).
//   hexagon  Canon-style color balance: C/M/Y vary around the preset in a hexagon
//   grid     brightness across × contrast down, around the preset
//   strip    one adjustment from min to max in steps (the original PRD)
// Adjustments a pattern does not vary keep their preset value on every cell.

import { AXES, AXIS_NAMES, formatValue, inRange } from './adjust.js';

export const PATTERNS = ['hexagon', 'grid', 'strip'];
export const HEXAGON_SIZES = { 1: 7, 2: 19, 3: 37 }; // rings → variations
export const GRID_SIZES = [3, 5, 7];
export const MAX_STRIP = 36;

/**
 * Builds a sheet from { pattern, preset, hexagon: { rings, step }, grid: { size, step },
 * strip: { axis, min, max, step } }. Returns { error } when the input can't make a sheet, or
 * { cells, arrangement, cols, rows, labelLines, title, fixed, slug }. Each cell is
 * { settings, label: [lines], current } plus { col, row } for fixed arrangements; `current`
 * marks the cell that equals the preset.
 */
export function buildPattern({ pattern, preset, hexagon, grid, strip }) {
  if (!AXES.every((axis) => inRange(preset[axis]))) {
    return { error: 'Preset values must be whole numbers from −100 to +100.' };
  }
  let result;
  if (pattern === 'hexagon') result = hexagonPattern(preset, hexagon);
  else if (pattern === 'grid') result = gridPattern(preset, grid);
  else if (pattern === 'strip') result = stripPattern(preset, strip);
  else return { error: `Unknown pattern: ${pattern}` };
  if (result.error) return result;

  for (const { settings } of result.cells) {
    const axis = AXES.find((a) => !inRange(settings[a]));
    if (axis) {
      return {
        error: `The pattern reaches ${AXIS_NAMES[axis]} ${formatValue(settings[axis])}, past ±100. Use a smaller step or fewer variations.`,
      };
    }
  }
  return result;
}

/** "Brightness 0 · Contrast +5" for the given adjustments. */
export function describeSettings(settings, axes = AXES) {
  return axes.map((axis) => `${AXIS_NAMES[axis]} ${formatValue(settings[axis])}`).join(' · ');
}

/** Returns a message explaining why a strip range is unusable, or null when it is fine. */
export function validateRange({ min, max, step }) {
  if (![min, max, step].every(Number.isInteger)) return 'Min, max and step must be whole numbers.';
  if ([min, max].some((v) => !inRange(v))) return 'Min and max must be between −100 and +100.';
  if (min > max) return 'Min must not be greater than max.';
  if (step < 1) return 'Step must be at least 1.';
  const count = Math.floor((max - min) / step) + 1;
  if (count > MAX_STRIP) {
    return `That makes ${count} variations, but one sheet fits at most ${MAX_STRIP}. Use a bigger step or a narrower range.`;
  }
  return null;
}

function hexagonPattern(preset, { rings, step }) {
  if (!HEXAGON_SIZES[rings]) return { error: 'Choose 7, 19 or 37 variations.' };
  if (!isStep(step)) return { error: 'Step must be a whole number of at least 1.' };
  const cells = [];
  // Columns q = −rings…rings; odd columns sit half a cell lower, so y is a half-integer there.
  for (let q = -rings; q <= rings; q++) {
    const half = rings - Math.abs(q) / 2;
    for (let y = -half; y <= half; y++) {
      // The color wheel as on Canon's pattern: up is yellow, down blue, left green/cyan,
      // right red/magenta. Every direction keeps C + M + Y constant, so only the balance
      // moves, not the overall density. All values are whole multiples of the step.
      const cyan = preset.cyan + step * (y - 1.5 * q);
      const magenta = preset.magenta + step * (y + 1.5 * q);
      const yellow = preset.yellow - step * 2 * y;
      cells.push({
        col: q + rings,
        row: y + rings,
        settings: { ...preset, cyan, magenta, yellow },
        current: q === 0 && y === 0,
        label: [`C ${formatValue(cyan)}   M ${formatValue(magenta)}   Y ${formatValue(yellow)}`],
      });
    }
  }
  return {
    cells,
    arrangement: 'fixed',
    cols: 2 * rings + 1,
    rows: 2 * rings + 1,
    labelLines: 1,
    title: `Color balance: ${cells.length} variations, step ${step}`,
    fixed: ['brightness', 'contrast'],
    slug: `color-balance-${cells.length}-step${step}`,
  };
}

function gridPattern(preset, { size, step }) {
  if (!GRID_SIZES.includes(size)) return { error: 'Choose a 3 × 3, 5 × 5 or 7 × 7 grid.' };
  if (!isStep(step)) return { error: 'Step must be a whole number of at least 1.' };
  const center = (size - 1) / 2;
  const cells = [];
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      // Brightness grows to the right, contrast grows downward.
      const brightness = preset.brightness + (col - center) * step;
      const contrast = preset.contrast + (row - center) * step;
      cells.push({
        col,
        row,
        settings: { ...preset, brightness, contrast },
        current: col === center && row === center,
        label: [`Brightness ${formatValue(brightness)}`, `Contrast ${formatValue(contrast)}`],
      });
    }
  }
  return {
    cells,
    arrangement: 'fixed',
    cols: size,
    rows: size,
    labelLines: 2,
    title: `Brightness × contrast: ${size} × ${size}, step ${step}`,
    fixed: ['cyan', 'magenta', 'yellow'],
    slug: `brightness-contrast-${size}x${size}-step${step}`,
  };
}

function stripPattern(preset, { axis, min, max, step }) {
  if (!AXES.includes(axis)) return { error: `Unknown adjustment: ${axis}` };
  const error = validateRange({ min, max, step });
  if (error) return { error };
  const cells = [];
  for (let v = min; v <= max; v += step) {
    cells.push({
      settings: { ...preset, [axis]: v },
      current: v === preset[axis],
      label: [`${AXIS_NAMES[axis]}: ${formatValue(v)}`],
    });
  }
  const last = cells.at(-1).settings[axis];
  const range = cells.length > 1 ? `${formatValue(min)} to ${formatValue(last)}, step ${step}` : formatValue(min);
  return {
    cells,
    arrangement: 'auto',
    labelLines: 1,
    title: `${AXIS_NAMES[axis]} ${range}`,
    fixed: AXES.filter((a) => a !== axis),
    slug: `${axis}_${min}_to_${max}_step${step}`,
  };
}

function isStep(step) {
  return Number.isInteger(step) && step >= 1;
}
