/* poster.js — the sheet itself: asymmetric panel grid, art-deco frame,
   strap lines and the caption band. It owns the layout; ui.js only edits
   the crop of each panel. */

import {
  FONT_DISPLAY,
  FONT_MONO,
  FONT_UI,
  bloom,
  blurInPlace,
  createCanvas,
  ctx2d,
  drawBackdrop,
  drawGradedPhoto,
  drawTracked,
  film,
  fitFontSize,
  font,
  hairline,
  keyline,
  lgradient,
  makeRng,
  measureTracked,
  shard,
  sunDisc,
  vgradient,
  vignette,
  wrapText,
} from './art.js';
import { coverRect } from './crop.js';

export const SIZE_PRESETS = [
  { id: 'square', label: '1080 × 1080', w: 1080, h: 1080, note: 'square' },
  { id: 'poster', label: '1080 × 1350', w: 1080, h: 1350, note: 'portrait' },
  { id: 'wide', label: '1920 × 1080', w: 1920, h: 1080, note: 'widescreen' },
];

export const PANEL_COUNTS = [4, 5, 6];

/* Panel grids, normalised inside the panel area. Deliberately uneven:
   one hero panel plus a run of small ones, and the bottom strips are cut on
   the slant that gives the whole thing its collage energy. [x, y, w, h, slant] */
const LAYOUTS = {
  4: [
    [0.0, 0.0, 0.58, 0.66, 0],
    [0.6, 0.0, 0.4, 0.32, 0],
    [0.6, 0.34, 0.4, 0.32, 0],
    [0.0, 0.68, 1.0, 0.32, -0.1],
  ],
  5: [
    [0.0, 0.0, 0.42, 0.62, 0],
    [0.44, 0.0, 0.56, 0.3, 0],
    [0.44, 0.32, 0.28, 0.3, 0],
    [0.74, 0.32, 0.26, 0.3, 0],
    [0.0, 0.64, 0.56, 0.36, -0.085],
    [0.58, 0.64, 0.42, 0.36, 0.085],
  ],
  6: [
    [0.0, 0.0, 0.42, 1.0, 0],
    [0.44, 0.0, 0.56, 0.3, 0],
    [0.44, 0.32, 0.28, 0.3, 0],
    [0.74, 0.32, 0.26, 0.3, 0],
    [0.44, 0.64, 0.36, 0.36, -0.085],
    [0.82, 0.64, 0.18, 0.36, 0.085],
  ],
};

/* Five grade recipes so no two panels read the same. */
const RECIPES = [
  { grade: 1.0, warmth: 0.85, lightX: 0.22, lightY: 0.18, tone: 0 },
  { grade: 1.02, warmth: 0.12, lightX: 0.78, lightY: 0.22, tone: 1 },
  { grade: 1.16, warmth: 0.55, lightX: 0.46, lightY: 0.74, tone: 2 },
  { grade: 0.94, warmth: 0.68, lightX: 0.3, lightY: 0.48, tone: 3 },
  { grade: 1.06, warmth: 0.34, lightX: 0.66, lightY: 0.3, tone: 4 },
];

const TONES = [
  { mode: 'overlay', alpha: 0.42, stops: [[0, 'rgba(255,158,58,0.9)'], [1, 'rgba(24,178,196,0.55)']] },
  { mode: 'soft-light', alpha: 0.5, stops: [[0, 'rgba(58,232,222,0.9)'], [1, 'rgba(96,44,158,0.7)']] },
  { mode: 'overlay', alpha: 0.4, stops: [[0, 'rgba(255,92,148,0.8)'], [1, 'rgba(70,120,255,0.6)']] },
  { mode: 'soft-light', alpha: 0.45, stops: [[0, 'rgba(255,214,140,0.85)'], [1, 'rgba(255,92,60,0.6)']] },
  { mode: 'overlay', alpha: 0.38, stops: [[0, 'rgba(22,28,74,0.85)'], [1, 'rgba(255,196,96,0.7)']] },
];

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Build (or rebuild) the whole sheet geometry: frame, header, strap, caption
 * band, panel rectangles and one default crop per panel.
 */
