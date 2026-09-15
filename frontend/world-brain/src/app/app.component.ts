import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { GlobePanelComponent } from './core/globe/globe-panel.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, GlobePanelComponent],
  template: `
    <main class="shell">
      <header class="topbar">
        <h1>GAIA — World Brain</h1>
        <span class="tick" [textContent]="latestTick"></span>
      </header>
      <gb-globe-panel (tick)="latestTick = $event"></gb-globe-panel>
      <router-outlet></router-outlet>
    </main>
  `,
})
export class AppComponent {
  latestTick = 0;
}