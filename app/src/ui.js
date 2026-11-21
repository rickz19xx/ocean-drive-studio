/* ui.js — page wiring: photo in, crop controls, size presets, export.
   The studio keeps one mutable design object (from poster.js); everything
   here either edits it or asks poster.js to paint it. */

import { PANEL_COUNTS, SIZE_PRESETS, createDesign, renderPoster, resetCrops, shuffleCrops } from './poster.js';
import {
  coverRect,
  hitPanel,
  localPoint,
  panByDrag,
  pickFocusPoints,
  thumbRect,
  zoomAtPoint,
} from './crop.js';
import { SAMPLE_PHOTOS, parseQuery, photoUrl, runShot } from './shots.js';
import { createCanvas, ctx2d, saliencyMap } from './art.js';

const $ = (id) => document.getElementById(id);

const els = {
  shot: $('shot'),
  shotCanvas: $('shotCanvas'),
  preview: $('preview'),
  sizes: $('sizes'),
  title: $('title'),
  subtitle: $('subtitle'),
  strapTop: $('strapTop'),
  strapBottom: $('strapBottom'),
  file: $('file'),
  drop: $('drop'),
  thumbs: $('thumbs'),
  panelList: $('panelList'),
  exportBtn: $('exportBtn'),
  shuffleBtn: $('shuffle'),
  resetBtn: $('resetZoom'),
  reseedBtn: $('reseed'),
  grade: $('grade'),
  grain: $('grain'),
  statSize: $('statSize'),
  hint: $('hint'),
};

const state = {
  design: null,
  source: { image: null, width: 0, height: 0 },
  focusPoints: null,
  photoName: SAMPLE_PHOTOS[0],
  caption: 'Sunset Heist',
  subtitle: 'a cover studio original',
  strapTop: 'MAKEFUN PICTURES PRESENTS',
  strapBottom: 'SIX FRAMES  ·  ONE SUNSET',
  size: SIZE_PRESETS[0],
  count: 6,
  seed: 1,
  grade: 1,
  grain: 1,
  selected: null,
  coverShot: false,
  draft: null,
  rafId: 0,
  dragging: false,
  softTimer: 0,
  objectUrl: null,
  drag: null,
};

/* ------------------------------------------------------------- geometry */

const viewport = () => ({
  w: Math.max(320, Math.round(window.innerWidth || 1280)),
  h: Math.max(320, Math.round(window.innerHeight || 720)),
});

const sheetSize = () => (state.coverShot ? viewport() : { w: state.size.w, h: state.size.h });

/** Rebuild the sheet for the current size / panel count / seed. */
function rebuildDesign(keepCrops) {
  const { w, h } = sheetSize();
  const saved = keepCrops && state.design
    ? state.design.panels.map((p) => ({ crop: { ...p.crop }, recipe: p.recipe, tone: p.tone }))
    : null;
  state.design = createDesign({
    w,
    h,
    count: state.count,
    seed: state.seed,
    focusPoints: state.focusPoints,
  });
  if (saved) {
    state.design.panels.forEach((p, i) => {
      const s = saved[i];
      if (!s) return;
      p.crop = s.crop;
      p.recipe = s.recipe;
      p.tone = s.tone;
    });
  }
  if (state.selected != null && state.selected >= state.design.panels.length) state.selected = null;
  return state.design;
}

function view() {
  return {
    source: state.source,
    caption: state.caption,
    subtitle: state.subtitle,
    strapTop: state.strapTop,
    strapBottom: state.strapBottom,
    grade: state.grade,
    grain: state.grain,
    selected: state.coverShot ? null : state.selected,
  };
}

/* ------------------------------------------------------------- painting */

function render() {
  const d = state.design;
  const canvas = state.coverShot ? els.shotCanvas : els.preview;
  if (!d) return;
  if (canvas.width !== d.w || canvas.height !== d.h) {
    canvas.width = d.w;
    canvas.height = d.h;
  }
  renderPoster(canvas, d, view());
  if (state.coverShot) {
    markReady();
  } else {
    els.statSize.textContent = `${d.w} × ${d.h}`;
    syncPanels();
    drawThumbs();
  }
}