export function createDesign(opts = {}) {
  const w = Math.max(320, Math.round(opts.w || 1080));
  const h = Math.max(320, Math.round(opts.h || 1080));
  const count = PANEL_COUNTS.includes(opts.count) ? opts.count : 5;
  const seed = (opts.seed >>> 0) || 1;
  const rng = makeRng(seed);

  const unit = Math.min(w, h);
  const m = Math.round(unit * 0.028);
  const frame = { x: m, y: m, w: w - m * 2, h: h - m * 2 };
  const headH = Math.round(Math.min(h * 0.075, frame.h * 0.1));
  const bandH = Math.round(Math.min(h * 0.2, frame.h * 0.27));
  const inset = Math.round(unit * 0.03);
  const gap = Math.round(unit * 0.013);
  const strapH = Math.round(headH * 0.62);

  const band = { x: frame.x, y: h - m - bandH, w: frame.w, h: bandH };
  const header = { x: frame.x, y: frame.y, w: frame.w, h: headH };
  const strap = { x: frame.x, y: band.y - strapH, w: frame.w, h: strapH };
  const area = {
    x: frame.x + inset,
    y: frame.y + headH + gap,
    w: frame.w - inset * 2,
    h: Math.max(120, strap.y - (frame.y + headH) - gap * 2),
  };

  const grid = LAYOUTS[count] || LAYOUTS[5];
  const gx = Math.round(area.w * 0.014);
  const gy = Math.round(area.h * 0.02);

  const panels = grid.map((g, i) => {
    const rect = {
      x: Math.round(area.x + g[0] * area.w + gx * 0.5),
      y: Math.round(area.y + g[1] * area.h + gy * 0.5),
      w: Math.round(g[2] * area.w - gx),
      h: Math.round(g[3] * area.h - gy),
    };
    const recipe = RECIPES[(i + seed) % RECIPES.length];
    const hero = i === 0;
    // golden-angle spread keeps every crop on a different part of the photo
    const ang = i * 2.39996 + rng() * 0.7;
    const rad = Math.sqrt((i + 0.5) / count);
    const fx = hero ? 0.5 + (rng() - 0.5) * 0.12 : 0.5 + Math.cos(ang) * rad * 0.33;
    const fy = hero ? 0.44 + (rng() - 0.5) * 0.1 : 0.5 + Math.sin(ang) * rad * 0.33;
    return {
      index: i,
      rect,
      hero,
      recipe,
      slant: g[4] || 0,
      crop: {
        focus: { x: clamp(fx, 0.1, 0.9), y: clamp(fy, 0.1, 0.9) },
        zoom: hero ? 1.02 + rng() * 0.16 : 1.3 + rng() * 0.75,
      },
      tone: TONES[(i * 2 + seed) % TONES.length],
    };
  });

  // If a saliency map was handed over, aim the crops at the interesting parts:
  // the biggest panel gets the busiest spot, and no two panels share a point.
  const points = Array.isArray(opts.focusPoints) ? opts.focusPoints : null;
  if (points && points.length) {
    const order = panels
      .map((p, i) => i)
      .sort((a, b) => panels[b].rect.w * panels[b].rect.h - panels[a].rect.w * panels[a].rect.h);
    order.forEach((pi, rank) => {
      const pt = points[rank % points.length];
      if (!pt) return;
      panels[pi].crop.focus = { x: clamp(pt.x, 0.06, 0.94), y: clamp(pt.y, 0.06, 0.94) };
      if (pt.zoom) panels[pi].crop.zoom = clamp(pt.zoom, 1, 3.4);
    });
  }

  return { w, h, count, seed, unit, m, frame, header, strap, band, area, panels };
}

