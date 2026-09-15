import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { ScenarioRunnerComponent } from './scenario-runner.component';

describe('ScenarioRunnerComponent', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ScenarioRunnerComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('runs the what-if on 8282 then asks the AI service for interventions', () => {
    const fixture = TestBed.createComponent(ScenarioRunnerComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;

    component.baselineTicks = 100;
    component.scenarioTicks = 50;
    component.entities = 1_000;
    component.selectedPert = 'heatwave';
    component.runScenario();

    const scenarioReq = http.expectOne((r) => r.url.endsWith('/scenarios'));
    expect(scenarioReq.request.method).toBe('POST');
    expect(scenarioReq.request.url).toBe('http://localhost:8282/scenarios');
    expect(scenarioReq.request.body).toEqual({
      baselineTicks: 100,
      ticks: 50,
      perturbations: ['heatwave'],
      seed: 42,
      entities: 1_000,
    });

    scenarioReq.flush({
      id: '2f8b1c4e-0000-0000-0000-000000000000',
      baselineTick: 100,
      scenarioTicks: 50,
      scenarioEvents: 7,
      perturbations: ['heatwave'],
      diffs: { energy: { heatwaveDelta: 0.4, outageDelta: 12 } },
    });

    const aiReq = http.expectOne((r) => r.url.endsWith('/scenario/suggest'));
    expect(aiReq.request.url).toBe('http://localhost:8091/scenario/suggest');
    expect(aiReq.request.body.domain_stress.energy).toBe(1);
    expect(aiReq.request.body.recent_metrics).toEqual([7, 12]);

    aiReq.flush([
      {
        action: 'RAISE_BATTERY_DISCHARGE',
        domain: 'energy',
        rationale: 'grid stress critical; discharge storage',
      },
    ]);

    expect(component.suggestions().length).toBe(1);
    expect(component.suggestions()[0].action).toBe('RAISE_BATTERY_DISCHARGE');
    expect(component.running()).toBeFalse();

    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('RAISE_BATTERY_DISCHARGE');
  });

  it('normalizes the worst domain delta into a 0..1 stress score', () => {
    const fixture = TestBed.createComponent(ScenarioRunnerComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;

    component.runScenario();
    http.expectOne((r) => r.url.endsWith('/scenarios')).flush({
      id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      baselineTick: 1,
      scenarioTicks: 1,
      scenarioEvents: 2,
      perturbations: ['delay'],
      diffs: { transport: { delayDelta: -3 }, finance: { volatilityDelta: 0.5 } },
    });

    const aiReq = http.expectOne((r) => r.url.endsWith('/scenario/suggest'));
    expect(aiReq.request.body.domain_stress.transport).toBe(0.3);
    expect(aiReq.request.body.domain_stress.finance).toBe(0.05);
    expect(aiReq.request.body.domain_stress.energy).toBe(0);
    aiReq.flush([]);

    expect(component.running()).toBeFalse();
  });
});