/** Half-size pass used while dragging: same design, quarter the pixels. */
function draftRender() {
  const d = state.design;
  if (!d || !state.source.image) {
    render();
    return;
  }
  const w = Math.max(160, Math.round(d.w * 0.55));
  const h = Math.max(160, Math.round(d.h * 0.55));
  if (!state.draft || state.draft.canvas.width !== w || state.draft.canvas.height !== h) {
    state.draft = { canvas: createCanvas(w, h), design: createDesign({ w, h, count: state.count, seed: state.seed }) };
  }
  const dd = state.draft.design;
  dd.panels.forEach((p, i) => {
    const src = d.panels[i];
    if (!src) return;
    p.crop = src.crop;
    p.recipe = src.recipe;
    p.tone = src.tone;
  });
  const v = view();
  v.selected = null;
  renderPoster(state.draft.canvas, dd, v);

  const canvas = els.preview;
  const ctx = ctx2d(canvas);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(state.draft.canvas, 0, 0, canvas.width, canvas.height);
  syncPanels();
  drawThumbs();
}

function schedule() {
  if (state.rafId) return;
  state.rafId = requestAnimationFrame(() => {
    state.rafId = 0;
    if (state.dragging) draftRender();
    else render();
  });
}

/** Treat the next stretch of input as a live gesture (cheap renders), then settle. */
function softWindow(ms = 140) {
  state.dragging = true;
  clearTimeout(state.softTimer);
  state.softTimer = setTimeout(() => {
    state.dragging = false;
    schedule();
  }, ms);
}

function markReady() {
  // Synchronous on purpose: a hidden/headless tab may never fire another
  // animation frame, so the flag must not depend on one.
  window.__coverReady = true;
  window.__shotReady = true;
}

/* --------------------------------------------------------------- panels */

function syncPanels() {
  const rows = els.panelList.querySelectorAll('.panel');
  rows.forEach((row, i) => {
    const p = state.design.panels[i];
    if (!p) return;
    row.classList.toggle('on', state.selected === i);
    const em = row.querySelector('em');
    if (em) em.textContent = `${p.crop.zoom.toFixed(2)}×`;
  });
}

function buildPanelList() {
  els.panelList.textContent = '';
  state.design.panels.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'panel';

    const head = document.createElement('div');
    head.className = 'head';
    const num = document.createElement('b');
    num.textContent = String(i + 1).padStart(2, '0');
    const who = document.createElement('span');
    who.textContent = p.hero ? 'hero' : 'panel';
    const zoom = document.createElement('em');
    zoom.textContent = `${p.crop.zoom.toFixed(2)}×`;
    head.append(num, who, zoom);

    const mini = document.createElement('canvas');
    mini.className = 'mini';
    mini.width = 150;
    mini.height = 34;

    row.append(head, mini);
    row.addEventListener('click', () => {
      state.selected = i;
      syncPanels();
      schedule();
    });
    els.panelList.append(row);
  });
}

