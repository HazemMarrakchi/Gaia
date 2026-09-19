import { Injectable, signal } from '@angular/core';
import { DemoEngine, DemoEvent, DemoSnapshot, PerturbationKind } from './gaia-demo.engine';

/**
 * A self-contained Gaia running in the browser. Steps the deterministic
 * miniature engine on a timer (10 ticks/s), keeps a rolling event window
 * plus the latest domain snapshot, and lets the operator inject crises.
 * Provided per DemoComponent — the globe just renders this world.
 */
@Injectable()
export class DemoWorld {
  readonly engine = new DemoEngine(42);

  running = signal(true);
  paused = signal(false);
  tick = signal(0);
  shock = signal(0);
  events = signal<readonly DemoEvent[]>([]);
  latestSnapshot = signal<DemoSnapshot | null>(null);

  private buffer: DemoEvent[] = [];
  private timer = 0;
  private listeners = new Set<() => void>();

  /** Subscribe to world updates (the globe refreshes its hot-spots). */
  onUpdate(callback: () => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  start(): void {
    if (this.timer) return;
    // warm up: run 400 ticks so the opening frame already tells a story
    this.runBatch(400);
    this.timer = window.setInterval(() => {
      if (this.running() && !this.paused()) this.runBatch(2);
    }, 200);
  }

  stop(): void {
    window.clearInterval(this.timer);
    this.timer = 0;
    this.listeners.clear();
  }

  inject(kind: PerturbationKind): void {
    this.engine.applyPerturbation(kind);
    if (!this.running()) {
      this.running.set(true);
    }
  }

  /** Deterministic replay of a window (powers the timeline scrubber). */
  replayWindow(fromTick: number, toTick: number): { events: DemoEvent[]; snapshots: Map<number, DemoSnapshot> } {
    return this.engine.replay(42, fromTick, toTick);
  }

  private runBatch(n: number): void {
    for (let i = 0; i < n; i++) this.buffer.push(...this.engine.step());
    if (this.buffer.length > 600) this.buffer.splice(0, this.buffer.length - 600);
    this.events.set([...this.buffer]);
    this.latestSnapshot.set(this.engine.snapshot());
    this.tick.set(this.engine.tickIndex());
    this.shock.set(this.engine.shockLevel());
    this.listeners.forEach((cb) => cb());
  }
}