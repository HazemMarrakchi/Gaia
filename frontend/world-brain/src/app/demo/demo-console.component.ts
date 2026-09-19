import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GlobePanelComponent } from '../core/globe/globe-panel.component';
import { DemoWorld } from './demo-world.service';
import { DemoEvent, PerturbationKind, demoLatLon } from './gaia-demo.engine';

const DOMAIN_CSS: Record<string, string> = {
  energy: '#ffaa00',
  cities: '#4ade80',
  transport: '#38bdf8',
  finance: '#f472b6',
};

const PERTURBATIONS: Array<{ kind: PerturbationKind; label: string; hint: string }> = [
  { kind: 'heatwave-eu', label: 'EU heatwave', hint: 'Regional crisis in eu-west' },
  { kind: 'heatwave-global', label: 'Global heatwave', hint: 'Every region stressed' },
  { kind: 'outage', label: 'Plant outage', hint: 'Knock 3 plants offline' },
  { kind: 'crash', label: 'Market crash', hint: 'Index -10%, volatility up' },
  { kind: 'liquidity', label: 'Liquidity drain', hint: 'Bank capital -20%' },
];

@Component({
  selector: 'gb-demo-console',
  standalone: true,
  imports: [FormsModule, GlobePanelComponent],
  providers: [DemoWorld],
  template: `
    <section class="demo">
      <div class="globe-wrap">
        <gb-globe-panel [world]="world" />
      </div>

      <aside class="console">
        <div class="console-head">
          <span class="console-title">OPERATOR CONSOLE</span>
          <button type="button" class="pause" (click)="togglePause()" [attr.aria-pressed]="world.paused()">
            {{ world.paused() ? 'Resume' : 'Pause' }}
          </button>
        </div>

        <p class="console-sub">Inject a crisis. Watch it propagate across every domain.</p>

        <div class="perturbs">
          @for (p of perturbations; track p.kind) {
            <button type="button" class="perturb" (click)="world.inject(p.kind)" [title]="p.hint">
              <span class="p-label">{{ p.label }}</span>
              <span class="p-hint">{{ p.hint }}</span>
            </button>
          }
        </div>

        <div class="shock">
          <div class="shock-head">
            <span>SYSTEMIC SHOCK</span>
            <span class="shock-val" [style.color]="shockColor(world.shock())">{{ shockPct() }}%</span>
          </div>
          <div class="bar"><div class="fill" [style.width.%]="shockPct()" [style.background]="shockColor(world.shock())"></div></div>
        </div>

        <div class="metrics">
          @for (m of metrics(); track m.key) {
            <div class="metric">
              <span class="m-key">{{ m.key }}</span>
              <span class="m-val" [style.color]="m.color">{{ m.value }}</span>
            </div>
          }
        </div>

        <div class="log-card">
          <div class="log-title">LIVE EVENT STREAM</div>
          <ul class="log">
            @for (e of feed(); track e.id) {
              <li [style.--c]="domainColor(e.domain)">
                <span class="t">{{ e.tick }}</span>
                <span class="dom">{{ e.domain }}</span>
                <span class="type">{{ e.type }}</span>
              </li>
            }
          </ul>
        </div>
      </aside>
    </section>
  `,
  styles: [`
    :host { display: block; }
    .demo { display: grid; grid-template-columns: minmax(0, 1.6fr) 340px; gap: 16px; align-items: start; }
    @media (max-width: 1080px) { .demo { grid-template-columns: 1fr; } }
    .globe-wrap { min-width: 0; }
    .console {
      background: rgba(4, 10, 22, .78); border: 1px solid rgba(90, 140, 220, .22);
      border-radius: 12px; padding: 14px 16px; backdrop-filter: blur(10px);
      font-family: ui-monospace, monospace; font-size: 12px; color: #cbd5e1;
      box-shadow: 0 8px 32px rgba(0, 0, 0, .45);
    }
    .console-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
    .console-title { color: #7dd3fc; letter-spacing: .12em; font-size: 10px; font-weight: 600; }
    .pause {
      font-family: inherit; font-size: 10px; letter-spacing: .08em; cursor: pointer;
      background: rgba(55, 224, 162, .1); color: #37e0a2; border: 1px solid rgba(55, 224, 162, .35);
      border-radius: 999px; padding: 4px 12px; transition: all .2s ease;
    }
    .pause:hover { background: rgba(55, 224, 162, .2); }
    .pause[aria-pressed="true"] {
      color: #fbbf24; border-color: rgba(251, 191, 36, .4); background: rgba(251, 191, 36, .1);
    }
    .console-sub { margin: 0 0 12px; color: #64748b; font-size: 11px; }
    .perturbs { display: grid; gap: 8px; }
    .perturb {
      font-family: inherit; text-align: left; cursor: pointer;
      background: rgba(248, 113, 113, .06); border: 1px solid rgba(248, 113, 113, .25);
      border-radius: 10px; padding: 8px 12px; transition: all .2s ease;
    }
    .perturb:hover { background: rgba(248, 113, 113, .14); transform: translateX(2px); }
    .p-label { display: block; color: #fca5a5; font-size: 11.5px; font-weight: 600; }
    .p-hint { display: block; color: #64748b; font-size: 10px; margin-top: 2px; }
    .shock { margin: 14px 0 4px; }
    .shock-head { display: flex; justify-content: space-between; font-size: 10px; letter-spacing: .08em; margin-bottom: 6px; }
    .shock-val { font-size: 13px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .bar { height: 6px; background: rgba(255,255,255,.07); border-radius: 3px; overflow: hidden; }
    .fill { height: 100%; border-radius: 3px; transition: width .4s ease; }
    .metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 12px; margin: 12px 0; }
    .metric { display: flex; justify-content: space-between; padding: 4px 0; border-top: 1px solid rgba(255,255,255,.05); font-size: 11px; }
    .m-key { color: #94a3b8; }
    .m-val { font-weight: 600; font-variant-numeric: tabular-nums; }
    .log-card { border-top: 1px solid rgba(90, 140, 220, .18); padding-top: 10px; }
    .log-title { color: #7dd3fc; letter-spacing: .12em; font-size: 10px; font-weight: 600; margin-bottom: 8px; }
    .log { list-style: none; margin: 0; padding: 0; max-height: 220px; overflow: auto; }
    .log li {
      --c: #64748b;
      display: grid; grid-template-columns: 46px 76px 1fr; gap: 8px;
      padding: 3px 4px; border-left: 2px solid transparent; font-size: 11px;
    }
    .log li:hover { border-left-color: var(--c); background: rgba(255,255,255,.04); }
    .log .t { color: #475569; }
    .log .dom { color: var(--c); font-weight: 600; }
    .log .type { color: #cbd5e1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  `],
})
export class DemoConsoleComponent implements OnDestroy {
  readonly world = inject(DemoWorld);
  readonly perturbations = PERTURBATIONS;
  private version = signal(0);

