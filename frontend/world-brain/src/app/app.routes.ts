import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', redirectTo: 'live', pathMatch: 'full' },
  { path: 'live', loadComponent: () => import('./demo/demo-console.component').then(m => m.DemoConsoleComponent) },
  { path: 'globe', loadComponent: () => import('./core/globe/globe-panel.component').then(m => m.GlobePanelComponent) },
  { path: 'scenarios', loadComponent: () => import('./scenarios/scenario-runner.component').then(m => m.ScenarioRunnerComponent) },
  { path: 'replay', loadComponent: () => import('./replay/replay-view.component').then(m => m.ReplayViewComponent) },
  { path: '**', redirectTo: '' },
];