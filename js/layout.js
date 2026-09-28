// Sheet geometry. Every size is in device pixels at 300 DPI.

export const DPI = 300;

export const PAPERS = {
  a4: { name: 'A4', width: 2480, height: 3508, css: 'A4' },
  letter: { name: 'Letter', width: 2550, height: 3300, css: 'letter' },
};

export const SHEET = {
  margin: 150, // 0.5 in, clear of most printers' unprintable edge
  headerFont: 34,
  headerLineHeight: 46,
  headerLines: 2,
  headerGap: 40, // space between the header and the first row
  gutter: 60, // about 5 mm between variations
  labelFont: 42,
  labelLineHeight: 50,
  labelGap: 24, // from the bottom of an image to its label; leaves room for the preset frame
};

const HEADER_HEIGHT = SHEET.headerLines * SHEET.headerLineHeight + SHEET.headerGap;

/**
 * Lays out `count` cells in reading order (left to right, top to bottom), picking the page
 * orientation and the number of columns that show the image largest.
 */
export function computeLayout({ count, aspect, paper, labelLines = 1 }) {
  check({ aspect, paper });
  if (!Number.isInteger(count) || count < 1) throw new RangeError('count must be a positive integer');

  let best = null;
  for (const page of pagesFor(paper)) {
    for (let cols = 1; cols <= count; cols++) {
      const rows = Math.ceil(count / cols);
      const image = fitImage({ cols, rows, aspect, page, labelLines });
      if (!image) continue;
      const candidate = { page, cols, rows, image, empty: cols * rows - count };
      if (!best || isBetter(candidate, best)) best = candidate;
    }
  }
  if (!best) throw new RangeError(`${count} variations do not fit on one page`);
  const slots = Array.from({ length: count }, (_, i) => ({ col: i % best.cols, row: Math.floor(i / best.cols) }));
  return place({ ...best, slots, paper, labelLines });
}

/**
 * Lays out cells at fixed { col, row } slots of a cols × rows grid (the hexagon and the
 * brightness × contrast grid). Rows may be half-integers: the hexagon's odd columns sit half
 * a cell lower. Picks the page orientation that shows the image largest.
 */
export function computePatternLayout({ slots, cols, rows, aspect, paper, labelLines = 1 }) {
  check({ aspect, paper });
  let best = null;
  for (const page of pagesFor(paper)) {
    const image = fitImage({ cols, rows, aspect, page, labelLines });
    if (!image) continue;
    const candidate = { page, cols, rows, image, empty: 0 };
    if (!best || isBetter(candidate, best)) best = candidate;
  }
  if (!best) throw new RangeError(`A ${cols} × ${rows} pattern does not fit on one page`);
  return place({ ...best, slots, paper, labelLines });
}

function check({ aspect, paper }) {
  if (!PAPERS[paper]) throw new Error(`Unknown paper: ${paper}`);
  if (!(aspect > 0 && Number.isFinite(aspect))) throw new RangeError('aspect must be a positive number');
}

function pagesFor(paper) {
  const { width, height } = PAPERS[paper];
  return [
    { orientation: 'portrait', width, height },
    { orientation: 'landscape', width: height, height: width },
  ];
}

function labelBand(labelLines) {
  return SHEET.labelGap + labelLines * SHEET.labelLineHeight;
}

// The largest whole-pixel image of the given aspect that fits cols × rows cells, or null.
function fitImage({ cols, rows, aspect, page, labelLines }) {
  const { margin, gutter } = SHEET;
  const maxWidth = (page.width - 2 * margin - (cols - 1) * gutter) / cols;
  const maxHeight = (page.height - 2 * margin - HEADER_HEIGHT - (rows - 1) * gutter) / rows - labelBand(labelLines);
  if (maxWidth < 1 || maxHeight < 1) return null;
  const fitWidth = Math.min(maxWidth, maxHeight * aspect);
  const width = Math.max(1, Math.floor(fitWidth));
  const height = Math.max(1, Math.floor(fitWidth / aspect));
  return { width, height, area: width * height };
}

// Bigger images win. Within 2% of each other, fewer empty cells win, then portrait (the
// candidate seen first).
function isBetter(candidate, best) {
  if (candidate.image.area > best.image.area * 1.02) return true;
  if (candidate.image.area < best.image.area * 0.98) return false;
  return candidate.empty < best.empty;
}

// Centers the header and grid on the page and turns slots into pixel rectangles.
function place({ page, cols, rows, image, slots, paper, labelLines }) {
  const { margin, gutter, labelGap } = SHEET;
  const { width, height } = image;
  const band = labelBand(labelLines);
  const gridWidth = cols * width + (cols - 1) * gutter;
  const gridHeight = rows * (height + band) + (rows - 1) * gutter;
  const left = Math.round((page.width - gridWidth) / 2);
  const top = Math.round(margin + (page.height - 2 * margin - HEADER_HEIGHT - gridHeight) / 2);

  const cells = slots.map(({ col, row }) => {
    const x = left + col * (width + gutter);
    const y = Math.round(top + HEADER_HEIGHT + row * (height + band + gutter));
    return {
      x,
      y,
      width,
      height,
      // Labels may use most of the gutter so narrow images still get readable text.
      label: { x: x + width / 2, y: y + height + labelGap, maxWidth: width + gutter - 12 },
    };
  });

  return {
    paper,
    orientation: page.orientation,
    width: page.width,
    height: page.height,
    cols,
    rows,
    image: { width, height },
    band,
    header: { x: page.width / 2, y: top, maxWidth: page.width - 2 * margin },
    cells,
  };
}
