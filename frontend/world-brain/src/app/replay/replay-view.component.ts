import { Component } from '@angular/core';

@Component({
  selector: 'gb-replay-view',
  standalone: true,
  template: `<section>
    <h2>Replay</h2>
    <input type="range" min="0" max="100" value="0" aria-label="Timeline" />
    <small>Deterministic replay of a run (same seed ⇒ same events).</small>
  </section>`,
})
export class ReplayViewComponent {}