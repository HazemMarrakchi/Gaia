import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <main class="shell">
      <header class="topbar">
        <div class="brand">
          <span class="mark" aria-hidden="true"></span>
          <div class="brand-text">
            <h1>GAIA — World Brain</h1>
            <span class="tagline">living planet simulation · mission control</span>
          </div>
        </div>
        <nav class="nav">
          <a routerLink="/live" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">Live Demo</a>
          <a routerLink="/globe" routerLinkActive="active">Live Globe</a>
          <a routerLink="/scenarios" routerLinkActive="active">Scenarios</a>
          <a routerLink="/replay" routerLinkActive="active">Replay</a>
          <a class="ext" href="http://localhost:3001/d/gaia-live" target="_blank" rel="noopener">Grafana ↗</a>
        </nav>
      </header>
      <router-outlet></router-outlet>
      <footer class="footer">
        <span>ingestion :8181</span>
        <span class="sep">·</span>
        <span>scenario :8282</span>
        <span class="sep">·</span>
        <span>ai :8091</span>
        <span class="sep">·</span>
        <span>flink :8381</span>
      </footer>
    </main>
  `,
  styles: [`
    .shell { display: flex; flex-direction: column; min-height: 100vh; }
    .brand { display: flex; align-items: center; gap: .75rem; }
    .mark {
      width: 30px; height: 30px; border-radius: 50%;
      background: radial-gradient(circle at 32% 30%, #37e0a2 0%, #0f766e 42%, #0b1220 100%);
      box-shadow: 0 0 18px rgba(55, 224, 162, .45), inset 0 0 8px rgba(0, 0, 0, .5);
    }
    .brand-text { display: flex; flex-direction: column; }
    .tagline {
      font-size: .68rem; letter-spacing: .16em; text-transform: uppercase;
      color: #64748b;
    }
    .nav { display: flex; align-items: center; gap: .5rem; margin-left: auto; }
    .nav a {
      color: #94a3b8; text-decoration: none; font-size: .82rem;
      padding: .38rem .8rem; border-radius: 999px;
      border: 1px solid transparent; transition: all .18s ease;
    }
    .nav a:hover { color: #e2e8f0; background: rgba(255, 255, 255, .05); }
    .nav a.active {
      color: #052e21; background: var(--accent); font-weight: 600;
      box-shadow: 0 0 16px rgba(55, 224, 162, .3);
    }
    .nav a.ext { color: #7dd3fc; }
    .footer {
      margin-top: auto; padding-top: .9rem; border-top: 1px solid #131f33;
      display: flex; gap: .45rem; align-items: center;
      font-family: ui-monospace, monospace; font-size: .68rem;
      color: #475569; letter-spacing: .06em;
    }
    .footer .sep { color: #1e293b; }
  `],
})
export class AppComponent {}