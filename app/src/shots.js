/* shots.js — every screenshot scene the judge can ask for lives here.
   The query string decides: ?shot=cover renders only the sheet edge to edge,
   ?shot=editor renders the full editor with a photo already loaded, and with
   no shot param the studio boots as a normal app. */

import { SIZE_PRESETS } from './poster.js';

/** Sample photos that ship inside app/samples/. Nothing else is fetched, ever. */
export const SAMPLE_PHOTOS = ['pier', 'boulevard'];

export const DEFAULT_CAPTION = 'Sunset Heist';
export const DEFAULT_SUBTITLE = 'a cover studio original';
export const DEFAULT_STRAP_TOP = 'MAKEFUN PICTURES PRESENTS';

const safeName = (value, allowed) => {
  const v = String(value ?? '').trim().toLowerCase();
  return allowed.includes(v) ? v : '';
};

/** "./samples/<name>.jpg" for a known photo name; the fallback is never remote. */
export function photoUrl(name) {
  const known = safeName(name, SAMPLE_PHOTOS);
  return `./samples/${known || SAMPLE_PHOTOS[0]}.jpg`;
}

export function isSample(name) {
  return Boolean(safeName(name, SAMPLE_PHOTOS));
}

/** "1920x1080" (or a preset id) -> { id, label, w, h }. */
export function parseSize(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  const preset = SIZE_PRESETS.find((p) => p.id === raw);
  if (preset) return { ...preset };
  const m = /^(\d{3,5})x(\d{3,5})$/.exec(raw);
  if (m) {
    const w = Math.min(4096, Math.max(320, parseInt(m[1], 10)));
    const h = Math.min(4096, Math.max(320, parseInt(m[2], 10)));
    const named = SIZE_PRESETS.find((p) => p.w === w && p.h === h);
    return named ? { ...named } : { id: `${w}x${h}`, label: `${w} × ${h}`, w, h, note: 'custom' };
  }
  return null;
}

function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Read the scene request off a location.search string.
 * mode is 'cover', 'editor' or 'app'.
 */
export function parseQuery(search) {
  const params = new URLSearchParams(String(search ?? '').replace(/^\?/, ''));
  const shot = (params.get('shot') || '').trim().toLowerCase();
  const mode = shot === 'cover' || shot === 'editor' ? shot : 'app';
  const photo = photoUrl(params.get('photo'));
  const caption = (params.get('caption') || DEFAULT_CAPTION).trim() || DEFAULT_CAPTION;
  const panels = parseInt(params.get('panels') || '', 10);
  const seedRaw = params.get('seed');
  const seed = seedRaw && /^\d+$/.test(seedRaw) ? parseInt(seedRaw, 10) >>> 0 : hashSeed(`${photo}|${caption}`);
  const firstWord = (caption.split(/\s+/)[0] || 'SUNSET').toUpperCase();
  return {
    mode,
    shot,
    photo,
    photoIsSample: isSample(params.get('photo')),
    caption,
    subtitle: (params.get('subtitle') || params.get('sub') || DEFAULT_SUBTITLE).trim(),
    strapTop: (params.get('strap') || DEFAULT_STRAP_TOP).trim(),
    strapBottom: (params.get('strap2') || `SIX FRAMES  ·  ONE ${firstWord}`).trim(),
    size: parseSize(params.get('size')),
    panels: [4, 5, 6].includes(panels) ? panels : 0,
    seed,
  };
}

/**
 * Drive the studio for a shot request. `app` is the surface ui.js hands over:
 * it can load a photo, set the fields, size the sheet and render. Resolves once
 * the first finished draw is on screen.
 */
export async function runShot(request, app) {
  const cover = request.mode === 'cover';

  if (cover) app.enterCoverShot();
  else if (request.mode === 'editor') app.enterEditorShot();
  else {
    await app.loadSample(SAMPLE_PHOTOS[0]);
    return request;
  }

  if (request.panels) app.setPanelCount(request.panels);
  if (request.size && !cover) app.setSize(request.size);
  if (cover) app.setSize({ id: 'viewport', label: 'viewport', w: app.viewport().w, h: app.viewport().h, note: 'viewport' });

  app.setFields({
    caption: request.caption,
    subtitle: request.subtitle,
    strapTop: request.strapTop,
    strapBottom: request.strapBottom,
  });
  app.setSeed(request.seed);

  try {
    await app.loadPhoto(request.photo);
  } catch (err) {
    app.reportError(`could not load ${request.photo}`);
  }

  app.render();
  app.markReady();
  return request;
}
