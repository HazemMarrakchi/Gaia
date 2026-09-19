// GAIA Live Demo engine — a self-contained, deterministic miniature of the real
// Java simulation (see engine/simulator-core). Same concepts, small scale:
// 8 regions, 4 coupled domains, an EMA "externalShock" that mechanically
// propagates a crisis from any domain into the market. Zero dependencies,
// zero backend — it runs entirely in the browser.
//
// Scale note: the production engine simulates 1M+ entities per tick and
// streams through Kafka/Flink; this demo aggregates the same dynamics at
// region resolution so a phone can replay Gaia in milliseconds.
export interface DemoEvent {
  id: string;
  tick: number;
  ts: number;
  domain: 'energy' | 'cities' | 'transport' | 'finance';
  type: string;
  region: string;
  severity: number;
}

export interface DemoSnapshot extends Record<string, number> {
  heatwaveIntensity: number;
  outages: number;
  waterLevel: number;
  strain: number;
  delay: number;
  fuelPriceIndex: number;
  indexLevel: number;
  volatility: number;
  capital: number;
}

export type PerturbationKind = 'heatwave-eu' | 'heatwave-global' | 'outage' | 'crash' | 'liquidity' | 'none';

export const DEMO_REGIONS = [
  'eu-west', 'eu-east', 'na-east', 'na-west', 'me', 'asia-n', 'asia-s', 'africa',
] as const;

const DEMO_LATLON: Record<string, { lat: number; lon: number }> = {
  'eu-west': { lat: 50.5, lon: -4.0 },
  'eu-east': { lat: 51.0, lon: 24.0 },
  'na-east': { lat: 42.0, lon: -75.0 },
  'na-west': { lat: 40.0, lon: -120.0 },
  'me': { lat: 24.0, lon: 46.5 },
  'asia-n': { lat: 52.0, lon: 100.0 },
  'asia-s': { lat: 21.0, lon: 78.0 },
  'africa': { lat: 6.0, lon: 20.0 },
};

export function demoLatLon(region: string): { lat: number; lon: number } {
  return DEMO_LATLON[region] ?? { lat: 0, lon: 0 };
}

/** Deterministic RNG (mulberry32) — same seed gives the same demo, every browser. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
/**
 * Miniature Gaia. One tick advances weather, grid, cities, logistics and the
 * market — and folds the worst non-finance severity into an EMA exposed as
 * the cross-domain shock, exactly like SimulationEngine does server-side.
 */
export class DemoEngine {
  private tickCount = 0;
  private shock = 0;
  private heat = new Map<string, number>();
  private outages = 0;
  private water = 0.85;
  private strain = 0.3;
  private delay = 0.15;
  private fuel = 1.0;
  private index = 100.0;
  private volatility = 0.2;
  private capital = 100.0;
  private rng: () => number;
  private eventSeq = 0;
  private baseTs: number;

  constructor(seed = 42) {
    this.rng = mulberry32(seed);
    this.baseTs = Date.now();
    for (const r of DEMO_REGIONS) this.heat.set(r, 0);
  }

  tickIndex(): number {
    return this.tickCount;
  }

  shockLevel(): number {
    return this.shock;
  }

  snapshot(): DemoSnapshot {
    return {
      heatwaveIntensity: +this.maxHeat().toFixed(3),
      outages: this.outages,
      waterLevel: +this.water.toFixed(3),
      strain: +this.strain.toFixed(3),
      delay: +this.delay.toFixed(3),
      fuelPriceIndex: +this.fuel.toFixed(3),
      indexLevel: +this.index.toFixed(2),
      volatility: +this.volatility.toFixed(3),
      capital: +this.capital.toFixed(2),
    };
  }

  applyPerturbation(kind: PerturbationKind): void {
    switch (kind) {
      case 'heatwave-eu':
        this.heat.set('eu-west', 0.9);
        break;
      case 'heatwave-global':
        for (const r of DEMO_REGIONS) this.heat.set(r, 0.9);
        break;
      case 'outage':
        this.outages += 3;
        break;
      case 'crash':
        this.index *= 0.9;
        this.volatility = Math.min(2, this.volatility + 0.25);
        break;
      case 'liquidity':
        this.capital *= 0.8;
        break;
      case 'none':
        break;
    }
  }

