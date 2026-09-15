import { Component, EventEmitter, Output } from '@angular/core';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';

import { AppComponent } from './app.component';
import { GlobePanelComponent } from './core/globe/globe-panel.component';

/**
 * Stand-in for the WebGL globe: shell tests must not need a rendering context.
 */
@Component({
  selector: 'gb-globe-panel',
  standalone: true,
  template: '<div class="globe-stub"></div>',
})
class GlobePanelStubComponent {
  @Output() tick = new EventEmitter<number>();
}

describe('AppComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideRouter([])],
    })
      .overrideComponent(AppComponent, {
        remove: { imports: [GlobePanelComponent] },
        add: { imports: [GlobePanelStubComponent] },
      })
      .compileComponents();
  });

  it('renders the mission control shell', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();

    const title = fixture.nativeElement.querySelector('.topbar h1') as HTMLElement;
    expect(title.textContent).toContain('GAIA');
  });

  it('reflects the live tick reported by the globe panel', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();

    const globe = fixture.debugElement.query(By.directive(GlobePanelStubComponent))
      .componentInstance as GlobePanelStubComponent;
    globe.tick.emit(1042);
    fixture.detectChanges();

    expect(fixture.componentInstance.latestTick).toBe(1042);
    expect((fixture.nativeElement.querySelector('.tick') as HTMLElement).textContent).toContain(
      '1042',
    );
  });
});