/** Re-roll every crop but keep the layout (used by the Shuffle button). */
export function shuffleCrops(design) {
  const rng = makeRng((design.seed = (design.seed * 1664525 + 1013904223) >>> 0));
  const count = design.panels.length;
  for (const p of design.panels) {
    const ang = rng() * Math.PI * 2;
    const rad = 0.12 + rng() * 0.3;
    p.crop.focus = { x: clamp(0.5 + Math.cos(ang) * rad, 0.08, 0.92), y: clamp(0.5 + Math.sin(ang) * rad * 1.1, 0.08, 0.92) };
    p.crop.zoom = p.hero ? 1.0 + rng() * 0.25 : 1.3 + rng() * 1.2;
    p.recipe = RECIPES[Math.floor(rng() * RECIPES.length)];
    p.tone = TONES[Math.floor(rng() * TONES.length)];
  }
  return design;
}

/** Default focus for a freshly loaded photo: centre, slight upward bias. */
export function resetCrops(design) {
  for (const p of design.panels) {
    p.crop.focus = { x: 0.5, y: p.hero ? 0.45 : 0.5 };
    p.crop.zoom = p.hero ? 1.02 : 1.35;
  }
  return design;
}

/* ------------------------------------------------------------- the paint */

export function renderPoster(canvas, design, view = {}) {
  const { source, caption = 'Sunset Heist' } = view;
  const ctx = ctx2d(canvas, true);
  const { w, h, frame, header, strap, band, area, panels } = design;
  const grade = clamp(view.grade ?? 1, 0, 1.6);
  const grain = clamp(view.grain ?? 1, 0, 1.6);
  const src = source && source.image ? source.image : null;
  const srcW = (source && source.width) || w;
  const srcH = (source && source.height) || h;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.imageSmoothingQuality = 'high';

  /* 1. full-bleed painted backdrop */
  if (src) {
    const bleed = Math.round(design.unit * 0.06);
    drawBackdrop(ctx, src, srcW, srcH, w, h, { grade: 1.15 * grade, seed: design.seed, bleed });
  } else {
    ctx.fillStyle = vgradient(ctx, 0, 0, w, h, [[0, '#3a1f5c'], [0.5, '#8a3a5a'], [1, '#123a52']]);
    ctx.fillRect(0, 0, w, h);
  }

  /* 2. two accent shards slicing behind the collage */
  shard(ctx, -w * 0.06, h * 0.1, w * 0.9, h * 0.09, h * 0.05, [[0, 'rgba(255,150,58,0.85)'], [1, 'rgba(255,60,120,0)']], 'overlay', 0.5);
  shard(ctx, w * 0.2, h * 0.78, w * 0.95, h * 0.08, -h * 0.045, [[0, 'rgba(30,220,214,0.7)'], [1, 'rgba(120,70,220,0)']], 'overlay', 0.45);

  /* 3. smear the ground: it must read as painted dusk, never as a second photo */
  blurInPlace(ctx.canvas, Math.max(8, Math.round(design.unit * 0.024)), 'saturate(1.4) brightness(0.7)');

  /* 4. the panels */
  if (src) {
    for (const p of panels) {
      const r = p.rect;
      const shape = panelShape(r, p.slant);
      const dest = shape ? shape.dest : r;
      const sRect = coverRect(srcW, srcH, dest.w, dest.h, p.crop.zoom, 0, 0, p.crop.focus);
      const rec = p.recipe;

      ctx.save();
      if (shape) {
        tracePath(ctx, shape.points);
        ctx.clip();
      }
      drawGradedPhoto(ctx, src, sRect, dest, {
        grade: rec.grade * grade,
        lightX: rec.lightX,
        lightY: rec.lightY,
        warmth: rec.warmth,
      });
      const tone = p.tone;
      ctx.globalCompositeOperation = tone.mode;
      ctx.globalAlpha = tone.alpha * clamp(grade, 0, 1);
      ctx.fillStyle = lgradient(ctx, dest.x, dest.y, dest.w, dest.h, tone.stops);
      ctx.fillRect(dest.x, dest.y, dest.w, dest.h);
      ctx.restore();
    }

    /* 4. a tiny sun behind the top-right of the collage, bleeding between panels */
    const rng = makeRng(design.seed ^ 0x5bf03635);
    const sx = area.x + area.w * (rng() > 0.5 ? 0.82 : 0.18);
    const sy = area.y + area.h * 0.12;
    sunDisc(ctx, sx, sy, Math.min(area.w, area.h) * 0.34, {
      core: 'rgba(255,248,220,0.5)',
      halo: 'rgba(255,120,50,0)',
    });
  }

  /* 5. global painterly passes */
  bloom(ctx.canvas, {
    radius: Math.max(6, Math.round(design.unit * 0.026)),
    amount: 0.26 * grain,
    core: 0.22 * grain,
  });
  film(ctx.canvas, {
    seed: design.seed ^ 0x2f1a,
    grain: 0.05 * grain,
    chroma: 3.4 * clamp(grain, 0.2, 1.4),
    shadowAmount: 0.26 * clamp(grade, 0, 1.4),
  });

  filmDust(ctx, w, h, design.seed, 0.04 * clamp(grain, 0, 1.2));

  /* 6. deco frame, rules, strap lines */
  drawDeco(ctx, design);
  drawStrapLines(ctx, design, view);

  /* 7. panel keylines, corner ticks, number tags */
  for (const p of panels) {
    const on = view.selected === p.index;
    const color = on ? 'rgba(53,214,208,0.95)' : 'rgba(255,246,230,0.62)';
    const shape = panelShape(p.rect, p.slant);
    if (shape) {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = on ? 3 : 2;
      tracePath(ctx, shape.points);
      ctx.stroke();
      ctx.restore();
    } else {
      keyline(ctx, p.rect.x, p.rect.y, p.rect.w, p.rect.h, color, on ? 3 : 2);
      cornerTicks(ctx, p.rect, on ? 'rgba(53,214,208,0.95)' : 'rgba(255,240,214,0.5)');
    }
    drawTag(ctx, p, shape);
  }

  /* 8. the caption band, last so it stays crisp */
  drawCaptionBand(ctx, design, view);

  ctx.restore();
  return design;
}

