/* crop.js — the maths behind "put this part of the photo in that panel".
   No canvas here, only rectangles, so the same numbers drive the live drag,
   the panel thumbnails and the final render. */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** A panel never zooms out past the whole photo, or in past this. */
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 3.6;

/** Which panel of the sheet (if any) sits under this poster-space point. */
export function hitPanel(panels, x, y) {
  for (let i = panels.length - 1; i >= 0; i -= 1) {
    const r = panels[i].rect;
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return i;
  }
  return -1;
}

/**
 * The source rectangle to sample so that a destW x destH panel is filled
 * completely (cover fit), then zoomed and aimed at a focus point.
 * focus is normalised 0..1 inside the photo; pan is normalised -1..1 inside
 * whatever slack the zoom leaves.
 */
export function coverRect(srcW, srcH, destW, destH, zoom = 1, panX = 0, panY = 0, focus = { x: 0.5, y: 0.5 }) {
  const aspect = (destW || 1) / (destH || 1);
  let w, h;
  if (srcW / srcH > aspect) {
    h = srcH;
    w = srcH * aspect;
  } else {
    w = srcW;
    h = srcW / aspect;
  }
  const z = clamp(zoom, ZOOM_MIN, ZOOM_MAX);
  w = Math.max(8, Math.min(srcW, w / z));
  h = Math.max(8, Math.min(srcH, h / z));

  const slackX = srcW - w;
  const slackY = srcH - h;
  const aimX = clamp(focus.x, 0, 1) * srcW + clamp(panX, -1, 1) * slackX * 0.5;
  const aimY = clamp(focus.y, 0, 1) * srcH + clamp(panY, -1, 1) * slackY * 0.5;
  return {
    x: clamp(aimX - w / 2, 0, slackX),
    y: clamp(aimY - h / 2, 0, slackY),
    w,
    h,
  };
}

/** Cover fit with no zoom — the starting point for a fresh photo. */
export function baseRect(srcW, srcH, destW, destH) {
  return coverRect(srcW, srcH, destW, destH, 1, 0, 0, { x: 0.5, y: 0.5 });
}

/**
 * Drag the photo inside a panel: the crop window slides against the pointer,
 * so the picture follows the hand. Distances arrive in CSS pixels of the
 * on-screen panel; the result is a new normalised focus point.
 */
export function panByDrag(focus, zoom, srcW, srcH, panelW, panelH, cssPanelW, cssPanelH, dragX, dragY) {
  const rect = coverRect(srcW, srcH, panelW, panelH, zoom, 0, 0, focus);
  const perCssX = rect.w / Math.max(1, cssPanelW);
  const perCssY = rect.h / Math.max(1, cssPanelH);
  const nx = clamp(rect.x - dragX * perCssX, 0, Math.max(0, srcW - rect.w));
  const ny = clamp(rect.y - dragY * perCssY, 0, Math.max(0, srcH - rect.h));
  return {
    x: clamp((nx + rect.w / 2) / srcW, 0.005, 0.995),
    y: clamp((ny + rect.h / 2) / srcH, 0.005, 0.995),
  };
}

/**
 * Wheel zoom that keeps the pixel under the cursor exactly where it is.
 * u, v are the pointer position inside the panel, normalised 0..1.
 */
export function zoomAtPoint(focus, zoom, factor, srcW, srcH, panelW, panelH, u, v) {
  const rect = coverRect(srcW, srcH, panelW, panelH, zoom, 0, 0, focus);
  const next = clamp(zoom * factor, ZOOM_MIN, ZOOM_MAX);
  const nw = Math.max(8, Math.min(srcW, (rect.w * zoom) / next));
  const nh = Math.max(8, Math.min(srcH, (rect.h * zoom) / next));
  const cx = clamp(u, 0, 1);
  const cy = clamp(v, 0, 1);
  const px = rect.x + cx * rect.w;
  const py = rect.y + cy * rect.h;
  const nx = clamp(px - cx * nw, 0, Math.max(0, srcW - nw));
  const ny = clamp(py - cy * nh, 0, Math.max(0, srcH - nh));
  return {
    zoom: next,
    focus: {
      x: clamp((nx + nw / 2) / srcW, 0.005, 0.995),
      y: clamp((ny + nh / 2) / srcH, 0.005, 0.995),
    },
  };
}

/** Where inside the panel rect did the pointer land, normalised 0..1. */
export function localPoint(px, py, rect) {
  return {
    x: clamp((px - rect.x) / Math.max(1, rect.w), 0, 1),
    y: clamp((py - rect.y) / Math.max(1, rect.h), 0, 1),
  };
}

/** Clamp a focus point, for the "fit panel" button and new photos. */
export function clampFocus(focus) {
  return { x: clamp(focus.x, 0.005, 0.995), y: clamp(focus.y, 0.005, 0.995) };
}

/** drawImage-safe view of a rect, used by the small panel thumbnails. */
export function thumbRect(rect, srcW, srcH) {
  const w = clamp(rect.w, 1, srcW);
  const h = clamp(rect.h, 1, srcH);
  return {
    x: clamp(rect.x, 0, Math.max(0, srcW - w)),
    y: clamp(rect.y, 0, Math.max(0, srcH - h)),
    w,
    h,
  };
}

function rngFrom(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Turn a saliency map (from art.js) into `count` well-spread crop targets,
 * best spots first. The zoom hint follows the score: the busier the spot, the
 * tighter the crop is allowed to be. Fully deterministic for a given seed.
 */
export function pickFocusPoints(map, count, seed = 1, opts = {}) {
  if (!map || !Array.isArray(map.cells) || !map.cells.length || count < 1) return null;
  const rng = rngFrom(seed);
  const minDist = opts.minDist ?? 0.26;
  const jitter = opts.jitter ?? 0.05;
  const pool = map.cells.slice().sort((a, b) => b.score - a.score);
  const picked = [];
  const jitterPoint = (c) => ({
    x: clamp(c.x + (rng() - 0.5) * jitter, 0.07, 0.93),
    y: clamp(c.y + (rng() - 0.5) * jitter, 0.07, 0.93),
    score: c.score,
  });

  for (const cell of pool) {
    if (picked.length >= count) break;
    const far = picked.every((p) => Math.hypot(p.x - cell.x, p.y - cell.y) >= minDist);
    if (far) picked.push(jitterPoint(cell));
  }
  // a small sheet cannot always fit well-spread points: relax the spacing
  for (let relax = minDist; picked.length < count && relax > 0.05; relax *= 0.75) {
    for (const cell of pool) {
      if (picked.length >= count) break;
      const far = picked.every((p) => Math.hypot(p.x - cell.x, p.y - cell.y) >= relax);
      if (far) picked.push(jitterPoint(cell));
    }
  }
  while (picked.length < count) {
    picked.push(jitterPoint(pool[picked.length % pool.length]));
  }
  return picked.slice(0, count).map((p, i) => ({
    x: p.x,
    y: p.y,
    score: p.score,
    // the busiest spots get the tight crops, the calm ones keep their context
    zoom: i === 0 ? 1.0 + (1 - p.score) * 0.25 : 1.25 + (1 - p.score) * 1.05,
  }));
}
