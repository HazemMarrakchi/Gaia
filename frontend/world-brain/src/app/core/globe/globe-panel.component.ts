import { Component, ElementRef, AfterViewInit, OnDestroy, Output, EventEmitter, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import * as THREE from 'three';

interface SimEventDto {
  id: string;
  tick: number;
  domain: string;
  type: string;
  region: string;
  severity: number;
}

interface Marker {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  born: number;
  life: number;
}

const DOMAIN_COLORS: Record<string, string> = {
  energy: '#ffaa00',
  cities: '#4ade80',
  transport: '#38bdf8',
  finance: '#f472b6',
};

const DOMAIN_ANCHOR: Record<string, [number, number]> = {
  energy: [38, -98], // North America
  cities: [48, 2], // Europe
  transport: [35, 135], // East Asia
  finance: [-25, 25], // Southern Africa
};

const API = 'http://localhost:8181';

@Component({
  selector: 'gb-globe-panel',
  standalone: true,
  template: `<div #viewport class="globe"></div>`,
  styles: [`.globe { width: 100%; height: 70vh; }`],
})
export class GlobePanelComponent implements AfterViewInit, OnDestroy {
  @Output() tick: EventEmitter<number> = new EventEmitter<number>();

  private http = inject(HttpClient);
  private renderer?: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 1000);
  private rafId = 0;
  private pollId = 0;
  private markers: Map<string, Marker> = new Map();
  private lastEventIds = new Set<string>();
  private sphereRadius = 5;
  private clock = new THREE.Clock();

  constructor(private el: ElementRef) {}

  ngAfterViewInit(): void {
    const host = this.el.nativeElement.querySelector('.globe');
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(host.clientWidth, host.clientHeight);
    host.appendChild(this.renderer.domElement);

    const geometry = new THREE.SphereGeometry(this.sphereRadius, 64, 64);
    const material = new THREE.MeshBasicMaterial({ color: 0x113355, wireframe: true });
    this.scene.add(new THREE.Mesh(geometry, material));
    this.camera.position.z = 14;

    host.addEventListener('mousemove', (e: MouseEvent) => {
      this.camera.position.x = (e.clientX / window.innerWidth - 0.5) * 4;
      this.camera.position.y = -(e.clientY / window.innerHeight - 0.5) * 4;
    });

    this.pollId = window.setInterval(() => this.pollSim(), 1000);
    this.pollSim();

    const loop = () => {
      const dt = this.clock.getDelta();
      this.scene.rotateY(0.12 * dt);
      this.fade(dt);
      this.renderer?.render(this.scene, this.camera);
      this.rafId = requestAnimationFrame(loop);
    };
    this.clock.start();
    loop();
  }

  ngOnDestroy(): void {
    window.clearInterval(this.pollId);
    cancelAnimationFrame(this.rafId);
    this.renderer?.dispose();
  }

  private pollSim(): void {
    this.http
      .get<{ tick: number }>(`${API}/health/sim`)
      .subscribe({ next: (h) => this.tick.emit(h.tick), error: () => {} });

    this.http
      .get<SimEventDto[]>(`${API}/events?limit=40`)
      .subscribe({ next: (events) => this.applyEvents(events), error: () => {} });
  }

  private applyEvents(events: SimEventDto[]): void {
    const ids = new Set(events.map((e) => e.id));
    for (const event of events.slice(0, 14)) {
      if (this.lastEventIds.has(event.id)) continue;
      const color = DOMAIN_COLORS[event.domain] ?? '#94a3b8';
      const anchor = DOMAIN_ANCHOR[event.domain] ?? [0, 0];
      const jitter = [Math.sin(event.id.length), Math.cos(event.id.charCodeAt(0))];
      const lat = anchor[0] + jitter[0] * 6;
      const lon = anchor[1] + jitter[1] * 8;
      this.spawn(event.id, color, lat, lon, event.severity);
      if (this.markers.size > 90) {
        const oldest = Array.from(this.markers.keys())[0];
        this.remove(oldest);
      }
    }
    this.lastEventIds = ids;
  }

  private spawn(id: string, color: string, lat: number, lon: number, severity: number): void {
    const pos = this.toCartesian(this.sphereRadius * 1.035, lat, lon);
    const texture = this.makeGlow(color);
    const material = new THREE.SpriteMaterial({
      map: texture,
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.position.copy(pos);
    const scale = 0.45 + severity * 1.1;
    sprite.scale.set(scale, scale, 1);
    this.scene.add(sprite);
    this.markers.set(id, { sprite, material, born: this.clock.elapsedTime, life: 6 });
  }

  private fade(dt: number): void {
    const now = this.clock.elapsedTime;
    for (const id of Array.from(this.markers.keys())) {
      const m = this.markers.get(id)!;
      const age = now - m.born;
      if (age >= m.life) {
        this.remove(id);
        continue;
      }
      m.material.opacity = 0.95 * (1 - age / m.life);
      const grow = 1 + 0.8 * (age / m.life);
      m.material.rotation += dt * 0.6;
    }
  }

  private remove(id: string): void {
    const m = this.markers.get(id);
    if (!m) return;
    this.scene.remove(m.sprite);
    m.material.map?.dispose();
    m.material.dispose();
    this.markers.delete(id);
  }

  private makeGlow(color: string): THREE.Texture {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(canvas);
  }

  private toCartesian(r: number, lat: number, lon: number): THREE.Vector3 {
    const phi = THREE.MathUtils.degToRad(90 - lat);
    const theta = THREE.MathUtils.degToRad(lon);
    return new THREE.Vector3(
      r * Math.sin(phi) * Math.cos(theta),
      r * Math.cos(phi),
      r * Math.sin(phi) * Math.sin(theta)
    );
  }
}