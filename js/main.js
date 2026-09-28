// UI wiring: read the form, build the pattern, render the sheet, download or print it.

import { AXES, formatValue, NEUTRAL } from './adjust.js';
import { PAPERS } from './layout.js';
import { buildPattern, describeSettings } from './patterns.js';
import { exportPng, loadImage, renderSheet } from './render.js';

const form = document.querySelector('#controls');
const fields = form.elements;
const dropZone = document.querySelector('#drop-zone');
const fileLabel = document.querySelector('#file-name');
const summary = document.querySelector('#summary');
const message = document.querySelector('#message');
const preview = document.querySelector('#preview');
const sheet = document.querySelector('#sheet');
const printImage = document.querySelector('#print-image');
const downloadButton = document.querySelector('#download');
const printButton = document.querySelector('#print');
const resetButton = document.querySelector('#reset-preset');
const pageRule = document.querySelector('#page-rule');
// Preset sliders by adjustment. The number boxes next to them hold the value the form reads.
const sliders = Object.fromEntries([...form.querySelectorAll('.slider')].map((s) => [s.dataset.for, s]));

let photo = null; // { image, name }
let shown = null; // { pattern, layout } of the sheet on screen
let ready = false;
let renders = 0;
let renderTimer = 0;
let dragDepth = 0;

function settings() {
  const number = (name) => fields[name].valueAsNumber;
  return {
    pattern: fields.pattern.value,
    preset: Object.fromEntries(AXES.map((axis) => [axis, number(axis)])),
    hexagon: { rings: Number(fields.rings.value), step: number('hexStep') },
    grid: { size: Number(fields.gridSize.value), step: number('gridStep') },
    strip: { axis: fields.axis.value, min: number('min'), max: number('max'), step: number('step') },
    paper: fields.paper.value,
  };
}

function render() {
  clearTimeout(renderTimer);
  renderTimer = 0;
  renders += 1;
  clearPrintImage();
  const current = settings();
  form.dataset.pattern = current.pattern;
  setPage(current.paper, shown?.layout.orientation ?? 'portrait');

  const pattern = buildPattern(current);
  showMessage(pattern.error, 'error');
  summary.textContent = pattern.error ? '' : describe(pattern, current);
  ready = Boolean(photo) && !pattern.error;
  downloadButton.disabled = !ready;
  printButton.disabled = !ready;
  sheet.classList.toggle('stale', Boolean(pattern.error));
  if (!ready) return;

  const layout = renderSheet(sheet, { image: photo.image, fileName: photo.name, pattern, paper: current.paper });
  shown = { pattern, layout };
  setPage(current.paper, layout.orientation);
  summary.textContent = `${describe(pattern, current)} · ${PAPERS[current.paper].name} ${layout.orientation}`;
  sheet.hidden = false;
  preview.classList.add('has-sheet');
}

function setPage(paper, orientation) {
  pageRule.textContent = `@page { size: ${PAPERS[paper].css} ${orientation}; margin: 0; }`;
  preview.dataset.paper = paper;
}

function describe(pattern, { pattern: kind, preset, strip }) {
  const count = `${pattern.cells.length} ${pattern.cells.length === 1 ? 'variation' : 'variations'}`;
  if (kind !== 'strip') return count;
  const values = pattern.cells.map((cell) => cell.settings[strip.axis]);
  const list = values.length <= 9
    ? values.map(formatValue).join(', ')
    : `${formatValue(values[0])} to ${formatValue(values.at(-1))}`;
  const value = preset[strip.axis];
  const missing = !pattern.cells.some((cell) => cell.current) && value > strip.min && value < strip.max;
  return `${count}: ${list}${missing ? ` · your preset (${formatValue(value)}) is not on this sheet` : ''}`;
}

// Typing waits for a pause. Dragging a slider keeps re-rendering while it moves: a render that
// is already queued is kept, because it reads the latest values when it runs.
function scheduleRender({ live = false } = {}) {
  if (live && renderTimer) return;
  clearTimeout(renderTimer);
  renderTimer = setTimeout(render, live ? 60 : 120);
}

function setPreset(values) {
  for (const axis of AXES) {
    fields[axis].value = String(values[axis]);
    sliders[axis].value = String(values[axis]);
  }
}

// Catch up on a pending re-render so downloads and prints always match the form.
function flushRender() {
  if (renderTimer) render();
}