  feed = computed<readonly DemoEvent[]>(() => {
    this.version();
    return this.world.events().slice(-40).reverse();
  });

  metrics = computed<Array<{ key: string; value: string; color: string }>>(() => {
    this.version();
    const s = this.world.latestSnapshot();
    if (!s) return [];
    return [
      { key: 'heat', value: s.heatwaveIntensity.toFixed(2), color: heatColor(s.heatwaveIntensity) },
      { key: 'grid outages', value: String(s.outages), color: s.outages > 0 ? '#f87171' : '#64748b' },
      { key: 'water', value: s.waterLevel.toFixed(2), color: s.waterLevel < 0.3 ? '#f87171' : '#7dd3fc' },
      { key: 'strain', value: s.strain.toFixed(2), color: heatColor(s.strain) },
      { key: 'delay', value: s.delay.toFixed(2), color: heatColor(s.delay) },
      { key: 'fuel idx', value: s.fuelPriceIndex.toFixed(2), color: s.fuelPriceIndex > 1.1 ? '#fbbf24' : '#64748b' },
      { key: 'index', value: s.indexLevel.toFixed(1), color: s.indexLevel < 95 ? '#f87171' : '#4ade80' },
      { key: 'volatility', value: s.volatility.toFixed(2), color: s.volatility > 0.5 ? '#fbbf24' : '#64748b' },
    ];
  });

  shockPct = computed(() => Math.round(this.world.shock() * 100));

  constructor() {
    this.world.start();
    this.world.onUpdate(() => this.version.update((v) => v + 1));
    void demoLatLon;
  }

  ngOnDestroy(): void {
    this.world.stop();
  }

  togglePause(): void {
    this.world.paused.set(!this.world.paused());
  }

  domainColor(domain: string): string {
    return DOMAIN_CSS[domain] ?? '#64748b';
  }

  shockColor(shock: number): string {
    if (shock >= 0.7) return '#f87171';
    if (shock >= 0.4) return '#fbbf24';
    return '#37e0a2';
  }
}

function heatColor(v: number): string {
  if (v >= 0.6) return '#f87171';
  if (v >= 0.35) return '#fbbf24';
  return '#37e0a2';
}