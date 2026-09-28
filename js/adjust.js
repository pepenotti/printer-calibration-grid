// Color math for the calibration sheet. Pure functions (no DOM), so Node can test them.

export const AXES = ['cyan', 'magenta', 'yellow', 'brightness', 'contrast'];

export const AXIS_NAMES = {
  cyan: 'Cyan',
  magenta: 'Magenta',
  yellow: 'Yellow',
  brightness: 'Brightness',
  contrast: 'Contrast',
};

export const LIMITS = { min: -100, max: 100 };

/** Every adjustment at 0: the photo as it is. */
export const NEUTRAL = Object.freeze({ cyan: 0, magenta: 0, yellow: 0, brightness: 0, contrast: 0 });

/** True for a whole number an adjustment can take. */
export function inRange(v) {
  return Number.isInteger(v) && v >= LIMITS.min && v <= LIMITS.max;
}

/** "+5", "−5" (with a true minus sign) or "0". */
export function formatValue(v) {
  if (v > 0) return `+${v}`;
  if (v < 0) return `−${-v}`;
  return '0';
}

/**
 * Exponent of the tone curve used for v% ink on the CMY axes.
 * With ink = 1 − channel (both 0..1), the curve channel^γ leaves paper white and solid
 * black alone and gives a 50% tone exactly v% more (or less) ink:
 * 1 − 0.5^γ = 0.5 · (1 + v/100).
 */
export function inkGamma(v) {
  return Math.log2(2 / (1 - v / 100));
}

/**
 * Lookup tables [red, green, blue] (Uint8Array(256) each) for one combination of
 * adjustments. Missing adjustments count as 0. The stages run in the order Gutenprint's
 * printer driver uses (contrast, then brightness, then the ink curves), chained in floating
 * point and rounded once. meanLuma (0..255) of the unadjusted photo is the contrast pivot.
 */
export function buildLuts(settings, meanLuma = 128) {
  const s = { ...NEUTRAL, ...settings };
  for (const axis of AXES) {
    if (!(s[axis] >= LIMITS.min && s[axis] <= LIMITS.max)) {
      throw new RangeError(`${AXIS_NAMES[axis]} out of range: ${s[axis]}`);
    }
  }
  const pivot = Math.round(meanLuma);
  const contrast = 1 + s.contrast / 100;
  const brightness = 1 + s.brightness / 100;
  // Pillow's ImageEnhance.Contrast (blend with the mean luma), then .Brightness (blend with black).
  const tone = (x) => clamp(clamp(pivot + (x - pivot) * contrast) * brightness);

  // Each ink absorbs one RGB primary: cyan removes red, magenta green, yellow blue.
  return [s.cyan, s.magenta, s.yellow].map((ink) => {
    const gamma = inkGamma(ink);
    return makeLut((x) => {
      const t = tone(x);
      // Paper white and solid black stay put, even at ±100 where γ is 0 or ∞ (1^∞ is NaN).
      return t <= 0 || t >= 255 ? t : 255 * (t / 255) ** gamma;
    });
  });
}

/** Applies [red, green, blue] lookup tables to RGBA pixel data in place. Alpha is untouched. */
export function applyLuts(data, [red, green, blue]) {
  for (let i = 0; i < data.length; i += 4) {
    data[i] = red[data[i]];
    data[i + 1] = green[data[i + 1]];
    data[i + 2] = blue[data[i + 2]];
  }
  return data;
}

/** Mean Rec. 601 luma of RGBA pixel data, the same weights as Pillow's convert("L"). */
export function meanLuma(data) {
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return sum / (data.length / 4);
}

function clamp(x) {
  return Math.min(255, Math.max(0, x));
}

function makeLut(curve) {
  const lut = new Uint8Array(256);
  for (let x = 0; x < 256; x++) lut[x] = Math.round(clamp(curve(x)));
  return lut;
}
