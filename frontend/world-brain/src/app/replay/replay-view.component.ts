import { Component, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';

interface ReplayEvent {
  tick: number;
  domain: string;
  type: string;
  severity: number;
  region: string;
}

const INGESTION_API = 'http://localhost:8181';

@Component({
  selector: 'gb-replay-view',
  standalone: true,
  imports: [FormsModule],
  template: `<section>
    <h2>Replay</h2>
    <p class="muted">Deterministic replay: same seed ⇒ same events, fetched fresh from ingestion.</p>
    <label>Replay {{ windowLabel }}
      <input type="range" [(ngModel)]="win" (ngModelChange)="load()" min="0" max="2000" step="50" />
    </label>
    <label>Window length {{ span }} ticks
      <input type="range" [(ngModel)]="span" (ngModelChange)="load()" min="50" max="500" step="50" />
    </label>
    @if (loading()) {
      <p class="muted">Replaying…</p>
    }
    @if (events()) {
      <ul class="log">
        @for (e of events().slice(-60); track $index) {
          <li [class]="'d-' + e.domain">
            <span class="t">{{ e.tick }}</span>
            <span class="dom">{{ e.domain }}</span>
            {{ e.type }} sev={{ e.severity.toFixed(2) }} ({{ e.region }})
          </li>
        }
      </ul>
      <p class="muted">{{ events().length }} events in window</p>
    }
  </section>`,
  styles: [`
    input[type=range] { width: 100%; display: block; margin: 6px 0; }
    .log { list-style: none; padding: 0; max-height: 40vh; overflow: auto; font-family: monospace; }
    .log .t { color: #64748b; margin-right: 8px; }
    .log .dom { display: inline-block; min-width: 70px; font-weight: bold; }
    .d-energy { color: #fbbf24; }
    .d-cities { color: #4ade80; }
    .d-transport { color: #38bdf8; }
    .d-finance { color: #f472b6; }
    .muted { color: #64748b; font-size: 0.85em; }
  `],
})
export class ReplayViewComponent {
  private http = inject(HttpClient);

  win = 0;
  span = 200;

  events = signal<ReplayEvent[]>([]);
  loading = signal(false);

  fromTick = 0;
  toTick = 0;

  protected get windowLabel(): string {
    return `${this.win} → ${Math.min(this.win + this.span, 10_000)}`;
  }

  constructor() {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    const to = Math.min(this.win + this.span, 10_000);
    this.http
      .get<ReplayEvent[]>(`${INGESTION_API}/replay?fromTick=${this.win}&toTick=${to}`)
      .subscribe({
        next: (evts) => this.events.set(evts),
        error: () => this.loading.set(false),
        complete: () => this.loading.set(false),
      });
  }
}