import { Component, inject, signal } from '@angular/core';
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
  template: `<section>
    <h2>Scenario Runner</h2>
    <form (ngSubmit)="runScenario()">
      <label>Baseline ticks
        <input type="number" name="baseline" [(ngModel)]="baselineTicks" />
      </label>
      <label>Scenario ticks
        <input type="number" name="ticks" [(ngModel)]="scenarioTicks" />
      </label>
      <label>Entities
        <input type="number" name="entities" [(ngModel)]="entities" />
      </label>
      <label>Perturbations
        <select name="perturbation" [(ngModel)]="selectedPert">
          <option value="heatwave">heatwave</option>
          <option value="outage">outage</option>
          <option value="strain">strain</option>
          <option value="delay">delay</option>
          <option value="crash">crash</option>
          <option value="liquidity">liquidity</option>
        </select>
      </label>
      <button type="submit" [disabled]="running()">Run & Diagnose</button>
      <button type="button" (click)="resetDefaults()" [disabled]="running()">Reset fast defaults</button>
    </form>

    @if (running()) {
      <p class="muted">Running baseline + scenario… (this can take a minute on 50k entities)</p>
    }

    @if (error(); as e) {
      <p class="error">❌ {{ e }}</p>
    }

    @if (diff(); as d) {
      <h3>What-if impact (perturbation: {{ d.perturbations.join(', ') }})</h3>
      <table class="diffs">
        <thead>
          <tr><th>Domain</th><th>Metric</th><th>&Delta;</th></tr>
        </thead>
        <tbody>
          @for (deltas of d.diffs | keyvalue; track deltas.key) {
            @for (delta of deltas.value | keyvalue; track delta.key) {
              <tr>
                <td>{{ deltas.key }}</td>
                <td>{{ delta.key }}</td>
                <td [class.bad]="delta.value > 0" [class.good]="delta.value < 0">{{ delta.value | number:'1.2-2' }}</td>
              </tr>
            }
          }
        </tbody>
      </table>
      <p class="muted">{{ d.scenarioEvents }} events over {{ d.scenarioTicks }} ticks (id {{ d.id.slice(0, 8) }})</p>
    }

    @if (suggestions().length) {
      <h3>Suggested interventions</h3>
      <ul class="actions">
        @for (a of suggestions(); track a.action) {
          <li><strong>{{ a.action }}</strong> ({{ a.domain }}) — {{ a.rationale }}</li>
        }
      </ul>
    }
  </section>`,
  styles: [`
    .diffs { border-collapse: collapse; width: 100%; }
    .diffs td, .diffs th { border: 1px solid #2a3; padding: 4px 8px; text-align: left; }
    .bad { color: #fca5a5; }
    .good { color: #86efac; }
    .muted { color: #64748b; font-size: 0.85em; }
    .error { color: #fca5a5; font-weight: 600; }
    .actions li { margin: 4px 0; }
  `],
})
export class ScenarioRunnerComponent {
  private http = inject(HttpClient);

  baselineTicks = DEFAULTS.baselineTicks;
  scenarioTicks = DEFAULTS.scenarioTicks;
  entities = DEFAULTS.entities;
  selectedPert = 'heatwave';

  running = signal(false);
  diff = signal<ScenarioDiff | null>(null);
  suggestions = signal<SuggestedAction[]>([]);
  error = signal<string | null>(null);

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