function showMessage(text, kind = 'info') {
  message.textContent = text ?? '';
  message.dataset.kind = kind;
}

async function openFile(file) {
  if (!file) return;
  showMessage(`Opening ${file.name}…`);
  try {
    photo = { image: await loadImage(file), name: file.name };
    fileLabel.textContent = file.name;
    dropZone.classList.add('has-file');
    render();
  } catch (error) {
    showMessage(error.message, 'error');
  }
}

async function download() {
  flushRender();
  if (!ready) return;
  const name = `calibration_${shown.pattern.slug}_${fields.paper.value}.png`;
  downloadButton.disabled = true;
  try {
    const url = URL.createObjectURL(await exportPng(sheet));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (error) {
    showMessage(error.message, 'error');
  } finally {
    downloadButton.disabled = !ready;
  }
}

// The Print button prints the same PNG bytes a download would contain. A plain Cmd+P can't
// wait for the encoder, so it falls back to printing the canvas (same pixels).
async function printSheet() {
  flushRender();
  if (!ready) return;
  printButton.disabled = true;
  const rendered = renders;
  try {
    printImage.src = URL.createObjectURL(await exportPng(sheet));
    await printImage.decode();
    if (rendered === renders) {
      preview.classList.add('print-image-ready');
    } else {
      // The form changed while encoding, so the canvas is newer than the PNG: print that.
      clearPrintImage();
      if (!ready) return;
    }
    window.print();
  } catch (error) {
    showMessage(error.message, 'error');
  } finally {
    printButton.disabled = !ready;
  }
}

function clearPrintImage() {
  preview.classList.remove('print-image-ready');
  if (printImage.src) {
    URL.revokeObjectURL(printImage.src);
    printImage.removeAttribute('src');
  }
}

// Clicking a variation (or its label) makes its values the preset, which re-centers the
// color balance and brightness × contrast patterns on it.
function pickVariation(event) {
  if (!ready || !shown) return;
  const rect = sheet.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * sheet.width;
  const y = ((event.clientY - rect.top) / rect.height) * sheet.height;
  const { cells, band } = shown.layout;
  const index = cells.findIndex((c) => x >= c.x && x <= c.x + c.width && y >= c.y && y <= c.y + c.height + band);
  if (index === -1) return;
  const picked = shown.pattern.cells[index].settings;
  setPreset(picked);
  render();
  showMessage(`Preset: ${describeSettings(picked)}`);
}

form.addEventListener('submit', (event) => event.preventDefault());
form.addEventListener('input', ({ target }) => {
  if (target === fields.photo) return;
  if (target.classList.contains('slider')) {
    fields[target.dataset.for].value = target.value;
    scheduleRender({ live: true });
    return;
  }
  // A typed preset moves its slider too; invalid entries stay in the box and show an error.
  if (sliders[target.name] && Number.isFinite(target.valueAsNumber)) sliders[target.name].value = target.value;
  scheduleRender();
});
fields.photo.addEventListener('change', () => openFile(fields.photo.files[0]));
resetButton.addEventListener('click', () => {
  setPreset(NEUTRAL);
  render();
});
for (const [axis, slider] of Object.entries(sliders)) {
  slider.addEventListener('dblclick', () => {
    slider.value = '0';
    fields[axis].value = '0';
    render();
  });
}
sheet.addEventListener('click', pickVariation);
downloadButton.addEventListener('click', download);
printButton.addEventListener('click', printSheet);
window.addEventListener('beforeprint', flushRender);
window.addEventListener('afterprint', clearPrintImage);

// Accept a photo dropped anywhere on the page, not just on the drop zone.
const carriesFiles = (event) => event.dataTransfer?.types.includes('Files');
document.addEventListener('dragenter', (event) => {
  if (!carriesFiles(event)) return;
  dragDepth += 1;
  dropZone.classList.add('dragging');
});
document.addEventListener('dragleave', (event) => {
  if (!carriesFiles(event)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropZone.classList.remove('dragging');
});
document.addEventListener('dragover', (event) => {
  if (carriesFiles(event)) event.preventDefault();
});
document.addEventListener('drop', (event) => {
  if (!carriesFiles(event)) return;
  event.preventDefault();
  dragDepth = 0;
  dropZone.classList.remove('dragging');
  openFile(event.dataTransfer.files[0]);
});

render();
