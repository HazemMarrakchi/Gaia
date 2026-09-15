import { Component, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { DecimalPipe, KeyValuePipe } from '@angular/common';

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
      <button type="submit">Run & Diagnose</button>
    </form>

    @if (running()) {
      <p class="muted">Running baseline + scenario…</p>
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
    .actions li { margin: 4px 0; }
  `],
})
export class ScenarioRunnerComponent {
  private http = inject(HttpClient);

  baselineTicks = 240;
  scenarioTicks = 120;
  entities = 1_000_000;
  selectedPert = 'heatwave';

  running = signal(false);
  diff = signal<ScenarioDiff | null>(null);
  suggestions = signal<SuggestedAction[]>([]);

  runScenario(): void {
    this.running.set(true);
    this.diff.set(null);
    this.suggestions.set([]);
    const body = {
      baselineTicks: this.baselineTicks,
      ticks: this.scenarioTicks,
      perturbations: [this.selectedPert],
      seed: 42,
      entities: this.entities,
    };

    this.http.post<ScenarioDiff>(`${SCENARIO_API}/scenarios`, body).subscribe({
      next: (d) => {
        this.diff.set(d);
        this.suggestFrom(d);
      },
      error: () => this.running.set(false),
      complete: () => this.running.set(false),
    });
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
      .subscribe({ next: (acts) => this.suggestions.set(acts), error: () => {} });
  }
}