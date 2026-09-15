import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <main class="shell">
      <header class="topbar">
        <h1>GAIA — World Brain</h1>
        <nav class="nav">
          <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">Live Globe</a>
          <a routerLink="/scenarios" routerLinkActive="active">Scenarios</a>
          <a routerLink="/replay" routerLinkActive="active">Replay</a>
        </nav>
      </header>
      <router-outlet></router-outlet>
    </main>
  `,
  styles: [`
    .nav { display: flex; gap: 1rem; margin-left: auto; }
    .nav a { color: #94a3b8; text-decoration: none; font-size: 0.9rem; }
    .nav a.active, .nav a:hover { color: var(--accent); }
  `],
})
export class AppComponent {}