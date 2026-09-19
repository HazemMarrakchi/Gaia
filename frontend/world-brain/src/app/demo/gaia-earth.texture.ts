// Procedural stylized Earth — replaces the 2 MB photo texture pack in the demo
// bundle so the GitHub Pages demo ships light (~60 kB gzipped for all JS).
// Day/night + latitudinal ice caps + subtle cloud bands are generated on an
// offscreen canvas; markers and gameplay keep the same look as production.
import * as THREE from 'three';

/** Rough continent blobs as (lon, lat, radius, stretch) tuples. */
const LAND: Array<[number, number, number, number]> = [
  // North America
  [-100, 45, 22, 1.4], [-90, 60, 16, 1.0], [-75, 40, 8, 1.0], [-105, 25, 7, 0.7],
  // South America
  [-60, -12, 12, 1.8], [-65, -30, 8, 1.4],
  // Europe
  [10, 50, 10, 1.2], [25, 62, 8, 1.0], [-5, 42, 6, 0.8],
  // Africa
  [20, 5, 14, 1.6], [25, -20, 10, 1.3], [8, 15, 12, 1.1],
  // Middle East / Asia
  [45, 30, 9, 1.0], [80, 50, 16, 1.2], [110, 45, 12, 1.0],
  [78, 22, 9, 1.3], [115, 30, 8, 1.1], [138, 38, 6, 0.9],
  // SE Asia / Indonesia
  [120, 0, 6, 0.9], [140, -5, 5, 0.8],
  // Australia
  [134, -25, 9, 1.0],
  // Greenland
  [-42, 72, 6, 1.0],
];

const lonLatToXY = (lon: number, lat: number, w: number, h: number): [number, number] => [
  ((lon + 180) / 360) * w,
  ((90 - lat) / 180) * h,
];

function paintEarth(ctx: CanvasRenderingContext2D, w: number, h: number, night: boolean): void {
  const ocean = night ? '#020610' : '#06121f';
  ctx.fillStyle = ocean;
  ctx.fillRect(0, 0, w, h);

  // subtle latitude ocean gradient
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, night ? 'rgba(56,189,248,0.12)' : 'rgba(56,189,248,0.10)');
  grad.addColorStop(0.5, 'rgba(0,0,0,0)');
  grad.addColorStop(1, night ? 'rgba(56,189,248,0.12)' : 'rgba(56,189,248,0.10)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  for (const [lon, lat, radius, stretch] of LAND) {
    const [x, y] = lonLatToXY(lon, lat, w, h);
    const rx = (radius / 360) * w * 1.15;
    const ry = (radius / 180) * h * stretch * 0.9;
    const blob = ctx.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry));
    if (night) {
      blob.addColorStop(0, '#1c2438');
      blob.addColorStop(0.7, '#101828');
      blob.addColorStop(1, 'rgba(16,24,40,0)');
    } else {
      blob.addColorStop(0, '#1d5c4d');
      blob.addColorStop(0.55, '#14503f');
      blob.addColorStop(0.85, '#0c2f36');
      blob.addColorStop(1, 'rgba(12,47,54,0)');
    }
    ctx.fillStyle = blob;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // polar ice caps
  const ice = night ? 'rgba(148,184,220,0.25)' : 'rgba(226,240,248,0.75)';
  ctx.fillStyle = ice;
  ctx.fillRect(0, 0, w, h * 0.045);
  ctx.fillRect(0, h * 0.955, w, h * 0.045);

  if (night) {
    // city lights: deterministic sparkle clustered on land blobs
    let seed = 7;
    const rnd = (): number => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    ctx.fillStyle = 'rgba(255,214,140,0.9)';
    for (let i = 0; i < 900; i++) {
      const b = LAND[(rnd() * LAND.length) | 0];
      const [x, y] = lonLatToXY(b[0] + (rnd() - 0.5) * b[2] * 1.4, b[1] + (rnd() - 0.5) * b[2], w, h);
      ctx.fillRect(x, y, 1.4, 1.4);
    }
  }
}

function makeCanvas(w: number, h: number, night: boolean): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx) paintEarth(ctx, w, h, night);
  return canvas;
}

function makeClouds(w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.clearRect(0, 0, w, h);
  let seed = 42;
  const rnd = (): number => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  // streaky cloud bands drifting along latitudes
  for (let i = 0; i < 220; i++) {
    const lat = (rnd() - 0.5) * 140;
    const lon = rnd() * 360 - 180;
    const [x, y] = lonLatToXY(lon, lat, w, h);
    const rw = 8 + rnd() * 46;
    const rh = 2 + rnd() * 7;
    const g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(rw, rh));
    g.addColorStop(0, `rgba(255,255,255,${0.10 + rnd() * 0.22})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, y, rw, rh, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  return canvas;
}

function toTexture(canvas: HTMLCanvasElement): THREE.Texture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Day map, night map and cloud map for the demo globe (no downloads). */
export function demoEarthTextures(): { day: THREE.Texture; night: THREE.Texture; clouds: THREE.Texture } {
  return {
    day: toTexture(makeCanvas(1024, 512, false)),
    night: toTexture(makeCanvas(1024, 512, true)),
    clouds: toTexture(makeClouds(512, 256)),
  };
}