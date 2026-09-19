import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { DemoConsoleComponent } from './demo-console.component';
import { DemoEngine } from './gaia-demo.engine';

describe('DemoConsoleComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DemoConsoleComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  it('creates the demo console with a live world', () => {
    const fixture = TestBed.createComponent(DemoConsoleComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    expect(component).toBeTruthy();
    expect(component.world).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('OPERATOR CONSOLE');
  });

  it('injects a crisis and escalates the systemic shock', () => {
    const fixture = TestBed.createComponent(DemoConsoleComponent);
    fixture.detectChanges();
    const world = fixture.componentInstance.world;
    const before = world.shock();
    world.inject('heatwave-global');
    world.inject('heatwave-global');
    expect(world.shock()).toBeGreaterThanOrEqual(before);
    expect(fixture.componentInstance.feed().length).toBeGreaterThan(0);
  });
});

describe('DemoEngine (determinism)', () => {
  it('same seed produces the same stream and snapshots', () => {
    const a = new DemoEngine(7);
    const b = new DemoEngine(7);
    const evtsA = a.replay(7, 0, 60).events.map((e) => `${e.tick}|${e.domain}|${e.type}|${e.region}`);
    const evtsB = b.replay(7, 0, 60).events.map((e) => `${e.tick}|${e.domain}|${e.type}|${e.region}`);
    expect(evtsA.length).toBeGreaterThan(0);
    expect(evtsA).toEqual(evtsB);
  });

  it('a heatwave mechanically depresses the market index', () => {
    const engine = new DemoEngine(42);
    let calmIdx = 100;
    for (let i = 0; i < 200; i++) {
      engine.applyPerturbation('none');
      engine.step();
      if (i > 150) calmIdx = engine.snapshot().indexLevel;
    }
    const crisis = new DemoEngine(42);
    let hotIdx = 100;
    for (let i = 0; i < 200; i++) {
      crisis.applyPerturbation('heatwave-global');
      crisis.step();
      if (i > 150) hotIdx = crisis.snapshot().indexLevel;
    }
    expect(hotIdx).toBeLessThan(calmIdx);
  });
});