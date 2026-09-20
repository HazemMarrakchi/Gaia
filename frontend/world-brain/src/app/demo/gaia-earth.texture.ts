// Procedural stylized Earth (day/night/clouds) as canvas textures.
// NOTE: the live globe uses the real NASA photo textures in
// assets/planets/; this helper is currently unused and kept as a
// lightweight offline fallback for a future globe build.
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
  if (night) {
    // Night side: deep dark blue with subtle city glow
    ctx.fillStyle = '#030812';
    ctx.fillRect(0, 0, w, h);
  } else {
    // Day side: realistic ocean blue with depth gradient
    const oceanGrad = ctx.createLinearGradient(0, 0, 0, h);
    oceanGrad.addColorStop(0, '#0a3d62');
    oceanGrad.addColorStop(0.3, '#0d5c8a');
    oceanGrad.addColorStop(0.5, '#0e6ba8');
    oceanGrad.addColorStop(0.7, '#0d5c8a');
    oceanGrad.addColorStop(1, '#0a3d62');
    ctx.fillStyle = oceanGrad;
    ctx.fillRect(0, 0, w, h);
  }

  for (const [lon, lat, radius, stretch] of LAND) {
    const [x, y] = lonLatToXY(lon, lat, w, h);
    const rx = (radius / 360) * w * 1.15;
    const ry = (radius / 180) * h * stretch * 0.9;
    const blob = ctx.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry));
    if (night) {
      // Night: dark landmasses with warm city lights at center
      blob.addColorStop(0, '#1a2332');
      blob.addColorStop(0.5, '#141c2a');
      blob.addColorStop(1, 'rgba(10,15,25,0)');
    } else {
      // Day: realistic earth tones - green forests, brown mountains, tan deserts
      blob.addColorStop(0, '#2d6a4f');
      blob.addColorStop(0.4, '#40916c');
      blob.addColorStop(0.7, '#8b7355');
      blob.addColorStop(1, 'rgba(61,43,31,0)');
    }
    ctx.fillStyle = blob;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Polar ice caps - bright white
  const ice = night ? 'rgba(200,220,240,0.4)' : 'rgba(240,248,255,0.9)';
  ctx.fillStyle = ice;
  ctx.fillRect(0, 0, w, h * 0.04);
  ctx.fillRect(0, h * 0.96, w, h * 0.04);

  if (night) {
    // City lights: warm golden sparkles on land
    let seed = 7;
    const rnd = (): number => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    ctx.fillStyle = 'rgba(255,200,100,0.8)';
    for (let i = 0; i < 1200; i++) {
      const b = LAND[(rnd() * LAND.length) | 0];
      const [x, y] = lonLatToXY(b[0] + (rnd() - 0.5) * b[2] * 1.3, b[1] + (rnd() - 0.5) * b[2] * 0.8, w, h);
      ctx.fillRect(x, y, 1.5, 1.5);
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