import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter, withHashLocation } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';

import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';

console.log('[GAIA] Bootstrapping application...');

bootstrapApplication(AppComponent, {
  providers: [
    // Hash-based routing (#/live) — required for GitHub Pages which has no SPA fallback
    provideRouter(routes, withHashLocation()),
    provideHttpClient(),
  ],
})
  .then(() => console.log('[GAIA] Application started successfully'))
  .catch((err) => {
    console.error('[GAIA] Bootstrap failed:', err);
    const el = document.getElementById('boot-status');
    if (el) el.innerHTML = '<div style="color:#f87171">Failed to start: ' + err.message + '</div>';
  });