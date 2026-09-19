import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./demo/demo-console.component').then(m => m.DemoConsoleComponent) },
  { path: 'scenarios', loadComponent: () => import('./scenarios/scenario-runner.component').then(m => m.ScenarioRunnerComponent) },
  { path: 'replay', loadComponent: () => import('./replay/replay-view.component').then(m => m.ReplayViewComponent) },
  { path: '**', redirectTo: '' },
];