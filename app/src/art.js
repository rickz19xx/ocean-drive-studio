/* art.js — the painterly half of the poster.
   Every effect here is canvas-only: gradients, blend modes, a blur-based bloom
   and one per-pixel pass for grain, violet shadows, posterised highlights and
   radial chromatic fringing. No images, no fonts, no libraries. */

const TAU = Math.PI * 2;

export const FONT_DISPLAY = '"Archivo Black","Arial Black",Impact,"Haettenschweiler","Franklin Gothic Heavy",sans-serif';
export const FONT_MONO = 'ui-monospace,"Cascadia Mono","Consolas","DejaVu Sans Mono",monospace';
export const FONT_UI = 'system-ui,"Segoe UI",Roboto,Helvetica,Arial,sans-serif';

/* ------------------------------------------------------------------ basics */

export function createCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function ctx2d(canvas, readFrequently = false) {
  return canvas.getContext('2d', readFrequently ? { willReadFrequently: true } : undefined);
}

/** Deterministic PRNG so a given caption always paints the same poster. */
export function makeRng(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return function rng() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(str) {
  let h = 2166136261 >>> 0;
  const s = String(str ?? '');
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const mix = (a, b, t) => a + (b - a) * t;

export function rectPath(ctx, x, y, w, h, r = 0) {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  if (!rad) {
    ctx.rect(x, y, w, h);
    return;
  }
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

export function vgradient(ctx, x, y, w, h, stops) {
  const g = ctx.createLinearGradient(x, y, x, y + h);
  for (const s of stops) g.addColorStop(s[0], s[1]);
  return g;
}

export function lgradient(ctx, x, y, w, h, stops) {
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  for (const s of stops) g.addColorStop(s[0], s[1]);
  return g;
}

/* ------------------------------------------------- photo in, painting out */

/**
 * Draw one crop of the photo into a panel with a full painterly grade:
 * sunset duotone on soft-light, violet shadows on multiply, a warm/cool
 * cross-light and a screen-pass sun bloom where the light sits.
 */
export function drawGradedPhoto(ctx, src, sRect, dest, opts = {}) {
  const { grade = 1, radius = 0, lightX = 0.3, lightY = 0.22, warmth = 0.5, tilt = 0 } = opts;
  if (!src || !sRect || sRect.w < 1 || sRect.h < 1) return;
  const g = clamp(grade, 0, 1.6);

  ctx.save();
  ctx.beginPath();
  if (tilt) {
    ctx.rotate(tilt);
  }
  rectPath(ctx, dest.x, dest.y, dest.w, dest.h, radius);
  ctx.clip();

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  try {
    ctx.drawImage(src, sRect.x, sRect.y, sRect.w, sRect.h, dest.x, dest.y, dest.w, dest.h);
  } catch (err) {
    ctx.fillStyle = '#1b2340';
    ctx.fillRect(dest.x, dest.y, dest.w, dest.h);
  }

  const warm = clamp(warmth, 0, 1);
  const { x, y, w, h } = dest;

  // cool/hot cross light — teal in, orange through the middle, rose out
  ctx.globalCompositeOperation = 'soft-light';
  ctx.globalAlpha = clamp(0.95 * g, 0, 1);
  ctx.fillStyle = lgradient(ctx, x, y, w * 0.9, h, [
    [0, `rgba(${Math.round(255 - 20 * warm)},${Math.round(150 + 40 * warm)},${Math.round(215 - 160 * warm)},0.95)`],
    [0.46, `rgba(255,${Math.round(120 + 60 * warm)},74,0.7)`],
    [1, `rgba(38,${Math.round(200 - 40 * warm)},206,0.9)`],
  ]);
  ctx.fillRect(x, y, w, h);

  // violet dusk climbing from the bottom edge
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = 1;
  ctx.fillStyle = vgradient(ctx, x, y, w, h, [
    [0, 'rgba(255,238,214,1)'],
    [0.42, 'rgba(252,222,228,1)'],
    [1, `rgba(${Math.round(120 - 24 * g)},${Math.round(74 - 18 * g)},${Math.round(158 - 20 * g)},1)`],
  ]);
  ctx.fillRect(x, y, w, h);

  // golden-hour bloom parked where the light is
  const lx = x + w * clamp(lightX, 0, 1);
  const ly = y + h * clamp(lightY, 0, 1);
  const lr = Math.max(w, h) * 0.72;
  const glow = ctx.createRadialGradient(lx, ly, 0, lx, ly, lr);
  glow.addColorStop(0, 'rgba(255,236,196,0.95)');
  glow.addColorStop(0.34, 'rgba(255,168,84,0.55)');
  glow.addColorStop(1, 'rgba(255,120,60,0)');
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = clamp(0.55 * g, 0, 1);
  ctx.fillStyle = glow;
  ctx.fillRect(x, y, w, h);

  // snap the grade back down so the photo never washes out
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = clamp(0.3 * g, 0, 1);
  ctx.fillStyle = vgradient(ctx, x, y, w, h, [
    [0, 'rgba(20,40,86,0.9)'],
    [0.5, 'rgba(255,255,255,0.25)'],
    [1, 'rgba(24,10,48,0.95)'],
  ]);
  ctx.fillRect(x, y, w, h);

  ctx.restore();
}

/** Full-bleed backdrop: the whole photo, graded harder and pushed under everything. */
export function drawBackdrop(ctx, src, srcW, srcH, w, h, opts = {}) {
  const { grade = 1, seed = 7, bleed = 0 } = opts;
  if (!src) return;
  const bx = -bleed;
  const by = -bleed;
  const bw = w + bleed * 2;
  const bh = h + bleed * 2;

  ctx.save();
  ctx.fillStyle = '#0a0c1a';
  ctx.fillRect(0, 0, w, h);

  const s = { x: 0, y: 0, w: srcW, h: srcH };
  const aspect = bw / bh;
  if (srcW / srcH > aspect) {
    s.w = srcH * aspect;
    s.x = (srcW - s.w) / 2;
  } else {
    s.h = srcW / aspect;
    s.y = (srcH - s.h) / 2;
  }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, s.x, s.y, s.w, s.h, bx, by, bw, bh);

  // sunset sky wash: hot amber at the top, cold teal along the base
  ctx.globalCompositeOperation = 'soft-light';
  ctx.globalAlpha = clamp(1.1 * grade, 0, 1);
  ctx.fillStyle = vgradient(ctx, 0, 0, w, h, [
    [0, 'rgba(255,172,70,1)'],
    [0.34, 'rgba(255,122,96,0.7)'],
    [0.66, 'rgba(84,72,196,0.7)'],
    [1, 'rgba(26,192,206,0.9)'],
  ]);
  ctx.fillRect(0, 0, w, h);

  // deep dusk at the foot of the sheet — warm through the middle, never pink
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = 1;
  ctx.fillStyle = vgradient(ctx, 0, 0, w, h, [
    [0, 'rgba(255,238,212,1)'],
    [0.46, 'rgba(255,224,200,1)'],
    [1, 'rgba(78,46,124,1)'],
  ]);
  ctx.fillRect(0, 0, w, h);

  // a low sun and its halo, sitting behind the panel grid
  const rng = makeRng(seed);
  const sunX = w * mix(0.16, 0.84, rng());
  const sunY = h * mix(0.12, 0.28, rng());
  sunDisc(ctx, sunX, sunY, Math.min(w, h) * 0.24, {
    core: 'rgba(255,244,206,0.85)',
    halo: 'rgba(255,120,40,0)',
  });
  ctx.restore();
}

export function sunDisc(ctx, x, y, r, opts = {}) {
  const { core = 'rgba(255,244,208,0.9)', halo = 'rgba(255,140,60,0)' } = opts;
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, core);
  g.addColorStop(0.12, 'rgba(255,226,160,0.6)');
  g.addColorStop(0.42, 'rgba(255,158,74,0.24)');
  g.addColorStop(1, halo);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/* ------------------------------------------------------------ global passes */

/** Blur-and-screen bloom. Two radii: a wide haze and a tight hot core. */
export function bloom(canvas, opts = {}) {
  const { radius = 30, amount = 0.4, core = 0.34 } = opts;
  if (amount <= 0 && core <= 0) return;
  const ctx = ctx2d(canvas);
  const w = canvas.width;
  const h = canvas.height;

  if (amount > 0) {
    const wide = createCanvas(w, h);
    const wctx = ctx2d(wide);
    wctx.filter = `blur(${radius}px) brightness(1.22) saturate(1.2)`;
    wctx.drawImage(canvas, 0, 0);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = clamp(amount, 0, 1);
    ctx.drawImage(wide, 0, 0);
    ctx.restore();
  }

  if (core > 0) {
    const tight = createCanvas(w, h);
    const tctx = ctx2d(tight);
    tctx.filter = `blur(${Math.max(1, radius * 0.22)}px) brightness(1.5) contrast(1.35)`;
    tctx.drawImage(canvas, 0, 0);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = clamp(core, 0, 1);
    ctx.drawImage(tight, 0, 0);
    ctx.restore();
  }
}

/**
 * One pass over the pixels: radial chromatic fringing, violet shadows,
 * posterised highlight rolloff and film grain. Runs once per poster.
 */
export function film(canvas, opts = {}) {
  const {
    seed = 1,
    grain = 0.055,
    chroma = 3.2,
    shadowTint = [70, 30, 96],
    shadowAmount = 0.3,
    posterize = 5,
    highlight = 208,
    contrast = 1.09,
    saturate = 1.15,
  } = opts;

  const ctx = ctx2d(canvas, true);
  const w = canvas.width;
  const h = canvas.height;
  if (!w || !h) return;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const src = new Uint8ClampedArray(d);
  const rng = makeRng(seed || 1);
  const cx = w / 2;
  const cy = h / 2;
  const half = Math.hypot(cx, cy) || 1;
  const [tr, tg, tb] = shadowTint;

  for (let y = 0; y < h; y += 1) {
    const row = y * w;
    const dy = (y - cy) / half;
    for (let x = 0; x < w; x += 1) {
      const i = (row + x) * 4;
      let r = d[i];
      let g = d[i + 1];
      let b = d[i + 2];

      // --- chromatic fringing, strongest at the edges of the sheet
      if (chroma > 0) {
        const dx = (x - cx) / half;
        const rad = dx * dx + dy * dy;
        const shift = chroma * rad;
        if (shift > 0.45) {
          const xs = x - Math.round(shift);
          const xb = x + Math.round(shift);
          if (xs >= 0) r = src[(row + xs) * 4];
          if (xb < w) b = src[(row + xb) * 4 + 2];
        }
      }

      let lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;

      // --- contrast around mid grey
      if (contrast !== 1) {
        r = (r - 128) * contrast + 128;
        g = (g - 128) * contrast + 128;
        b = (b - 128) * contrast + 128;
      }

      // --- saturation push
      if (saturate !== 1) {
        r = lum + (r - lum) * saturate;
        g = lum + (g - lum) * saturate;
        b = lum + (b - lum) * saturate;
      }

      // --- split tone: amber highlights over violet-cool shadows
      lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const t = clamp(lum / 255, 0, 1);
      const hw = 0.14 * t * t;
      if (hw > 0.001) {
        r += (255 - r) * hw;
        g += (232 - g) * hw * 0.8;
        b += (176 - b) * hw * 0.35;
      }

      // --- violet shadows: multiply the darks towards the tint
      lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const shadowW = shadowAmount * Math.pow(clamp(1 - lum / 150, 0, 1), 1.6);
      if (shadowW > 0.001) {
        const k = 1 - shadowW;
        r = r * k + ((r * tr) / 255) * shadowW;
        g = g * k + ((g * tg) / 255) * shadowW;
        b = b * k + ((b * tb) / 255) * shadowW;
      }

      // --- posterised highlight rolloff: few hard steps, softened a touch
      lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (lum > highlight && posterize > 0) {
        const t = (lum - highlight) / (255 - highlight);
        let q = Math.round(t * posterize) / posterize;
        q = q * 0.78 + t * 0.22;
        const target = highlight + q * (255 - highlight);
        const f = target / Math.max(1, lum);
        r *= f;
        g *= f;
        b *= f;
      }

      // --- grain: heavier in the shadows, thinner in the highlights
      if (grain > 0) {
        const n = (rng() - 0.5) * 2;
        const amt = n * grain * 255 * (0.4 + 0.6 * (1 - lum / 255));
        r += amt;
        g += amt * 0.94;
        b += amt * 1.06;
      }

      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Blur whatever is already on the canvas, in place (used for the painted ground). */
export function blurInPlace(canvas, radius, filterExtra = '') {
  const tmp = createCanvas(canvas.width, canvas.height);
  const t = ctx2d(tmp);
  t.filter = `blur(${radius}px) ${filterExtra}`.trim();
  t.drawImage(canvas, 0, 0);
  const ctx = ctx2d(canvas);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(tmp, 0, 0);
}

/**
 * Where is the photo interesting? A coarse grid scored on local contrast,
 * edge energy and colourfulness, faded towards the edges of the frame.
 * Used to aim the panel crops at faces, hands, chrome and other detail
 * instead of whatever happens to be in the middle.
 */
export function saliencyMap(image, cols = 13, rows = 13) {
  const sw = image.naturalWidth || image.width;
  const sh = image.naturalHeight || image.height;
  const small = createCanvas(240, Math.max(1, Math.round((240 * sh) / sw)));
  const sctx = ctx2d(small, true);
  sctx.drawImage(image, 0, 0, small.width, small.height);
  let data;
  try {
    data = sctx.getImageData(0, 0, small.width, small.height).data;
  } catch (err) {
    return null;
  }

  const luma = new Float32Array(small.width * small.height);
  const sat = new Float32Array(small.width * small.height);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    luma[p] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    sat[p] = mx > 0 ? (mx - mn) / mx : 0;
  }

  const cw = Math.max(1, Math.floor(small.width / cols));
  const ch = Math.max(1, Math.floor(small.height / rows));
  const cells = [];
  let max = 0;
  for (let cy = 0; cy < rows; cy += 1) {
    for (let cx = 0; cx < cols; cx += 1) {
      let n = 0;
      let sum = 0;
      let sum2 = 0;
      let edge = 0;
      let colour = 0;
      for (let y = cy * ch; y < Math.min(small.height, (cy + 1) * ch); y += 1) {
        for (let x = cx * cw; x < Math.min(small.width, (cx + 1) * cw); x += 1) {
          const p = y * small.width + x;
          const v = luma[p];
          sum += v;
          sum2 += v * v;
          colour += sat[p];
          n += 1;
          if (x + 1 < small.width) edge += Math.abs(v - luma[p + 1]);
          if (y + 1 < small.height) edge += Math.abs(v - luma[p + small.width]);
        }
      }
      if (!n) continue;
      const mean = sum / n;
      const variance = Math.max(0, sum2 / n - mean * mean);
      const nx = (cx + 0.5) / cols;
      const ny = (cy + 0.5) / rows;
      const rd = Math.hypot(nx - 0.5, (ny - 0.5) * 0.9);
      const falloff = clamp(1.15 - rd * 1.25, 0.12, 1);
      // exposed but not blown out, busy but not noise: the sweet spot
      const exposure = 1 - Math.abs(mean - 138) / 200;
      const score =
        (Math.sqrt(variance) * 0.9 + (edge / n) * 1.7 + (colour / n) * 90) * falloff * clamp(exposure, 0.25, 1);
      max = Math.max(max, score);
      cells.push({ x: nx, y: ny, score });
    }
  }
  for (const c of cells) c.score = max > 0 ? c.score / max : 0;
  return { cols, rows, cells };
}

/** Corner darkening plus a warm edge kiss. */
export function vignette(ctx, w, h, opts = {}) {
  const { strength = 0.5, color = '10,8,26' } = opts;
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  const g = ctx.createRadialGradient(w / 2, h * 0.46, Math.min(w, h) * 0.28, w / 2, h * 0.5, Math.hypot(w, h) * 0.62);
  g.addColorStop(0, `rgba(${color},0)`);
  g.addColorStop(0.62, `rgba(${color},${(strength * 0.34).toFixed(3)})`);
  g.addColorStop(1, `rgba(${color},${strength.toFixed(3)})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/** Diagonal accent shard, drawn with a gradient and blended over the collage. */
export function shard(ctx, x, y, w, h, skew, stops, mode = 'overlay', alpha = 0.5) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x + skew, y);
  ctx.lineTo(x + w + skew, y);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.closePath();
  ctx.globalCompositeOperation = mode;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = lgradient(ctx, x, y, w, h, stops);
  ctx.fill();
  ctx.restore();
}

export function hairline(ctx, x1, y1, x2, y2, color, width = 1) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}

export function keyline(ctx, x, y, w, h, color = 'rgba(255,244,226,0.85)', width = 2) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.strokeRect(x + width / 2, y + width / 2, w - width, h - width);
  ctx.restore();
}

/* ------------------------------------------------------------------- type */

export function font(size, family = FONT_DISPLAY, weight = '800') {
  return `${weight} ${Math.max(1, Math.round(size))}px ${family}`;
}

export function measureTracked(ctx, text, tracking) {
  const s = String(text ?? '');
  if (!tracking) return ctx.measureText(s).width;
  let w = 0;
  for (const ch of s) w += ctx.measureText(ch).width + tracking;
  return s.length ? w - tracking : 0;
}

/** Letter-spaced text. Returns the width it painted. */
export function drawTracked(ctx, text, x, y, tracking, mode = 'fill') {
  const s = String(text ?? '');
  const prevAlign = ctx.textAlign;
  ctx.textAlign = 'left';
  let cx = x;
  for (const ch of s) {
    if (mode === 'fill' || mode === 'both') ctx.fillText(ch, cx, y);
    if (mode === 'stroke' || mode === 'both') ctx.strokeText(ch, cx, y);
    cx += ctx.measureText(ch).width + tracking;
  }
  ctx.textAlign = prevAlign;
  return cx - tracking - x;
}

/** Largest size at which `text` fits both limits, as a single run. */
export function fitFontSize(ctx, text, maxW, maxH, startSize, maxTrack = 0) {
  const s = String(text ?? '') || ' ';
  let size = Math.max(6, startSize);
  for (let i = 0; i < 240; i += 1) {
    ctx.font = font(size);
    const track = maxTrack ? size * 0.01 * maxTrack : 0;
    const w = measureTracked(ctx, s, track);
    if (w <= maxW && size <= maxH * 1.02) break;
    size *= w > maxW ? maxW / w : 0.94;
    if (size < 6) {
      size = 6;
      break;
    }
  }
  return size;
}

/** Break a caption into at most `max` balanced lines. */
export function wrapText(ctx, text, maxW, maxLines = 2) {
  const words = String(text ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const lines = [];
  let cur = words[0];
  for (let i = 1; i < words.length; i += 1) {
    const test = `${cur} ${words[i]}`;
    if (ctx.measureText(test).width <= maxW || lines.length >= maxLines - 1) {
      cur = test;
    } else {
      lines.push(cur);
      cur = words[i];
    }
  }
  lines.push(cur);
  return lines.slice(0, maxLines);
}
