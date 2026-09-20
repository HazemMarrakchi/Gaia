import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AppComponent } from './app.component';

describe('AppComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('renders the mission control shell with navigation', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();

    const title = fixture.nativeElement.querySelector('.topbar h1') as HTMLElement;
    expect(title.textContent).toContain('GAIA');

    const links = Array.from(
      fixture.nativeElement.querySelectorAll('.nav a'),
    ).map((a) => (a as HTMLElement).textContent?.trim());
    expect(links).toEqual(['Mission Control', 'Scenarios', 'Replay', 'Docs ↗']);
  });

  it('renders exactly one router outlet (single globe instance)', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('router-outlet').length).toBe(1);
    expect(fixture.nativeElement.querySelectorAll('gb-globe-panel').length).toBe(0);
  });
});