function drawThumbs() {
  const src = state.source.image;
  if (!src) return;
  const rows = els.panelList.querySelectorAll('.panel');
  rows.forEach((row, i) => {
    const p = state.design.panels[i];
    const mini = row.querySelector('canvas.mini');
    if (!p || !mini) return;
    const r = thumbRect(
      coverRect(src.width, src.height, mini.width, mini.height, p.crop.zoom, 0, 0, p.crop.focus),
      src.width,
      src.height,
    );
    const ctx = ctx2d(mini);
    ctx.clearRect(0, 0, mini.width, mini.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, mini.width, mini.height);
    ctx.save();
    ctx.globalCompositeOperation = 'soft-light';
    ctx.globalAlpha = 0.65;

    const g = ctx.createLinearGradient(0, 0, mini.width, mini.height);
    g.addColorStop(0, 'rgba(255,150,60,0.9)');
    g.addColorStop(0.55, 'rgba(150,90,200,0.5)');
    g.addColorStop(1, 'rgba(40,200,200,0.85)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, mini.width, mini.height);
    ctx.restore();
  });
}

/* ---------------------------------------------------------------- photo */

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${url}`));
    img.src = url;
  });
}

async function loadPhoto(url) {
  const img = await loadImage(url);
  // decode() is a nicety; in some Chrome builds it can stall for a detached
  // image, so it never gets to block the first honest draw.
  if (img.decode) {
    await Promise.race([
      img.decode().catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 400)),
    ]);
  }
  state.source = { image: img, width: img.naturalWidth || img.width, height: img.naturalHeight || img.height };
  state.focusPoints = focusPointsFor(img);
  rebuildDesign(false);
  return img;
}

/** Aim the panels at the photo's busy spots before the first draw. */
function focusPointsFor(img) {
  try {
    const map = saliencyMap(img);
    return pickFocusPoints(map, state.count, state.seed) || null;
  } catch (err) {
    return null;
  }
}

function loadSample(name) {
  return loadPhoto(photoUrl(name)).then(() => {
    state.photoName = name;
    markThumb(name);
    schedule();
  });
}

function loadFile(file) {
  if (!file || !/^image\//i.test(file.type || '')) {
    reportError('that file is not an image');
    return;
  }
  if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
  state.objectUrl = URL.createObjectURL(file);
  state.photoName = 'local';
  markThumb('');
  loadPhoto(state.objectUrl)
    .then(() => {
      setHint('drag a panel to pan · scroll over one to zoom');
      schedule();
    })
    .catch(() => reportError('could not read that file'));
}

function buildSampleThumbs() {
  els.thumbs.textContent = '';
  SAMPLE_PHOTOS.forEach((name) => {
    const box = document.createElement('div');
    box.className = 'thumb';
    box.dataset.name = name;
    box.title = `samples/${name}.jpg`;
    const c = document.createElement('canvas');
    c.width = 132;
    c.height = 132;
    box.append(c);
    box.addEventListener('click', () => {
      loadSample(name).catch(() => reportError(`samples/${name}.jpg is missing`));
    });
    els.thumbs.append(box);

    loadImage(photoUrl(name))
      .then((img) => {
        const r = coverRect(img.naturalWidth, img.naturalHeight, 132, 132, 1, 0, 0, { x: 0.5, y: 0.45 });
        const ctx = ctx2d(c);
        ctx.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, 132, 132);
      })
      .catch(() => {});
  });
}

function markThumb(name) {
  els.thumbs.querySelectorAll('.thumb').forEach((el) => {
    el.classList.toggle('on', el.dataset.name === name);
  });
}

/* --------------------------------------------------------------- export */

function exportPng() {
  const d = state.design;
  if (!d || !state.source.image) {
    reportError('load a photo first');
    return;
  }
  const keep = state.selected;
  state.selected = null;
  state.dragging = false;
  render();
  const canvas = state.coverShot ? els.shotCanvas : els.preview;
  const name = `cover-${d.w}x${d.h}.png`;
  const done = () => {
    state.selected = keep;
    render();
  };
  if (!canvas.toBlob) {
    reportError('this browser cannot export PNG');
    done();
    return;
  }
  canvas.toBlob((blob) => {
    if (!blob) {
      reportError('export failed');
      done();
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 8000);
    setHint(`exported ${name}`);
    done();
  }, 'image/png');
}

/* ----------------------------------------------------------------- wiring */

const api = {
  viewport,
  setPanelCount(n) {
    if (!PANEL_COUNTS.includes(n)) return;
    state.count = n;
    if (state.source.image) state.focusPoints = focusPointsFor(state.source.image);
    rebuildDesign(true);
    buildPanelList();
  },
  setSize(preset) {
    if (!preset) return;
    state.size = preset;
    rebuildDesign(true);
    syncSizeButtons();
  },
  setFields(fields = {}) {
    if (fields.caption) {
      state.caption = fields.caption;
      els.title.value = fields.caption;
    }
    if (fields.subtitle) {
      state.subtitle = fields.subtitle;
      els.subtitle.value = fields.subtitle;
    }
    if (fields.strapTop) {
      state.strapTop = fields.strapTop;
      els.strapTop.value = fields.strapTop;
    }
    if (fields.strapBottom) {
      state.strapBottom = fields.strapBottom;
      els.strapBottom.value = fields.strapBottom;
    }
  },
  setSeed(seed) {
    state.seed = (seed >>> 0) || 1;
    if (state.source.image) state.focusPoints = focusPointsFor(state.source.image);
    rebuildDesign(false);
  },
  loadPhoto,
  loadSample,
  render,
  markReady,
  reportError,
  enterCoverShot() {
    state.coverShot = true;
    state.selected = null;
    document.body.classList.add('shot');
    sizeShotCanvas();
    // If anything in the load chain ever stalls, the shot still lands.
    setTimeout(() => {
      if (window.__coverReady) return;
      try {
        sizeShotCanvas();
        rebuildDesign(true);
        render();
      } catch (err) {
        /* nothing left to try */
      }
      markReady();
    }, 3500);
  },
  enterEditorShot() {
    state.coverShot = false;
    document.body.classList.remove('shot');
  },
};

function setHint(text) {
  if (els.hint) els.hint.textContent = text;
}

function reportError(message) {
  setHint(message);
  if (window.console) console.warn(message);
}

function sizeShotCanvas() {
  const { w, h } = viewport();
  if (els.shotCanvas.width !== w || els.shotCanvas.height !== h) {
    els.shotCanvas.width = w;
    els.shotCanvas.height = h;
  }
}

function buildSizeButtons() {
  els.sizes.textContent = '';
  SIZE_PRESETS.forEach((preset) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = preset.label;
    b.dataset.id = preset.id;
    b.title = preset.note;
    b.addEventListener('click', () => {
      api.setSize(preset);
      schedule();
    });
    els.sizes.append(b);
  });
  syncSizeButtons();
}

function syncSizeButtons() {
  els.sizes.querySelectorAll('button').forEach((b) => {
    b.classList.toggle('on', !state.coverShot && b.dataset.id === state.size.id);
  });
}

/* ------------------------------------------------------------- gestures */

function posterPoint(ev) {
  const rect = els.preview.getBoundingClientRect();
  const sx = state.design.w / Math.max(1, rect.width);
  const sy = state.design.h / Math.max(1, rect.height);
  return {
    x: (ev.clientX - rect.left) * sx,
    y: (ev.clientY - rect.top) * sy,
    cssPerPoster: Math.max(1, rect.width) / state.design.w,
  };
}

function onPointerDown(ev) {
  if (state.coverShot || !state.source.image) return;
  const p = posterPoint(ev);
  const index = hitPanel(state.design.panels, p.x, p.y);
  if (index < 0) return;
  state.selected = index;
  state.drag = { index, x: ev.clientX, y: ev.clientY, cssPerPoster: p.cssPerPoster };
  state.dragging = true;
  els.preview.classList.add('dragging');
  if (els.preview.setPointerCapture) els.preview.setPointerCapture(ev.pointerId);
  syncPanels();
}

function onPointerMove(ev) {
  const drag = state.drag;
  if (!drag) return;
  const panel = state.design.panels[drag.index];
  if (!panel) return;
  const cssPerPoster = drag.cssPerPoster;
  const dragX = (ev.clientX - drag.x) * cssPerPoster;
  const dragY = (ev.clientY - drag.y) * cssPerPoster;
  drag.x = ev.clientX;
  drag.y = ev.clientY;
  panel.crop.focus = panByDrag(
    panel.crop.focus,
    panel.crop.zoom,
    state.source.width,
    state.source.height,
    panel.rect.w,
    panel.rect.h,
    panel.rect.w * cssPerPoster,
    panel.rect.h * cssPerPoster,
    dragX,
    dragY,
  );
  schedule();
}

function onPointerUp(ev) {
  if (!state.drag) return;
  state.drag = null;
  state.dragging = false;
  els.preview.classList.remove('dragging');
  if (els.preview.releasePointerCapture && ev && ev.pointerId != null) {
    try {
      els.preview.releasePointerCapture(ev.pointerId);
    } catch (err) {
      /* pointer already gone */
    }
  }
  schedule();
}

function onWheel(ev) {
  if (state.coverShot || !state.source.image) return;
  ev.preventDefault();
  const p = posterPoint(ev);
  const index = hitPanel(state.design.panels, p.x, p.y);
  if (index < 0) return;
  const panel = state.design.panels[index];
  state.selected = index;
  const lp = localPoint(p.x, p.y, panel.rect);
  const factor = Math.exp(-ev.deltaY * 0.0016);
  const res = zoomAtPoint(
    panel.crop.focus,
    panel.crop.zoom,
    factor,
    state.source.width,
    state.source.height,
    panel.rect.w,
    panel.rect.h,
    lp.x,
    lp.y,
  );
  panel.crop.zoom = res.zoom;
  panel.crop.focus = res.focus;
  softWindow(160);
  schedule();
}

function wireControls() {
  els.preview.addEventListener('pointerdown', onPointerDown);
  els.preview.addEventListener('pointermove', onPointerMove);
  els.preview.addEventListener('pointerup', onPointerUp);
  els.preview.addEventListener('pointercancel', onPointerUp);
  els.preview.addEventListener('pointerleave', onPointerUp);
  els.preview.addEventListener('wheel', onWheel, { passive: false });

  els.drop.addEventListener('click', () => els.file.click());
  els.file.addEventListener('change', () => {
    if (els.file.files && els.file.files[0]) loadFile(els.file.files[0]);
  });
  for (const type of ['dragenter', 'dragover']) {
    els.drop.addEventListener(type, (ev) => {
      ev.preventDefault();
      els.drop.classList.add('over');
    });
  }
  for (const type of ['dragleave', 'drop']) {
    els.drop.addEventListener(type, (ev) => {
      ev.preventDefault();
      els.drop.classList.remove('over');
    });
  }
  els.drop.addEventListener('drop', (ev) => {
    const file = ev.dataTransfer && ev.dataTransfer.files ? ev.dataTransfer.files[0] : null;
    if (file) loadFile(file);
  });

  const bind = (el, key) => {
    if (!el) return;
    el.addEventListener('input', () => {
      state[key] = el.value;
      softWindow(220);
      schedule();
    });
  };
  bind(els.title, 'caption');
  bind(els.subtitle, 'subtitle');
  bind(els.strapTop, 'strapTop');
  bind(els.strapBottom, 'strapBottom');

  els.grade.addEventListener('input', () => {
    state.grade = Number(els.grade.value) / 100;
    softWindow(220);
    schedule();
  });
  els.grain.addEventListener('input', () => {
    state.grain = Number(els.grain.value) / 100;
    softWindow(220);
    schedule();
  });

  els.exportBtn.addEventListener('click', exportPng);
  els.shuffleBtn.addEventListener('click', () => {
    shuffleCrops(state.design);
    state.selected = null;
    schedule();
  });
  els.resetBtn.addEventListener('click', () => {
    resetCrops(state.design);
    for (const p of state.design.panels) p.crop.focus = { x: 0.5, y: 0.5 };
    schedule();
  });
  els.reseedBtn.addEventListener('click', () => {
    state.seed = (Math.imul(state.seed, 1664525) + 1013904223) >>> 0;
    if (state.source.image) state.focusPoints = focusPointsFor(state.source.image);
    rebuildDesign(false);
    buildPanelList();
    schedule();
  });

  window.addEventListener('resize', () => {
    if (!state.coverShot) return;
    sizeShotCanvas();
    rebuildDesign(true);
    schedule();
  });
}

/* ------------------------------------------------------------------ boot */

function seedFields() {
  els.title.value = state.caption;
  els.subtitle.value = state.subtitle;
  els.strapTop.value = state.strapTop;
  els.strapBottom.value = state.strapBottom;
}

async function boot() {
  const request = parseQuery(window.location.search);
  state.seed = request.seed || 1;
  state.size = request.size || SIZE_PRESETS[0];
  state.count = request.panels || 6;
  state.caption = request.caption;
  state.subtitle = request.subtitle;
  state.strapTop = request.strapTop;
  state.strapBottom = request.strapBottom;

  buildSizeButtons();
  seedFields();
  rebuildDesign(false);
  buildPanelList();
  wireControls();

  if (request.mode === 'app') {
    buildSampleThumbs();
    render();
    setHint('drop a photo in, then drag a panel to frame it');
    return;
  }
  await runShot(request, api);
}

boot().catch((err) => {
  reportError(String((err && err.message) || err));
  window.__coverReady = true;
});
