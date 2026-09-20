import {
  AfterViewInit, Component, ElementRef, EventEmitter, Input, OnDestroy, Output, inject, signal,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { DemoWorld } from '../../demo/demo-world.service';

interface SimEventDto {
  id: string;
  tick: number;
  domain: string;
  type: string;
  region: string;
  severity: number;
}

interface RegionStat {
  region: string;
  lat: number;
  lon: number;
  events: number;
  maxSeverity: number;
  lastType: string;
  lastDomain: string;
  lastSeenTick: number;
}

interface Marker {
  dot: THREE.Mesh;
  halo: THREE.Mesh;
  ring: THREE.Mesh;
  stat: RegionStat;
}

const DOMAIN_COLORS: Record<string, number> = {
  energy: 0xffaa00,
  cities: 0x4ade80,
  transport: 0x38bdf8,
  finance: 0xf472b6,
};

/** The 8 simulated regions (WorldFactory) with their real-world centroids. */
const REGIONS: Array<{ region: string; lat: number; lon: number }> = [
  { region: 'eu-west', lat: 50.5, lon: -4.0 },
  { region: 'eu-east', lat: 51.0, lon: 24.0 },
  { region: 'na-east', lat: 42.0, lon: -75.0 },
  { region: 'na-west', lat: 40.0, lon: -120.0 },
  { region: 'me', lat: 24.0, lon: 46.5 },
  { region: 'asia-n', lat: 52.0, lon: 100.0 },
  { region: 'asia-s', lat: 21.0, lon: 78.0 },
  { region: 'africa', lat: 6.0, lon: 20.0 },
];

const API = 'http://localhost:8181';
const R = 5; // earth radius

@Component({
  selector: 'gb-globe-panel',
  standalone: true,
  template: `
    <div class="wrap">
      <div #viewport class="globe"></div>
      <div class="panel">
        <div class="panel-head">
          <span class="live"></span>
          <span class="panel-title">Gaia control</span>
          <span class="tick" [class.off]="tickIndex() === 0">TICK {{ tickLabel() }}</span>
        </div>
        <div class="section-label">Live regional hot-spots</div>
        <div class="rows">
          @for (s of stats; track s.region) {
            <div class="row" [class.hot]="s.maxSeverity > 0.5">
              <span class="name">{{ s.region }}</span>
              <div class="bar">
                <div class="fill" [style.width.%]="s.maxSeverity * 100"
                     [style.background]="colorOf(s)"></div>
              </div>
              <span class="val">{{ s.events }}</span>
            </div>
          }
        </div>
        <div class="legend">
          <span><i class="dot" style="background:#ffaa00"></i>energy</span>
          <span><i class="dot" style="background:#4ade80"></i>cities</span>
          <span><i class="dot" style="background:#38bdf8"></i>transport</span>
          <span><i class="dot" style="background:#f472b6"></i>finance</span>
        </div>
      </div>
      <div class="hint">drag to orbit · scroll to zoom</div>
    </div>
  `,
  styles: [`
    .wrap { position: relative; }
    .globe { width: 100%; height: 72vh; min-height: 420px; border-radius: 12px; overflow: hidden;
      background: radial-gradient(ellipse at 50% 40%, #0a1428 0%, #05080f 70%); }
    .globe.no-webgl { display: flex; align-items: center; justify-content: center; }
    .webgl-fallback { color: #94a3b8; font-size: 14px; text-align: center; line-height: 1.6; }
    .panel {
      position: absolute; top: 14px; right: 14px; width: 262px;
      background: rgba(4, 10, 22, .78); border: 1px solid rgba(90, 140, 220, .22);
      border-radius: 12px; padding: 12px 14px; backdrop-filter: blur(10px);
      font-family: ui-monospace, monospace; font-size: 12px; color: #cbd5e1;
      box-shadow: 0 10px 34px rgba(0, 0, 0, .45);
    }
    .panel-head {
      display: grid; grid-template-columns: 8px 1fr auto; align-items: center;
      gap: 8px; margin-bottom: 10px;
    }
    .live {
      width: 8px; height: 8px; border-radius: 50%; background: #37e0a2;
      box-shadow: 0 0 8px #37e0a2; animation: blink 2s ease-in-out infinite;
    }
    @keyframes blink { 50% { opacity: .3; } }
    .panel-title { color: #7dd3fc; letter-spacing: .14em; text-transform: uppercase;
      font-size: 10px; font-weight: 600; }
    .tick { font-size: 10px; color: #94a3b8; letter-spacing: .06em; }
    .tick.off { color: #475569; }
    .section-label { font-size: 10px; letter-spacing: .08em; text-transform: uppercase;
      color: #475569; margin-bottom: 8px; }
    .row { display: grid; grid-template-columns: 62px 1fr 26px; align-items: center; gap: 6px; margin: 4px 0; }
    .row.hot .name { color: #f1f5f9; }
    .name { color: #94a3b8; }
    .bar { height: 7px; background: rgba(255,255,255,.08); border-radius: 4px; overflow: hidden; }
    .fill { height: 100%; border-radius: 4px; transition: width .6s ease; }
    .val { text-align: right; color: #e2e8f0; font-variant-numeric: tabular-nums; }
    .legend { display: flex; flex-wrap: wrap; gap: 6px 12px; margin-top: 12px;
      padding-top: 10px; border-top: 1px solid rgba(90, 140, 220, .18);
      font-size: 10px; color: #94a3b8; }
    .legend .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 4px; }
    .hint { position: absolute; bottom: 8px; left: 50%; transform: translateX(-50%);
      color: #64748b; font-size: 11px; letter-spacing: .05em; }
  `],
})
export class GlobePanelComponent implements AfterViewInit, OnDestroy {
  @Output() tick: EventEmitter<number> = new EventEmitter<number>();

  /** When set, the globe renders an in-browser DemoWorld instead of polling the backend. */
  @Input() world?: DemoWorld;

  stats: RegionStat[] = REGIONS.map((r) => ({
    region: r.region, lat: r.lat, lon: r.lon,
    events: 0, maxSeverity: 0, lastType: '—', lastDomain: '', lastSeenTick: -1,
  }));

  /** Latest tick index reported by /health/sim (0 = ingestion unreachable). */
  tickIndex = signal(0);

  /** Human-readable tick counter for the HUD. */
  tickLabel(): string {
    const t = this.tickIndex();
    return t === 0 ? '—' : t.toLocaleString('en-US');
  }

  private http = inject(HttpClient);
  private renderer?: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 400);
  private controls?: OrbitControls;
  private earth = new THREE.Group();
  private markers = new Map<string, Marker>();
  private rafId = 0;
  private pollId = 0;
  private lastEventIds = new Set<string>();
  private demoUnsub?: () => void;
  private clock = new THREE.Clock();
  private sunDirection = new THREE.Vector3(1, 0.35, 0.6).normalize();
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2(-2, -2);
  private hoverRegion: string | null = null;

  constructor(private el: ElementRef) {}

  colorOf(s: RegionStat): string {
    return '#' + (DOMAIN_COLORS[s.lastDomain] ?? 0x64748b).toString(16).padStart(6, '0');
  }

  ngAfterViewInit(): void {
    const host: HTMLElement = this.el.nativeElement.querySelector('.globe');
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch (err) {
      // WebGL unavailable — show a styled fallback instead of a blank box
      host.classList.add('no-webgl');
      host.innerHTML = '<div class="webgl-fallback">WebGL is required for the 3D globe.<br>Please use a modern browser.</div>';
      return;
    }
    this.renderer.setClearColor(0x000000, 0); // transparent — let the dark page background show through
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(host.clientWidth, host.clientHeight);
    host.appendChild(this.renderer.domElement);

    this.camera.position.set(0, 4.2, 15.5);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 7.5;
    this.controls.maxDistance = 40;

    // Lighting setup for realistic planet look
    this.scene.add(new THREE.AmbientLight(0x223355, 0.4)); // soft blue ambient
    const sun = new THREE.DirectionalLight(0xfff8e8, 1.8); // warm sunlight
    sun.position.copy(this.sunDirection).multiplyScalar(60);
    this.scene.add(sun);
    // Add a subtle fill light from opposite side to soften shadows
    const fill = new THREE.DirectionalLight(0x4466aa, 0.3);
    fill.position.set(-30, -20, -40);
    this.scene.add(fill);

    this.scene.add(this.buildStars());
    this.earth.add(this.buildEarth());
    this.earth.add(this.buildClouds());
    this.scene.add(this.buildAtmosphere());
    REGIONS.forEach((r) => this.addRegionMarker(r));
    this.scene.add(this.earth);

    host.addEventListener('pointermove', (e: PointerEvent) => {
      const rect = host.getBoundingClientRect();
      this.pointer.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
    });
    window.addEventListener('resize', this.onResize);

    if (this.world) {
      this.demoUnsub = this.world.onUpdate(() => this.syncDemoWorld());
      this.syncDemoWorld();
    } else {
      this.pollId = window.setInterval(() => this.pollSim(), 2000);
      this.pollSim();
    }

    const loop = () => {
      // getElapsedTime() advances the clock — without it t stays 0 and the
      // planet would never rotate (this was the frozen-globe bug)
      const t = this.clock.getElapsedTime();
      this.earth.rotation.y = t * 0.06; // slow, clearly visible rotation
      this.animateMarkers(t);
      this.updateHover();
      this.controls?.update();
      this.renderer?.render(this.scene, this.camera);
      this.rafId = requestAnimationFrame(loop);
    };
    this.clock.start();
    loop();
  }

  ngOnDestroy(): void {
    window.clearInterval(this.pollId);
    window.removeEventListener('resize', this.onResize);
    this.demoUnsub?.();
    cancelAnimationFrame(this.rafId);
    this.controls?.dispose();
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose?.();
      const mat = mesh.material as THREE.Material | THREE.Material[];
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose?.();
    });
    this.renderer?.dispose();
  }

  private onResize = () => {
    const host: HTMLElement | null = this.el.nativeElement.querySelector('.globe');
    if (!host || !this.renderer) return;
    this.camera.aspect = host.clientWidth / Math.max(1, host.clientHeight);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(host.clientWidth, host.clientHeight);
  };

  private syncDemoWorld(): void {
    const world = this.world;
    if (!world) return;
    this.tickIndex.set(world.tick());
    this.tick.emit(world.tick());
    this.applyEvents(
      world.events().map((e) => ({
        id: e.id,
        tick: e.tick,
        domain: e.domain,
        type: e.type,
        region: e.region,
        severity: e.severity,
      })),
    );
  }

  private pollSim(): void {
    // /health/sim answers plain text ("tick=42 published=900") — parse, don't JSON-decode.
    this.http
      .get(`${API}/health/sim`, { responseType: 'text' })
      .subscribe({
        next: (body) => {
          const matched = /tick=(\d+)/.exec(body);
          if (matched) {
            const tick = Number(matched[1]);
            this.tickIndex.set(tick);
            this.tick.emit(tick);
          }
        },
        error: () => this.tickIndex.set(0),
      });

    this.http
      .get<SimEventDto[]>(`${API}/events?limit=150`)
      .subscribe({ next: (events) => this.applyEvents(events), error: () => {} });
  }

  private applyEvents(events: SimEventDto[]): void {
    this.lastEventIds = new Set(events.map((e) => e.id));

    for (const s of this.stats) {
      s.events = 0;
      s.maxSeverity = 0;
    }
    for (const e of events) {
      const stat = this.stats.find((s) => s.region === e.region);
      if (!stat) continue;
      stat.events++;
      stat.maxSeverity = Math.max(stat.maxSeverity, e.severity);
      if (e.tick > stat.lastSeenTick) {
        stat.lastSeenTick = e.tick;
        stat.lastType = e.type;
        stat.lastDomain = e.domain;
      }
    }

    // no expanding pulses — the globe shows static hot-spot markers only
  }

  // ── scene construction ────────────────────────────────────────────────

  private loadTexture(path: string, srgb = false, onLoad?: (tex: THREE.Texture) => void): THREE.Texture {
    const tex = new THREE.TextureLoader().load(`assets/planets/${path}`, (loaded) => onLoad?.(loaded));
    if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private buildEarth(): THREE.Mesh {
    let material: THREE.MeshStandardMaterial | undefined;

    // Satellite maps are attached up-front so the real imagery is always the
    // base layer; the material only stays deep-ocean blue until they decode.
    const day = this.loadTexture('earth_day.jpg', true, () => {
      material?.color.setHex(0xffffff); // real continents & oceans at full strength
    });
    const night = this.loadTexture('earth_night.jpg', true);
    const normalMap = this.loadTexture('earth_normal.jpg', false);
    const specularMap = this.loadTexture('earth_specular.jpg', false);

    material = new THREE.MeshStandardMaterial({
      color: 0x0d2f52,             // deep ocean blue while the JPGs stream in
      map: day,                    // NASA Blue Marble day imagery
      normalMap,                   // terrain relief
      normalScale: new THREE.Vector2(0.85, 0.85),
      roughnessMap: specularMap,   // ocean reflectivity
      emissiveMap: night,          // city lights
      emissive: new THREE.Color(0xffff88),
      emissiveIntensity: 0.6,
      roughness: 0.7,
      metalness: 0.05,
    });

    return new THREE.Mesh(new THREE.SphereGeometry(R, 128, 128), material);
  }

  private buildClouds(): THREE.Mesh {
    return new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.015, 96, 96),
      new THREE.MeshLambertMaterial({
        map: this.loadTexture('earth_clouds.png', true),
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
      }),
    );
  }

  private buildAtmosphere(): THREE.Mesh {
    // Simple additive fresnel glow via MeshBasicMaterial on a slightly larger
    // back-facing sphere — no custom GLSL, works everywhere.
    const material = new THREE.MeshBasicMaterial({
      color: 0x3d7bd6,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    });
    return new THREE.Mesh(new THREE.SphereGeometry(R * 1.14, 64, 64), material);
  }

  private buildStars(): THREE.Points {
    const count = 2200;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(60 + Math.random() * 90);
      positions.set([v.x, v.y, v.z], i * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return new THREE.Points(geometry, new THREE.PointsMaterial({
      color: 0xbfd4ff, size: 0.42, sizeAttenuation: true, transparent: true, opacity: 0.85,
    }));
  }

  // ── region hot-spots ──────────────────────────────────────────────────

  private addRegionMarker(r: { region: string; lat: number; lon: number }): void {
    const stat: RegionStat = this.stats.find((s) => s.region === r.region)!;
    const position = this.toCartesian(R * 1.005, r.lat, r.lon);
    const quaternion = this.orientMarker(r.lat, r.lon);

    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0x94a3b8 }),
    );
    dot.position.copy(position);

    const halo = new THREE.Mesh(
      new THREE.RingGeometry(0.11, 0.2, 32),
      new THREE.MeshBasicMaterial({
        color: 0x94a3b8, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false,
      }),
    );
    halo.position.copy(position);
    halo.quaternion.copy(quaternion);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.16, 0.23, 40),
      new THREE.MeshBasicMaterial({
        color: 0x94a3b8, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false,
      }),
    );
    ring.position.copy(position);
    ring.quaternion.copy(quaternion);
    ring.userData['region'] = r.region;

    this.earth.add(dot, halo, ring);
    this.markers.set(r.region, { dot, halo, ring, stat });
  }

  private animateMarkers(t: number): void {
    for (const m of this.markers.values()) {
      const active = m.stat.events > 0;
      const severity = m.stat.maxSeverity;
      const color = active ? (DOMAIN_COLORS[m.stat.lastDomain] ?? 0x64748b) : 0x64748b;
      (m.dot.material as THREE.MeshBasicMaterial).color.setHex(color);
      (m.halo.material as THREE.MeshBasicMaterial).color.setHex(color);

      // size & breathing track live severity
      const heat = active ? 0.5 + severity : 0.35;
      const breathe = 1 + 0.16 * Math.sin(t * (1.2 + severity * 2.4));
      m.dot.scale.setScalar(heat * breathe);
      m.halo.scale.setScalar(heat * (1 + 0.1 * Math.sin(t * (2 + severity * 3))));
      (m.halo.material as THREE.MeshBasicMaterial).opacity = active ? 0.55 : 0.25;

      // the wave lives ONLY on the point: a small ring that beats outward
      // from the hot-spot and BLINKS on/off — faster when the region is hotter
      const cycle = (t * (0.5 + severity * 1.4)) % 1;
      m.ring.scale.setScalar(1 + cycle * 2.4);
      const blink = Math.sin(t * (3 + severity * 5)) > 0 ? 1 : 0.08;
      (m.ring.material as THREE.MeshBasicMaterial).opacity =
        (active ? 0.85 : 0.3) * blink;
    }
  }

  private updateHover(): void {
    if (!this.renderer) return;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const rings = Array.from(this.markers.values()).map((m) => m.ring);
    const hit = this.raycaster.intersectObjects(rings, false)[0]?.object;
    const region = (hit?.userData?.['region'] as string) ?? null;
    if (region !== this.hoverRegion) {
      this.hoverRegion = region;
      this.renderer.domElement.title = region
        ? `${region} — ${this.stats.find((s) => s.region === region)?.lastType ?? ''}`
        : '';
    }
  }

  private orientMarker(lat: number, lon: number): THREE.Quaternion {
    const up = this.toCartesian(1, lat, lon).normalize();
    return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), up);
  }

  private toCartesian(r: number, lat: number, lon: number): THREE.Vector3 {
    const phi = THREE.MathUtils.degToRad(90 - lat);
    const theta = THREE.MathUtils.degToRad(lon + 180);
    return new THREE.Vector3(
      -r * Math.sin(phi) * Math.cos(theta),
      r * Math.cos(phi),
      r * Math.sin(phi) * Math.sin(theta),
    );
  }
}
