// Canvas side: decode the photo, build each variation and draw the 300-DPI sheet.

import { applyLuts, buildLuts, meanLuma } from './adjust.js';
import { computeLayout, computePatternLayout, DPI, PAPERS, SHEET } from './layout.js';
import { describeSettings } from './patterns.js';
import { setPngMetadata } from './png.js';

const FONT_FAMILY = 'system-ui, -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif';
// iOS Safari refuses canvases above 16,777,216 pixels, so no scratch canvas may exceed this.
const MAX_SCRATCH_PIXELS = 16_000_000;

let photoUrl = null;
const baseCache = new WeakMap(); // image → downscaled pixels for the current cell size

/** Decodes an image file, or rejects with a message a person can act on. */
export async function loadImage(file) {
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('empty image');
  } catch {
    URL.revokeObjectURL(url);
    const hint = /\.hei[cf]$/i.test(file.name) ? 'HEIC photos only open in Safari; export it as JPEG' : 'Try a JPEG or PNG';
    throw new Error(`This browser can't open “${file.name}”. ${hint}.`);
  }
  // Keep the URL alive while the image is in use; release the previous photo's.
  if (photoUrl) URL.revokeObjectURL(photoUrl);
  photoUrl = url;
  return image;
}

/**
 * Draws a pattern (from patterns.js) onto `canvas`, resized to the paper at 300 DPI, and
 * returns the layout used.
 */
export function renderSheet(canvas, { image, fileName, pattern, paper }) {
  const aspect = image.naturalWidth / image.naturalHeight;
  const { labelLines } = pattern;
  const layout = pattern.arrangement === 'auto'
    ? computeLayout({ count: pattern.cells.length, aspect, paper, labelLines })
    : computePatternLayout({ slots: pattern.cells, cols: pattern.cols, rows: pattern.rows, aspect, paper, labelLines });
  const base = basePixels(image, layout.image.width, layout.image.height);

  canvas.width = layout.width;
  canvas.height = layout.height;
  // Opaque sRGB: the PNG comes out as RGB (smaller) in the color space it is tagged with.
  const ctx = canvas.getContext('2d', { alpha: false, colorSpace: 'srgb' });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, layout.width, layout.height);

  pattern.cells.forEach((cell, i) => {
    const box = layout.cells[i];
    const variation = new ImageData(new Uint8ClampedArray(base.pixels.data), base.width, base.height);
    applyLuts(variation.data, buildLuts(cell.settings, base.mean));
    ctx.putImageData(variation, box.x, box.y);
    cell.label.forEach((line, n) => {
      const y = box.label.y + n * SHEET.labelLineHeight;
      drawText(ctx, line, { ...box.label, y, size: SHEET.labelFont, weight: 600 });
    });
    if (cell.current) drawFrame(ctx, box);
  });

  drawHeader(ctx, layout, { pattern, paper, fileName });
  return layout;
}

/** Encodes the sheet as a PNG tagged 300 DPI and sRGB, ready to print at 100% from Preview. */
export async function exportPng(canvas) {
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The browser could not encode the PNG.'))), 'image/png');
  });
  const bytes = setPngMetadata(new Uint8Array(await blob.arrayBuffer()), { dpi: DPI });
  return new Blob([bytes], { type: 'image/png' });
}

// The photo shrunk to the cell size once, so every variation starts from the same pixels and
// the full-resolution original never has to be copied.
function basePixels(image, width, height) {
  const cached = baseCache.get(image);
  if (cached && cached.width === width && cached.height === height) return cached;
  const pixels = downscale(image, width, height);
  const entry = { width, height, pixels, mean: meanLuma(pixels.data) };
  baseCache.set(image, entry);
  return entry;
}

// Halving in steps avoids the aliasing of one big jump; the last draw lands on white, which
// flattens any transparency the way paper would. Scratch canvases are emptied as soon as
// they are used, which frees their memory right away on iOS.
function downscale(image, width, height) {
  let source = image;
  let w = image.naturalWidth;
  let h = image.naturalHeight;
  while (w >= width * 2 && h >= height * 2) {
    const scale = Math.min(0.5, Math.sqrt(MAX_SCRATCH_PIXELS / (w * h)));
    w = Math.ceil(w * scale);
    h = Math.ceil(h * scale);
    const smaller = canvasOf(w, h);
    const ctx = smaller.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, w, h);
    release(source);
    source = smaller;
  }
  const out = canvasOf(width, height);
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, width, height);
  release(source);
  const pixels = ctx.getImageData(0, 0, width, height);
  release(out);
  return pixels;
}

function canvasOf(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function release(source) {
  if (source instanceof HTMLCanvasElement) {
    source.width = 0;
    source.height = 0;
  }
}

// Line 1 names the pattern; line 2 lists what every variation shares and how to print it.
function drawHeader(ctx, layout, { pattern, paper, fileName }) {
  const { header } = layout;
  const marked = pattern.cells.some((cell) => cell.current) ? '  ·  Framed: your preset' : '';
  const same = describeSettings(pattern.cells[0].settings, pattern.fixed);
  const print = `${PAPERS[paper].name} ${layout.orientation} at ${DPI} DPI, print at 100% scale`;
  const details = `On every variation: ${same}  ·  ${print}  ·  ${today()}`;

  drawText(ctx, `${pattern.title}${marked}`, { ...header, size: SHEET.headerFont, weight: 600 });
  drawText(ctx, withFileName(ctx, details, fileName, header.maxWidth), {
    ...header,
    y: header.y + SHEET.headerLineHeight,
    size: SHEET.headerFont,
    weight: 400,
  });
}

// Appends the file name, shortened with an ellipsis until the line fits.
function withFileName(ctx, text, fileName, maxWidth) {
  if (!fileName) return text;
  ctx.font = font(SHEET.headerFont, 400);
  let name = fileName;
  let line = `${text}  ·  ${name}`;
  while (name.length > 1 && ctx.measureText(line).width > maxWidth) {
    name = name.slice(0, -1);
    line = `${text}  ·  ${name}…`;
  }
  return line;
}

// Black, centered, and shrunk until it fits: labels must stay readable on any photo.
function drawText(ctx, text, { x, y, maxWidth, size, weight }) {
  let px = size;
  ctx.font = font(px, weight);
  while (px > 16 && ctx.measureText(text).width > maxWidth) {
    px -= 2;
    ctx.font = font(px, weight);
  }
  ctx.fillStyle = '#000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(text, x, y, maxWidth);
}

// A thin black frame, clear of the image, marks the variation that equals the preset.
function drawFrame(ctx, { x, y, width, height }) {
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 4;
  ctx.strokeRect(x - 10, y - 10, width + 20, height + 20);
}

function font(size, weight) {
  return `${weight} ${size}px ${FONT_FAMILY}`;
}

// Local date as YYYY-MM-DD, so test prints can be told apart later.
function today() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
