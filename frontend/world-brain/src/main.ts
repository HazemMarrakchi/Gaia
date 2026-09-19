import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter, withHashLocation } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';

import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';

bootstrapApplication(AppComponent, {
  providers: [
    // Hash-based routing (#/live) — required for GitHub Pages which has no SPA fallback
    provideRouter(routes, withHashLocation()),
    provideHttpClient(),
  ],
}).catch((err) => console.error(err));