  /** Advance one tick and return the events it produced. */
  step(): DemoEvent[] {
    const out: DemoEvent[] = [];
    const emit = (domain: DemoEvent['domain'], type: string, region: string, severity: number): void => {
      this.eventSeq += 1;
      out.push({
        id: `d${this.tickCount}-${this.eventSeq}`,
        tick: this.tickCount,
        ts: this.baseTs + this.tickCount * 50,
        domain,
        type,
        region,
        severity: +clamp01(severity).toFixed(3),
      });
    };

    // 1. weather: regional heat random-walk with slow decay
    for (const r of DEMO_REGIONS) {
      if (this.rng() < 0.06) {
        this.heat.set(r, clamp01((this.heat.get(r) ?? 0) + (this.rng() - 0.35) * 0.35));
      } else {
        this.heat.set(r, (this.heat.get(r) ?? 0) * 0.998);
      }
    }
    const hot = this.maxHeatEntry();
    if (hot.value > 0.45) {
      emit('energy', 'GRID_STRESS', hot.region, hot.value);
    }
    if (this.outages > 0) {
      emit('energy', 'PLANT_OUTAGE', 'global', Math.min(1, 0.3 + this.outages * 0.08));
      if (this.rng() < 0.25) this.outages = Math.max(0, this.outages - 1);
    }

    // 2. cities: strain follows heat, water drains under stress
    const targetStrain = 0.25 + hot.value * 0.7;
    this.strain += (targetStrain - this.strain) * 0.2 + (this.rng() - 0.5) * 0.02;
    this.strain = clamp01(this.strain);
    this.water = clamp01(this.water + 0.004 - hot.value * 0.012);
    if (this.strain > 0.55) emit('cities', 'CITY_STRAIN', hot.region, this.strain);
    if (this.water < 0.25) emit('cities', 'WATER_SHORTAGE', 'global', 1 - this.water);

    // 3. transport: delay follows heat + fuel
    const targetDelay = 0.1 + hot.value * 0.45 + Math.max(0, this.fuel - 1) * 0.4;
    this.delay += (targetDelay - this.delay) * 0.25;
    if (this.delay > 0.42) emit('transport', 'SHIPMENT_DELAY', 'global', this.delay);
    if (this.rng() < 0.35) emit('transport', 'FLOW_CHANGED', 'global', 1 - this.delay * 0.9);

    // 4. cross-domain shock EMA (mirrors SimulationEngine.externalShock)
    const worst = Math.max(hot.value, this.strain, this.delay);
    this.shock += (worst - this.shock) * 0.3;

    // 5. finance reacts to the shock — mechanically, never hard-coded
    this.volatility = Math.max(0.05, Math.min(2, this.volatility * (1 + this.shock * 0.25)));
    this.index *= 1 - this.shock * 0.015 + (this.rng() - 0.5) * 0.002;
    this.capital = Math.max(20, this.capital - this.shock * 1.5);
    if (this.shock > 0.15) emit('finance', 'PRICE_SHOCK', 'global', Math.min(1, this.shock * 1.2));
    if (this.capital < 60) emit('finance', 'LIQUIDITY_STRESS', 'global', 1 - this.capital / 60);

    // 6. coupled reactions: a crisis bleeds back into the physical world
    if (this.shock > 0.35) {
      this.fuel = 1 + this.shock * 0.6;
      if (this.rng() < 0.3) emit('energy', 'BROWNOUT', 'global', this.shock);
    } else {
      this.fuel += (1 - this.fuel) * 0.1;
    }

    this.tickCount += 1;
    return out;
  }
  /** Rebuild a fresh engine fast-forwarded to `toTick`, returning the window. */
  replay(seed: number, fromTick: number, toTick: number): { events: DemoEvent[]; snapshots: Map<number, DemoSnapshot> } {
    const fresh = new DemoEngine(seed);
    const events: DemoEvent[] = [];
    const snapshots = new Map<number, DemoSnapshot>();
    for (let i = 0; i <= toTick && events.length < 5000; i++) {
      const stepEvents = fresh.step();
      snapshots.set(i, fresh.snapshot());
      if (i >= fromTick) events.push(...stepEvents);
    }
    return { events, snapshots };
  }

  private maxHeat(): number {
    return this.maxHeatEntry().value;
  }

  private maxHeatEntry(): { region: string; value: number } {
    let region: string = DEMO_REGIONS[0];
    let value = 0;
    for (const r of DEMO_REGIONS) {
      const v = this.heat.get(r) ?? 0;
      if (v > value) {
        value = v;
        region = r;
      }
    }
    return { region, value };
  }
}