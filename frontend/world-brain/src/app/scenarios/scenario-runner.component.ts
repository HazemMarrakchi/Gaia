import { Component, computed, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { DecimalPipe, KeyValuePipe } from '@angular/common';
import { timeout, catchError } from 'rxjs/operators';
import { of } from 'rxjs';

interface ScenarioDiff {
  baselineTick: number;
  scenarioTicks: number;
  scenarioEvents: number;
  id: string;
  diffs: Record<string, Record<string, number>>;
  perturbations: string[];
}

interface SuggestedAction {
  action: string;
  domain: string;
  rationale: string;
}

const SCENARIO_API = 'http://localhost:8282';
const AI_API = 'http://localhost:8091';

/** The 1M-entity default takes minutes — give the engine time, then fail loud. */
const SCENARIO_TIMEOUT_MS = 600_000;
const AI_TIMEOUT_MS = 30_000;

/** Small + fast enough to stay under every proxy/browser timeout. */
const DEFAULTS = { baselineTicks: 60, scenarioTicks: 30, entities: 50_000 };

@Component({
  selector: 'gb-scenario-runner',
  standalone: true,
  imports: [FormsModule, KeyValuePipe, DecimalPipe],
  template: `<section class="scenario">
    <header class="head">
      <div>
        <h2>Scenario Runner</h2>
        <p class="muted">Perturb a deep clone of the world, run it forward, diff every domain. The live world is never touched.</p>
      </div>
      <div class="badge" [class.busy]="running()">{{ running() ? 'RUNNING' : 'IDLE' }}</div>
    </header>

    <form class="params" (ngSubmit)="runScenario()">
      <label>
        <span>Baseline ticks</span>
        <input type="number" name="baseline" [(ngModel)]="baselineTicks" min="1" />
      </label>
      <label>
        <span>Scenario ticks</span>
        <input type="number" name="ticks" [(ngModel)]="scenarioTicks" min="1" />
      </label>
      <label>
        <span>Entities</span>
        <input type="number" name="entities" [(ngModel)]="entities" min="10" step="1000" />
      </label>
      <label>
        <span>Perturbation</span>
        <select name="perturbation" [(ngModel)]="selectedPert">
          <option value="heatwave">heatwave</option>
          <option value="outage">outage</option>
          <option value="strain">strain</option>
          <option value="delay">delay</option>
          <option value="crash">crash</option>
          <option value="liquidity">liquidity</option>
        </select>
      </label>
      <div class="actions-row">
        <button type="submit" class="primary" [disabled]="running()">Run &amp; Diagnose</button>
        <button type="button" class="ghost" (click)="resetDefaults()" [disabled]="running()">Reset fast defaults</button>
      </div>
    </form>

    @if (running()) {
      <div class="progress"><i></i></div>
      <p class="muted">Running baseline + scenario… (this can take a minute on 50k entities)</p>
    }

    @if (error(); as e) {
      <p class="error">❌ {{ e }}</p>
    }

    @if (diff(); as d) {
      <h3>What-if impact <span class="muted">perturbation: {{ d.perturbations.join(', ') }}</span></h3>
      <div class="cards">
        @for (domain of domainOrder; track domain) {
          @if (d.diffs[domain]; as metrics) {
            <div class="card">
              <div class="card-head">
                <span class="domain" [style.color]="domainColor(domain)">{{ domain }}</span>
              </div>
              @for (metric of metrics | keyvalue; track metric.key) {
                <div class="metric">
                  <span class="m-key">{{ metric.key }}</span>
                  <span class="m-val" [class.bad]="metric.value > 0" [class.good]="metric.value < 0">
                    {{ metric.value | number:'1.3-3' }}
                  </span>
                  <span class="m-bar">
                    <i [style.width.%]="deltaWidth(metric.value)"
                       [style.background]="metric.value > 0 ? '#f87171' : '#4ade80'"></i>
                  </span>
                </div>
              }
            </div>
          }
        }
      </div>
      <p class="muted">{{ d.scenarioEvents }} events over {{ d.scenarioTicks }} ticks · id {{ d.id.slice(0, 8) }}</p>
    }

    @if (suggestions().length) {
      <h3>Suggested interventions</h3>
      <ul class="actions">
        @for (a of suggestions(); track a.action) {
          <li [style.--c]="domainColor(a.domain)">
            <strong>{{ a.action }}</strong>
            <span class="chip">{{ a.domain }}</span>
            <span class="rationale">{{ a.rationale }}</span>
          </li>
        }
      </ul>
    }
  </section>`,
  styles: [`
    :host { display: block; }
    .scenario { padding: 4px 2px; }
    .head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
    .head h2 { margin: 0 0 4px; font-size: 1.15rem; }
    .muted { color: #64748b; font-size: .85rem; margin: 0; }
    .badge {
      font-family: ui-monospace, monospace; font-size: 10px; letter-spacing: .12em;
      padding: 4px 10px; border-radius: 999px; color: #37e0a2; white-space: nowrap;
      border: 1px solid rgba(55, 224, 162, .35); background: rgba(55, 224, 162, .08);
    }
    .badge.busy { color: #fbbf24; border-color: rgba(251, 191, 36, .35); background: rgba(251, 191, 36, .08); }

    .params {
      margin: 16px 0; padding: 14px; border-radius: 10px;
      background: #0b1220; border: 1px solid #1c2940;
      display: grid; grid-template-columns: repeat(4, minmax(120px, 1fr)); gap: 12px;
    }
    @media (max-width: 820px) { .params { grid-template-columns: 1fr 1fr; } }
    .params label span {
      display: block; font-family: ui-monospace, monospace; font-size: 10px;
      letter-spacing: .1em; text-transform: uppercase; color: #7dd3fc; margin-bottom: 6px;
    }
    .params input, .params select {
      width: 100%; padding: 7px 9px; border-radius: 7px; font-size: .88rem;
      background: #070d18; color: #e6edf7; border: 1px solid #22304a;
    }
    .params input:focus, .params select:focus { border-color: var(--accent); outline: none; }
    .actions-row { grid-column: 1 / -1; display: flex; gap: 10px; flex-wrap: wrap; }
    button {
      cursor: pointer; font-size: .85rem; font-weight: 600;
      padding: 8px 16px; border-radius: 8px; transition: all .18s ease;
    }
    button.primary {
      background: var(--accent); color: #052e21; border: 1px solid transparent;
      box-shadow: 0 0 18px rgba(55, 224, 162, .25);
    }
    button.primary:hover:not(:disabled) { filter: brightness(1.08); }
    button.ghost { background: transparent; color: #94a3b8; border: 1px solid #22304a; }
    button.ghost:hover:not(:disabled) { color: #e2e8f0; border-color: #33456a; }
    button:disabled { opacity: .5; cursor: not-allowed; }

    .progress { height: 3px; border-radius: 3px; background: rgba(255, 255, 255, .07); overflow: hidden; margin: 10px 0 6px; }
    .progress i { display: block; height: 100%; width: 35%; background: var(--accent);
      animation: slide 1.15s ease-in-out infinite; }
    @keyframes slide { 0% { transform: translateX(-100%); } 100% { transform: translateX(330%); } }

    .error {
      color: #fca5a5; font-weight: 600; font-size: .88rem;
      padding: 10px 12px; border-radius: 8px;
      background: rgba(248, 113, 113, .08); border: 1px solid rgba(248, 113, 113, .28);
    }

    h3 { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }

    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
    .card { background: #0b1220; border: 1px solid #1c2940; border-radius: 12px; padding: 12px 14px; }
    .card-head { margin-bottom: 8px; }
    .domain {
      font-family: ui-monospace, monospace; font-size: 10.5px; font-weight: 700;
      letter-spacing: .12em; text-transform: uppercase;
    }
    .metric { display: grid; grid-template-columns: 1fr auto; gap: 2px 10px; padding: 5px 0;
      border-top: 1px solid rgba(255, 255, 255, .05); }
    .metric:first-of-type { border-top: 0; }
    .m-key { font-family: ui-monospace, monospace; font-size: 11px; color: #94a3b8; }
    .m-val { font-family: ui-monospace, monospace; font-size: 11.5px; font-weight: 600;
      font-variant-numeric: tabular-nums; color: #e2e8f0; }
    .m-val.bad { color: #f87171; }
    .m-val.good { color: #4ade80; }
    .m-bar { grid-column: 1 / -1; height: 4px; border-radius: 2px;
      background: rgba(255, 255, 255, .06); overflow: hidden; }
    .m-bar i { display: block; height: 100%; border-radius: 2px; transition: width .5s ease; }

    .actions { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; max-width: 820px; }
    .actions li {
      --c: #64748b;
      display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap;
      padding: 10px 12px; border-radius: 10px;
      background: #0b1220; border: 1px solid #1c2940;
      border-left: 3px solid var(--c);
    }
    .actions strong { font-family: ui-monospace, monospace; font-size: .84rem; color: #f1f5f9; }
    .actions .chip {
      font-family: ui-monospace, monospace; font-size: 9.5px; letter-spacing: .1em;
      text-transform: uppercase; padding: 2px 8px; border-radius: 999px;
      color: var(--c); border: 1px solid color-mix(in srgb, var(--c) 45%, transparent);
      background: color-mix(in srgb, var(--c) 12%, transparent);
    }
    .actions .rationale { color: #94a3b8; font-size: .84rem; }
  `],
})
export class ScenarioRunnerComponent {
  private http = inject(HttpClient);

  readonly domainOrder = ['energy', 'cities', 'transport', 'finance'];

  private static readonly DOMAIN_CSS: Record<string, string> = {
    energy: '#f59e0b',
    cities: '#10b981',
    transport: '#06b6d4',
    finance: '#ec4899',
    global: '#94a3b8',
  };

  baselineTicks = DEFAULTS.baselineTicks;
  scenarioTicks = DEFAULTS.scenarioTicks;
  entities = DEFAULTS.entities;
  selectedPert = 'heatwave';

  running = signal(false);
  diff = signal<ScenarioDiff | null>(null);
  suggestions = signal<SuggestedAction[]>([]);
  error = signal<string | null>(null);

  /** Largest absolute delta in the current diff — used to scale the metric bars. */
  maxDelta = computed<number>(() => {
    const d = this.diff();
    if (!d) return 1;
    const values = Object.values(d.diffs ?? {})
      .flatMap((metrics) => Object.values(metrics))
      .filter((v) => typeof v === 'number')
      .map(Math.abs);
    return values.length ? Math.max(...values) : 1;
  });

  domainColor(domain: string): string {
    return ScenarioRunnerComponent.DOMAIN_CSS[domain] ?? '#64748b';
  }

  /** Relative bar width for a delta value, scaled against the largest delta. */
  deltaWidth(value: number): number {
    const max = this.maxDelta();
    return max > 0 ? Math.min(100, (Math.abs(value) / max) * 100) : 0;
  }

  resetDefaults(): void {
    this.baselineTicks = DEFAULTS.baselineTicks;
    this.scenarioTicks = DEFAULTS.scenarioTicks;
    this.entities = DEFAULTS.entities;
    this.selectedPert = 'heatwave';
    this.error.set(null);
  }

  runScenario(): void {
    this.running.set(true);
    this.error.set(null);
    this.diff.set(null);
    this.suggestions.set([]);
    const body = {
      baselineTicks: this.baselineTicks,
      ticks: this.scenarioTicks,
      perturbations: [this.selectedPert],
      seed: 42,
      entities: this.entities,
    };

    this.http
      .post<ScenarioDiff>(`${SCENARIO_API}/scenarios`, body)
      .pipe(
        timeout(SCENARIO_TIMEOUT_MS),
        catchError((err: unknown) => {
          this.error.set(this.describeError(err));
          this.running.set(false);
          return of(null);
        }),
      )
      .subscribe({
        next: (d) => {
          if (!d) return;
          this.diff.set(d);
          this.suggestFrom(d);
        },
        error: () => this.running.set(false),
        complete: () => this.running.set(false),
      });
  }

  private describeError(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      const httpErr: HttpErrorResponse = err;
      if (err.status === 0) {
        return 'Scenario service unreachable at http://localhost:8282 — is the scenario-service running?';
      }
      if (err.status === 504) {
        return 'Scenario run timed out — lower the ticks/entities and retry.';
      }
      const raw: unknown = httpErr.error;
      const detail =
        typeof raw === 'string'
          ? raw
          : (err.message ?? 'unknown error');
      return `Scenario service failed (HTTP ${httpErr.status || '???'}): ${detail}`;
    }
    if (err instanceof Error && err.name === 'TimeoutError') {
      return 'Scenario run timed out — lower the ticks/entities and retry.';
    }
    return 'Scenario run failed before reaching the backend — please retry.';
  }

  private suggestFrom(d: ScenarioDiff): void {
    const stress = (domain: string): number => {
      const dvals = d.diffs[domain] ?? {};
      const values = Object.values(dvals).filter((v) => typeof v === 'number');
      if (!values.length) return 0;
      const worst = Math.max(...values.map(Math.abs));
      return Math.min(1, worst / 10);
    };
    this.http
      .post<SuggestedAction[]>(`${AI_API}/scenario/suggest`, {
        domain_stress: {
          energy: stress('energy'),
          cities: stress('cities'),
          transport: stress('transport'),
          finance: stress('finance'),
        },
        recent_metrics: [d.scenarioEvents, d.diffs['energy']?.['outageDelta'] ?? 0],
      })
      .pipe(timeout(AI_TIMEOUT_MS), catchError(() => of([])))
      .subscribe({ next: (acts) => this.suggestions.set(acts ?? []), error: () => {} });
  }
}