# Printer Calibration Grid

A static web page that turns one photo into a printable test sheet of labeled color
variations, like a printer driver's pattern print. Print it, hold it next to your screen,
and read off the settings that make your prints match. Everything runs in the browser; the
photo never leaves your device.

**Live:** https://pepenotti.github.io/printer-calibration-grid/

## Patterns

- **Color balance.** A hexagon of 7, 19 or 37 variations around your preset, laid out like
  Canon's pattern print: yellow up, blue down, green and cyan left, red and magenta right.
  At step 5 the 19 variations use exactly Canon's values (C −5 M −5 Y +10 for one step
  toward yellow, and so on).
- **Brightness × contrast.** A 3 × 3, 5 × 5 or 7 × 7 grid: brightness changes across,
  contrast changes down.
- **Single adjustment.** One of cyan, magenta, yellow, brightness or contrast from min to
  max in steps.

The **preset** (all five adjustments) is applied to every variation, and the patterns vary
around it; the variation equal to the preset is framed. Click a variation in the preview to
make it the new preset.

## Printing

1. Download the PNG: A4 (2480 × 3508 px) or Letter (2550 × 3300 px) at 300 DPI, tagged
   sRGB, portrait or landscape (whichever shows the photos larger).
2. Open it in Preview, choose File › Print and set **Scale to 100%**. Use the paper and
   quality you print photos with, and leave the printer's own color adjustments at their
   defaults so the sheet's values are the whole correction.
3. Find the variation that best matches the original photo on screen; its label is your
   correction. Make it the preset, lower the step, and print again to fine-tune.

The **Print…** button prints the same PNG straight from the browser on one page, but
Preview gives the most predictable result.

## How the adjustments are computed

- **Cyan, magenta, yellow** each reduce their complementary channel (red, green, blue)
  with a tone curve `c′ = 255 · (c/255)^γ`, `γ = log₂(2 / (1 − v/100))`. A 50% tone gets
  exactly v% more ink (or less, for negative values); paper white and solid black never
  change. To reproduce a value in an image editor, set that channel's Levels midtone to
  `1/γ` (Magenta +10 is 0.87 on green).
- **Color balance** steps keep C + M + Y constant, so the hue moves but the density doesn't.
- **Brightness** multiplies every channel by `1 + v/100` (Pillow's
  `ImageEnhance.Brightness`); **contrast** scales each channel's distance from the photo's
  mean luminance by `1 + v/100` (`ImageEnhance.Contrast`).
- Combined settings run contrast, then brightness, then the ink curves (the order the
  Gutenprint driver uses), chained in floating point, rounded once and clamped to 0–255.

Why canvas instead of CSS filters: CSS has no per-channel control (SVG filters do, but in
linearRGB by default, which changes the math), can't produce a file, and prints differently
per browser. The page computes every pixel with lookup tables on a canvas and exports the
PNG; CSS only lays out the page.

## Development

No build step and no dependencies. ES modules don't load from `file://`, so serve the folder:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000. Run the tests (Node 22+) with:

```bash
npm test
```

| File | What it does |
| --- | --- |
| `js/adjust.js` | Color math: lookup tables for any mix of the five adjustments |
| `js/patterns.js` | The hexagon, grid and strip patterns, their labels and validation |
| `js/layout.js` | Page geometry: grid fitting, hexagon offsets, portrait or landscape |
| `js/png.js` | Adds the 300 DPI (`pHYs`) and sRGB chunks the canvas encoder leaves out |
| `js/render.js` | Decodes and downsamples the photo, draws the sheet, exports the PNG |
| `js/main.js` | Form, preview, click-to-preset, download and print |

GitHub Pages serves the repository root of `main`; `.nojekyll` turns off Jekyll processing.
