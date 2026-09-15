import { Component } from '@angular/core';

@Component({
  selector: 'gb-scenario-runner',
  standalone: true,
  template: `<section>
    <h2>Scenario Runner</h2>
    <form>
      <label>Baseline ticks <input type="number" value="240" /></label>
      <label>Perturbation
        <select><option>HEATWAVE_EU_JULY</option><option>CLOSE_PLANT_X</option><option>INJECT_LIQUIDITY</option></select>
      </label>
      <button type="button" (click)="suggest()">Suggest</button>
    </form>
    <p>Suggested interventions appear here via the AI service.</p>
  </section>`,
})
export class ScenarioRunnerComponent {
  suggest(): void {
    /* wiring to scenario-service + ai-service lands here */
  }
}