/* ------------------------------------------------------------ components */

/**
 * A slanted panel: the same rectangle, cut as a parallelogram. `dest` is the
 * rectangle the photo is actually painted into, so nothing is left empty.
 */
function panelShape(rect, slant) {
  if (!slant) return null;
  const s = slant * rect.h;
  return {
    s,
    points: [
      [rect.x + s, rect.y],
      [rect.x + rect.w + s, rect.y],
      [rect.x + rect.w, rect.y + rect.h],
      [rect.x, rect.y + rect.h],
    ],
    dest: { x: rect.x + Math.min(0, s), y: rect.y, w: rect.w + Math.abs(s), h: rect.h },
  };
}

function tracePath(ctx, points) {
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i][0], points[i][1]);
  ctx.closePath();
}

function drawDeco(ctx, design) {
  const { frame, header, unit } = design;
  const outerLw = Math.max(2, Math.round(unit * 0.0032));
  const innerInset = Math.round(unit * 0.011);

  ctx.save();
  // double rule
  ctx.strokeStyle = 'rgba(255,244,224,0.88)';
  ctx.lineWidth = outerLw;
  ctx.strokeRect(frame.x + outerLw / 2, frame.y + outerLw / 2, frame.w - outerLw, frame.h - outerLw);
  ctx.strokeStyle = 'rgba(255,214,150,0.5)';
  ctx.lineWidth = Math.max(1, Math.round(outerLw * 0.5));
  ctx.strokeRect(
    frame.x + innerInset,
    frame.y + innerInset,
    frame.w - innerInset * 2,
    frame.h - innerInset * 2,
  );

  // corner brackets
  const bl = Math.round(unit * 0.05);
  const lw = Math.max(2, Math.round(unit * 0.006));
  ctx.strokeStyle = 'rgba(255,164,74,0.95)';
  ctx.lineWidth = lw;
  ctx.beginPath();
  const corners = [
    [frame.x, frame.y, 1, 1],
    [frame.x + frame.w, frame.y, -1, 1],
    [frame.x, frame.y + frame.h, 1, -1],
    [frame.x + frame.w, frame.y + frame.h, -1, -1],
  ];
  for (const [cx, cy, dx, dy] of corners) {
    ctx.moveTo(cx + dx * (innerInset + lw), cy);
    ctx.lineTo(cx + dx * (innerInset + lw + bl), cy);
    ctx.moveTo(cx, cy + dy * (innerInset + lw));
    ctx.lineTo(cx, cy + dy * (innerInset + lw + bl));
  }
  ctx.stroke();

  // rule under the header, with a deco segment
  hairline(ctx, header.x + innerInset, header.y + header.h, header.x + header.w - innerInset, header.y + header.h, 'rgba(255,240,216,0.4)', Math.max(1, Math.round(unit * 0.0016)));
  ctx.fillStyle = 'rgba(255,150,58,0.95)';
  const segW = header.w * 0.2;
  ctx.fillRect(header.x + innerInset, header.y + header.h - Math.round(unit * 0.0028), segW, Math.round(unit * 0.0056));
  diamond(ctx, header.x + innerInset + segW + unit * 0.02, header.y + header.h, unit * 0.009, 'rgba(255,240,216,0.75)');
  ctx.restore();
}

