import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { ReplayViewComponent } from './replay-view.component';

describe('ReplayViewComponent', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ReplayViewComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('replays the default 200-tick window on init', () => {
    const fixture = TestBed.createComponent(ReplayViewComponent);
    fixture.detectChanges();

    const req = http.expectOne((r) => r.urlWithParams.includes('/replay'));
    expect(req.request.method).toBe('GET');
    expect(req.request.urlWithParams).toContain('http://localhost:8181/replay');
    expect(req.request.urlWithParams).toContain('fromTick=0');
    expect(req.request.urlWithParams).toContain('toTick=200');

    req.flush([
      { tick: 12, domain: 'energy', type: 'GRID_STRESS', severity: 0.71, region: 'eu-west' },
    ]);

    expect(fixture.componentInstance.events().length).toBe(1);
    expect(fixture.componentInstance.loading()).toBeFalse();
  });

  it('clamps the replay window to 10 000 ticks', () => {
    const fixture = TestBed.createComponent(ReplayViewComponent);
    fixture.detectChanges();
    http.expectOne((r) => r.urlWithParams.includes('/replay')).flush([]);

    fixture.componentInstance.win = 9_990;
    fixture.componentInstance.load();

    const req = http.expectOne((r) => r.urlWithParams.includes('/replay'));
    expect(req.request.urlWithParams).toContain('fromTick=9990');
    expect(req.request.urlWithParams).toContain('toTick=10000');
    req.flush([]);
  });
});