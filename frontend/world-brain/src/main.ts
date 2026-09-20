import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter, withHashLocation } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';

import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';

bootstrapApplication(AppComponent, {
  providers: [
    // Hash-based routing (#/...) — required for GitHub Pages which has no SPA fallback
    provideRouter(routes, withHashLocation()),
    provideHttpClient(),
  ],
});