function diamond(ctx, x, y, r, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = color;
  ctx.fillRect(-r, -r, r * 2, r * 2);
  ctx.restore();
}

function drawStrapLines(ctx, design, view) {
  const { header, strap, frame, unit } = design;
  const top = view.strapTop || 'MAKEFUN PICTURES PRESENTS';
  const bottom = view.strapBottom || 'SIX FRAMES  ·  ONE SUNSET';
  const size = Math.max(9, Math.round(header.h * 0.245));
  const track = Math.max(1, size * 0.34);
  const pad = Math.round(unit * 0.032);

  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.font = font(size, FONT_UI, '700');
  ctx.fillStyle = 'rgba(255,244,226,0.9)';
  drawTracked(ctx, top.toUpperCase(), header.x + pad, header.y + header.h * 0.57, track);

  ctx.textAlign = 'right';
  const right = `A GTA-STYLE COVER  ·  No.${String(design.seed % 97).padStart(2, '0')}`;
  drawTracked(ctx, right, header.x + header.w - pad - measureTracked(ctx, right, track), header.y + header.h * 0.57, track);
  ctx.textAlign = 'left';

  // bottom strap, centred between two thin rules
  const by = strap.y + strap.h * 0.52;
  const bSize = Math.max(9, Math.round(strap.h * 0.42));
  const bTrack = Math.max(1.2, bSize * 0.42);
  ctx.font = font(bSize, FONT_UI, '700');
  const bw = measureTracked(ctx, bottom.toUpperCase(), bTrack);
  const bx = strap.x + (strap.w - bw) / 2;
  drawTracked(ctx, bottom.toUpperCase(), bx, by, bTrack);
  const gapx = Math.round(unit * 0.02);
  hairline(ctx, strap.x + unit * 0.05, by, bx - gapx, by, 'rgba(255,214,160,0.42)', 1);
  hairline(ctx, bx + bw + gapx, by, strap.x + strap.w - unit * 0.05, by, 'rgba(255,214,160,0.42)', 1);
  hairline(ctx, frame.x + unit * 0.02, design.band.y, frame.x + frame.w - unit * 0.02, design.band.y, 'rgba(255,244,224,0.75)', Math.max(2, Math.round(unit * 0.003)));
  ctx.restore();
}

function cornerTicks(ctx, r, color) {
  const t = Math.max(6, Math.round(Math.min(r.w, r.h) * 0.09));
  const lw = Math.max(2, Math.round(t * 0.22));
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.moveTo(r.x, r.y + t);
  ctx.lineTo(r.x, r.y);
  ctx.lineTo(r.x + t, r.y);
  ctx.moveTo(r.x + r.w - t, r.y);
  ctx.lineTo(r.x + r.w, r.y);
  ctx.lineTo(r.x + r.w, r.y + t);
  ctx.stroke();
  ctx.restore();
}

