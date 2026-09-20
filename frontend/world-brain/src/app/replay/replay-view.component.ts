import { Component, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { DemoEngine } from '../demo/gaia-demo.engine';

interface ReplayEvent {
  id?: string;
  tick: number;
  domain: string;
  type: string;
  severity: number;
  region: string;
  state?: Record<string, Record<string, any>>;
}

interface Metric {
  key: string;
  value: string;
}

const INGESTION_API = 'http://localhost:8181';

const DOMAIN_CSS: Record<string, string> = {
  energy: '#f59e0b',
  cities: '#10b981',
  transport: '#06b6d4',
  finance: '#ec4899',
};

@Component({
  selector: 'gb-replay-view',
  standalone: true,
  imports: [FormsModule],
  template: `
    <section class="replay">
      <header class="head">
        <div>
          <h2>Deterministic Replay</h2>
          <p class="muted">Same seed, same events. The window is rebuilt from scratch and never published.</p>
        </div>
        <div class="badge" [class.busy]="loading()">{{ loading() ? 'REPLAYING' : 'READY' }}</div>
      </header>

      @if (offline()) {
        <p class="demo-note">⚙ Backend not reachable — replaying with the <b>in-browser GAIA engine</b> (deterministic, seed 42).</p>
      }

      <div class="controls">
        <label>
          <span>Window start - tick {{ win }}</span>
          <input type="range" [(ngModel)]="win" (ngModelChange)="load()" min="0" max="2000" step="50" />
        </label>
        <label>
          <span>Window length - {{ span }} ticks</span>
          <input type="range" [(ngModel)]="span" (ngModelChange)="load()" min="50" max="500" step="50" />
        </label>
        <div class="range-label">replaying ticks {{ windowLabel }}</div>
      </div>

      @if (error(); as err) {
        <p class="error">{{ err }}</p>
      }

      <div class="chips">
        <button type="button" [class.on]="domainFilter() === 'all'" (click)="domainFilter.set('all')">
          all <b>{{ events().length }}</b>
        </button>
        @for (d of domainKeys; track d) {
          <button type="button" [class.on]="domainFilter() === d"
                  [style.--c]="domainColor(d)" (click)="domainFilter.set(d)">
            {{ d }} <b>{{ counts()[d] }}</b>
          </button>
        }
      </div>

      <div class="grid">
        <div class="card">
          <div class="card-title">EVENT LOG <span class="muted">- {{ filtered().length }} shown</span></div>
          <ul class="log">
            @for (e of filtered().slice(-80); track $index) {
              <li [style.--c]="domainColor(e.domain)">
                <span class="t">{{ e.tick }}</span>
                <span class="dom">{{ e.domain }}</span>
                <span class="type">{{ e.type }}</span>
                <span class="reg">{{ e.region }}</span>
                <span class="sev"><i [style.width.%]="severityPct(e.severity)"></i></span>
                <span class="sevnum">{{ e.severity.toFixed(2) }}</span>
              </li>
            } @empty {
              <li class="empty">No events in this window.</li>
            }
          </ul>
        </div>

        @if (snapshot(); as snap) {
          <div class="card">
            <div class="card-title">WORLD STATE SNAPSHOT</div>
            @for (d of domainKeys; track d) {
              <div class="domain">
                <span class="dname" [style.color]="domainColor(d)">{{ d }}</span>
                <div class="metrics">
                  @for (m of metricsOf(snap, d); track m.key) {
                    <span class="metric"><b>{{ m.key }}</b> {{ m.value }}</span>
                  }
                </div>
              </div>
            }
          </div>
        }
      </div>
    </section>
  `,  styles: [`
    :host { display: block; }
    .replay { padding: 4px 2px; }
    .head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
    .head h2 { margin: 0 0 4px; font-size: 1.15rem; letter-spacing: .02em; }
    .muted { color: #64748b; font-size: .85rem; margin: 0; }
    .badge {
      font-family: ui-monospace, monospace; font-size: 10px; letter-spacing: .12em;
      padding: 4px 10px; border-radius: 999px; color: #37e0a2;
      border: 1px solid rgba(55, 224, 162, .35); background: rgba(55, 224, 162, .08);
      white-space: nowrap;
    }
    .badge.busy { color: #fbbf24; border-color: rgba(251, 191, 36, .35); background: rgba(251, 191, 36, .08); }

    .controls {
      margin: 16px 0; padding: 12px 14px; border-radius: 10px;
      background: #0b1220; border: 1px solid #1c2940;
      display: grid; grid-template-columns: 1fr 1fr; gap: 8px 20px;
    }
    .controls label { display: block; }
    .controls label span {
      display: block; font-size: .75rem; letter-spacing: .06em;
      text-transform: uppercase; color: #7dd3fc; margin-bottom: 6px;
    }
    input[type=range] { width: 100%; accent-color: #37e0a2; }
    .range-label {
      grid-column: 1 / -1; font-family: ui-monospace, monospace;
      font-size: .75rem; color: #94a3b8;
    }

    .error { color: #fca5a5; font-weight: 600; font-size: .9rem; }

    .chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0; }
    .chips button {
      --c: #64748b;
      font-family: ui-monospace, monospace; font-size: 11px; cursor: pointer;
      padding: 5px 11px; border-radius: 999px;
      background: rgba(255, 255, 255, .03); border: 1px solid rgba(255, 255, 255, .1);
      color: #94a3b8; transition: all .2s ease;
    }
    .chips button b { color: #e2e8f0; }
    .chips button:hover { border-color: rgba(255, 255, 255, .25); color: #e2e8f0; }
    .chips button.on {
      border-color: var(--c); color: #f8fafc;
      background: color-mix(in srgb, var(--c) 18%, transparent);
      box-shadow: 0 0 12px color-mix(in srgb, var(--c) 25%, transparent);
    }

    .grid { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); gap: 16px; }
    @media (max-width: 980px) { .grid { grid-template-columns: 1fr; } }

    .card {
      background: #0b1220; border: 1px solid #1c2940; border-radius: 12px;
      padding: 12px 14px; min-width: 0;
    }
    .card-title {
      font-family: ui-monospace, monospace; font-size: 10px; letter-spacing: .12em;
      color: #7dd3fc; margin-bottom: 10px;
    }

    .log { list-style: none; margin: 0; padding: 0; max-height: 46vh; overflow: auto; }
    .log li {
      --c: #64748b;
      display: grid;
      grid-template-columns: 52px 84px minmax(0, 1fr) 74px 70px 42px;
      align-items: center; gap: 8px;
      font-family: ui-monospace, monospace; font-size: 11.5px;
      padding: 4px 6px; border-radius: 6px;
      border-left: 2px solid transparent;
    }
    .log li:nth-child(odd) { background: rgba(255, 255, 255, .015); }
    .log li:hover { background: rgba(255, 255, 255, .05); border-left-color: var(--c); }
    .log .t { color: #475569; }
    .log .dom { color: var(--c); font-weight: 600; }
    .log .type { color: #cbd5e1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .log .reg { color: #7dd3fc; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .log .sev { height: 5px; border-radius: 3px; background: rgba(255, 255, 255, .08); overflow: hidden; }
    .log .sev i { display: block; height: 100%; border-radius: 3px; background: var(--c); }
    .log .sevnum { text-align: right; color: #94a3b8; }
    .log .empty { display: block; color: #64748b; font-style: italic; padding: 8px 6px; }

    .domain { padding: 8px 0; border-top: 1px solid rgba(255, 255, 255, .06); }
    .domain:first-of-type { border-top: 0; }
    .dname {
      font-family: ui-monospace, monospace; font-size: 10.5px; font-weight: 700;
      letter-spacing: .1em; text-transform: uppercase;
    }
    .metrics { display: flex; flex-wrap: wrap; gap: 4px 10px; margin-top: 4px; }
    .metric { font-family: ui-monospace, monospace; font-size: 11px; color: #cbd5e1; }
    .metric b { color: #64748b; font-weight: 500; }

    .demo-note {
      margin: 12px 0 0; padding: 10px 12px; border-radius: 10px; font-size: .84rem;
      color: #a5f3d8; background: rgba(55, 224, 162, .07);
      border: 1px solid rgba(55, 224, 162, .28);
    }
    .demo-note b { color: #37e0a2; }
  `],
})export class ReplayViewComponent {
  private http = inject(HttpClient);

  readonly domainKeys = ['energy', 'cities', 'transport', 'finance'];

  win = 0;
  span = 200;

  events = signal<ReplayEvent[]>([]);
  loading = signal(false);
  error = signal<string | null>(null);
  offline = signal(false);
  snapshot = signal<Record<string, Record<string, any>> | null>(null);
  domainFilter = signal<string>('all');

  /** The public GitHub Pages demo has no backend — the in-browser engine takes over. */
  private get onGitHubPages(): boolean {
    return typeof window !== 'undefined' && window.location.hostname.endsWith('github.io');
  }

  /** Per-domain event counts across the replayed window (all domains pre-seeded). */
  counts = computed<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    for (const d of this.domainKeys) out[d] = 0;
    for (const e of this.events()) out[e.domain] = (out[e.domain] ?? 0) + 1;
    return out;
  });

  /** Events after applying the domain filter chip. */
  filtered = computed<ReplayEvent[]>(() => {
    const f = this.domainFilter();
    return f === 'all' ? this.events() : this.events().filter((e) => e.domain === f);
  });

  constructor() {
    this.load();
  }

  get windowLabel(): string {
    return `${this.win} -> ${Math.min(this.win + this.span, 10_000)}`;
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.offline.set(false);
    const to = Math.min(this.win + this.span, 10_000);

    // On the public GitHub Pages demo there is no backend — replay the
    // deterministic in-browser engine instead of failing with a CORS error.
    if (this.onGitHubPages) {
      setTimeout(() => this.finishLocalReplay(to), 120);
      return;
    }

    this.http
      .get<ReplayEvent[]>(`${INGESTION_API}/replay?fromTick=${this.win}&toTick=${to}`)
      .subscribe({
        next: (evts) => {
          const list = evts ?? [];
          this.events.set(list);
          // Each record carries the domain-state snapshot for its tick.
          this.snapshot.set(list.length ? (list[list.length - 1].state ?? null) : null);
          this.loading.set(false);
        },
        error: () => this.finishLocalReplay(to),
        complete: () => this.loading.set(false),
      });
  }

  /** Deterministic window replayed on the in-browser engine (seed 42). */
  private finishLocalReplay(to: number): void {
    const { events, snapshots } = new DemoEngine(42).replay(42, this.win, to);
    const snap = snapshots.get(to) ?? null;
    this.events.set(
      events.map((e) => ({
        tick: e.tick, domain: e.domain, type: e.type, severity: e.severity, region: e.region,
      })),
    );
    this.snapshot.set(
      snap
        ? {
            energy: { heatwaveIntensity: snap.heatwaveIntensity, outages: snap.outages },
            cities: { waterLevel: snap.waterLevel, strain: snap.strain },
            transport: { delay: snap.delay, fuelPriceIndex: snap.fuelPriceIndex },
            finance: { indexLevel: snap.indexLevel, volatility: snap.volatility, capital: snap.capital },
          }
        : null,
    );
    this.offline.set(true);
    this.error.set(null);
    this.loading.set(false);
  }

  domainColor(domain: string): string {
    return DOMAIN_CSS[domain] ?? '#64748b';
  }

  severityPct(severity: number): number {
    return Math.round(Math.min(1, Math.max(0, severity)) * 100);
  }

  /** Compact scalar metrics for one domain of the snapshot. */
  metricsOf(snap: Record<string, Record<string, any>>, domain: string): Metric[] {
    const state = snap?.[domain];
    if (!state) return [];
    const out: Metric[] = [];
    for (const [key, value] of Object.entries(state)) {
      if (typeof value === 'number') {
        out.push({ key, value: Number.isInteger(value) ? String(value) : value.toFixed(3) });
      } else if (typeof value === 'string') {
        out.push({ key, value });
      } else if (Array.isArray(value)) {
        out.push({ key, value: `${value.length} items` });
      }
      if (out.length >= 4) break;
    }
    return out;
  }
}