function drawTag(ctx, panel, shape) {
  const r = panel.rect;
  const size = Math.max(9, Math.round(Math.min(r.w, r.h) * 0.075));
  const pad = Math.round(size * 0.8);
  const inset = shape ? Math.max(0, shape.s) + Math.round(size * 0.6) : 0;
  ctx.save();
  ctx.font = font(size, FONT_MONO, '700');
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(10,8,20,0.55)';
  ctx.fillRect(r.x + pad - size * 0.4 + inset, r.y + pad - size * 0.25, size * 2.2, size * 1.5);
  ctx.fillStyle = 'rgba(255,246,232,0.95)';
  ctx.fillText(String(panel.index + 1).padStart(2, '0'), r.x + pad + inset, r.y + pad);
  ctx.fillStyle = 'rgba(255,164,74,0.95)';
  ctx.fillRect(r.x + pad + inset, r.y + pad + size * 1.5, size * 1.6, Math.max(1, Math.round(size * 0.14)));
  ctx.restore();
}

function drawCaptionBand(ctx, design, view) {
  const { band, unit, frame } = design;
  const title = (view.caption || 'Untitled Heist').toUpperCase();
  const sub = (view.subtitle || 'a cover studio original').toUpperCase();

  ctx.save();
  // plate
  ctx.fillStyle = vgradient(ctx, band.x, band.y, band.w, band.h, [
    [0, 'rgba(16,12,34,0.955)'],
    [0.55, 'rgba(10,9,24,0.975)'],
    [1, 'rgba(6,6,16,0.99)'],
  ]);
  ctx.fillRect(band.x, band.y, band.w, band.h);

  // warm bleed off the top edge of the plate
  ctx.globalCompositeOperation = 'screen';
  const bleed = ctx.createLinearGradient(0, band.y, 0, band.y + band.h * 0.6);
  bleed.addColorStop(0, 'rgba(255,138,52,0.36)');
  bleed.addColorStop(0.5, 'rgba(180,70,160,0.14)');
  bleed.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = bleed;
  ctx.fillRect(band.x, band.y, band.w, band.h);
  ctx.globalCompositeOperation = 'source-over';

  const pad = Math.round(unit * 0.045);

  // title: fit one line, or wrap to two if that buys a bigger size
  let size = fitFontSize(ctx, title, band.w - pad * 2, band.h * 0.53, band.h * 0.46, 0);
  let lines = [title];
  if (title.split(' ').length > 1 && size < band.h * 0.4) {
    const ref = band.h * 0.4;
    ctx.font = font(ref);
    const wrapped = wrapText(ctx, title, band.w - pad * 2, 2);
    const widest = Math.max(...wrapped.map((l) => ctx.measureText(l).width));
    const trySize = Math.min((band.w - pad * 2) * (ref / Math.max(1, widest)), (band.h * 0.5) / wrapped.length);
    if (trySize > size && wrapped.length > 1) {
      size = trySize;
      lines = wrapped;
    }
  }

  ctx.font = font(size, FONT_DISPLAY, '800');
  const track = -size * 0.012;
  const lineH = size * 1.02;
  const blockH = lineH * lines.length;
  const titleTop = band.y + band.h * 0.11;

  const grad = lgradient(ctx, band.x, titleTop, band.w, blockH, [
    [0, '#fff6e2'],
    [0.3, '#ffd47e'],
    [0.6, '#ff9a3c'],
    [1, '#ff5f6d'],
  ]);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.lineJoin = 'round';
  lines.forEach((line, i) => {
    const y = titleTop + i * lineH;
    const w = measureTracked(ctx, line, track);
    const x = band.x + (band.w - w) / 2;

    // depth: a dark copy dropped behind the letters
    ctx.save();
    ctx.fillStyle = 'rgba(12,5,20,0.72)';
    drawTracked(ctx, line, x + size * 0.02, y + size * 0.05, track);
    // fat dark outline with a warm halo, the way a painted logo sits on a plate
    ctx.shadowColor = 'rgba(255,124,42,0.5)';
    ctx.shadowBlur = unit * 0.04;
    ctx.strokeStyle = 'rgba(20,8,24,0.92)';
    ctx.lineWidth = Math.max(3, size * 0.085);
    drawTracked(ctx, line, x, y, track, 'stroke');
    ctx.restore();

    // the hot gradient itself
    ctx.fillStyle = grad;
    drawTracked(ctx, line, x, y, track);

    // thin warm rim, nudged up and left, so the type reads as embossed
    ctx.save();
    ctx.globalAlpha = 0.38;
    ctx.strokeStyle = 'rgba(255,246,220,0.9)';
    ctx.lineWidth = Math.max(1, size * 0.016);
    drawTracked(ctx, line, x - size * 0.006, y - size * 0.012, track, 'stroke');
    ctx.restore();
  });

  // deco rule and diamond closing the title block
  const ruleY = Math.round(titleTop + blockH + band.h * 0.045);
  const cx = band.x + band.w / 2;
  const half = Math.min(band.w * 0.22, size * 3.6);
  const lw = Math.max(1, Math.round(unit * 0.0022));
  hairline(ctx, cx - half, ruleY, cx - unit * 0.018, ruleY, 'rgba(255,170,80,0.8)', lw);
  hairline(ctx, cx + unit * 0.018, ruleY, cx + half, ruleY, 'rgba(255,170,80,0.8)', lw);
  diamond(ctx, cx, ruleY, Math.max(3, unit * 0.006), 'rgba(255,214,150,0.95)');

  // subtitle, letter-spaced in teal
  const subSize = Math.max(10, Math.round(Math.min(band.h * 0.105, size * 0.29)));
  const subTrack = Math.max(1.5, subSize * 0.36);
  const subY = ruleY + band.h * 0.038;
  ctx.font = font(subSize, FONT_UI, '700');
  ctx.textBaseline = 'top';
  const subW = measureTracked(ctx, sub, subTrack);
  ctx.fillStyle = 'rgba(120,232,226,0.95)';
  drawTracked(ctx, sub, band.x + (band.w - subW) / 2, subY, subTrack);

  // micro credits along the foot of the band
  const cSize = Math.max(9, Math.round(unit * 0.0135));
  const cTrack = Math.max(1, cSize * 0.3);
  ctx.font = font(cSize, FONT_UI, '600');
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(232,236,255,0.5)';
  const left = 'MAKEFUN PICTURES PRESENTS  ·  COVER STUDIO';
  const right = `${design.panels.length} FRAMES  ·  PRINTED IN SUNSET  ·  No.${String(design.seed % 97).padStart(2, '0')}`;
  const cy = band.y + band.h - Math.round(unit * 0.028);
  drawTracked(ctx, left, band.x + pad * 0.7, cy, cTrack);
  ctx.textAlign = 'right';
  const rw = measureTracked(ctx, right, cTrack);
  drawTracked(ctx, right, band.x + band.w - pad * 0.7 - rw, cy, cTrack);
  ctx.textAlign = 'left';

  // rule closing the band against the frame
  hairline(ctx, frame.x + Math.round(unit * 0.02), band.y, frame.x + frame.w - Math.round(unit * 0.02), band.y, 'rgba(255,164,74,0.9)', Math.max(2, Math.round(unit * 0.004)));
  ctx.restore();
}

/** A cheap final dusting so the type sits in the same air as the photo. */
function filmDust(ctx, w, h, seed, alpha) {
  if (alpha <= 0.001) return;
  const tile = 96;
  const canvas = createCanvas(tile, tile);
  const tctx = ctx2d(canvas, true);
  const img = tctx.createImageData(tile, tile);
  const rng = makeRng(seed ^ 0x77aa11);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 128 + (rng() - 0.5) * 200;
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  tctx.putImageData(img, 0, 0);
  const pattern = ctx.createPattern(canvas, 'repeat');
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = alpha;
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
  vignette(ctx, w, h, { strength: 0.42, color: '8,6,22' });
}

/** Small helper for the UI: the crop used by panel i right now. */
export function panelCrop(design, index, srcW, srcH) {
  const p = design.panels[index];
  if (!p) return null;
  return coverRect(srcW, srcH, p.rect.w, p.rect.h, p.crop.zoom, 0, 0, p.crop.focus);
}
