# GAIA — Simulation Model

## Core concepts

A GAIA simulation is a sequence of **ticks**. Each tick has a timestamp and a deterministic
seed-derived random sequence. All state lives in `SimulationState` — a registry of domain
`SimModule` instances, each exposing `tick(ctx)`, `state()`, `applyPerturbation(...)`
and `copy()`.

Reproducibility contract: same (config, seed, interventions) ⇒ identical sequence of events.
This is what powers replay (`same seed ⇒ same events`) and "what-if"
(`deepCopy()` state → perturb → run N ticks → diff per domain).

## World construction

`WorldFactory` builds a configurable world (`WorldConfig(districts, plants, gridNodes,
vehicles, banks)`). `WorldConfig.entities(n)` distributes a budget so the total entity
count ≈ `n` (vehicles ≈ 90 %, the four other entity types ≈ 2.5 % each). Entity generation is
deterministic (indexed by seed), spread over 8 named regions:

- `WorldFactory.defaultWorld(...)` — small hand-picked world for tests.
- `WorldFactory.entitiesWorld(n)` — scale world; the ingestion-service default is
  `n = 1_000_000` (`SIM_MAX_ENTITIES`), measured at ~130 ticks/s.

## Domains

### 1. energy (Energy & Climate)
Entities: `EnergyModule.Plant` (type: solar/wind/thermal/backup, capacity, status),
`EnergyModule.GridNode` (region, base load, current load, price).
Emission: `PLANT_OUTAGE`, `GRID_STRESS`.
Couplings: heatwave perturbation raises demand → possible outages; grid demand feeds cities.
Aggregate price/load derived from grid totals.

### 2. cities
Entities: `CitiesModule.District` (strain, water level, heatwave flag).
Emission: `CITY_STRAIN`, `WATER_SHORTAGE`, `HOSPITAL_LOAD`.
Couplings: strain rises with district count load; heatwave/outage perturbations drive
water level down and strain up.

### 3. transport
Entities: `TransportModule.Vehicle` (type: cargo/truck/train, base delay, current delay,
emissions).
Emission: `SHIPMENT_DELAY`, `EMISSIONS_SPIKE`, `FLOW_CHANGED`.
Couplings: delay/fuel perturbations raise delays, cut flow (1 - normalized delay).

### 4. finance
Entities: `FinanceModule.Bank` (index exposure, capital, volatility contribution).
Emission: `PRICE_SHOCK`, `LIQUIDITY_STRESS`, `VAR_BREACH`.
Cross-domain coupling: `SimulationEngine.step()` computes an EMA of the maximum event
severity across all domains and exposes it as `TickContext.externalShock()`;
`FinanceModule` applies `shock = max(lastShock, min(0.5, externalShock))` so a real crisis
anywhere in the system (heatwave, outage, delay) mechanically propagates into the market —
no hard-coded finance shock.

## Event schema (Kafka `gaia.sim.events`)

```json
{
  "id": "uuid",
  "tick": 10420,
  "ts": "2026-09-15T10:00:00Z",
  "domain": "energy",
  "type": "LOAD_SPIKE",
  "region": "global",
  "severity": 0.62,
  "payload": {}
}
```

Topic layout: `gaia.sim.events` (all events), `gaia.sim.aggregates` (per-domain
sliding-window stats from Flink).

## Persistence (PostGIS)

The Flink job writes the same windows to PostGIS so they can be queried with SQL/geo
predicates (schema in `infra/postgres/init/01-gaia.sql`):

- `gaia_domain_aggregates (domain, window_start, window_end, event_count, max_severity, avg_severity)`
- `gaia_region_aggregates (region, window_start, window_end, event_count, max_severity, avg_severity)`
- `gaia_regions (region, label, bbox geometry(Polygon,4326))` — the 8 generated regions;
  `gaia_region_geometry` / `gaia_region_severity` expose centroid, area (km²) and the join
  between regions and their severity windows.
- `gaia_scenarios (id, seed, entities, ticks, perturbations text[], diffs jsonb)` — one row
  per what-if run from the scenario-service.

## Scenario (what-if)

`POST /scenarios {"baselineTicks": 240, "ticks": 120, "perturbations": ["heatwave"], "seed": 42, "entities": 1000000}`

1. Build a fresh world of the requested size + seed, run `baselineTicks` → snapshot A.
2. `deepCopy()` the resulting state, apply the perturbation (via `applyPerturbation`) → run `ticks`.
3. Snapshot B; compute per-domain deltas (energy: outages, heatwave; cities: water level,
   strain; transport: fuel, delay; finance: index, volatility, capital).
4. Cache the diff in Redis (`gaia:scenario:{id}`); the World Brain shows the delta table and
   asks the AI service for interventions.

Supported perturbations: `heatwave`, `outage`, `strain`, `delay`, `crash`, `liquidity`.

Interventions the AI service can propose (`ai-service` rule base + anomaly detection):
`RAISE_BATTERY_DISCHARGE`, `CLOSE_PLANT_X`, `REDUCE_SHIFT_FREQUENCY`,
`INJECT_LIQUIDITY`, `DIVERT_SHIPMENT_ROUTE`, `REVIEW_ALERT`.

## Domain module contract (Java)

```java
public interface SimModule {
    String name();
    void tick(TickContext ctx);
    Map<String, Object> state();
    void applyPerturbation(String key, Map<String, Object> params);
    SimModule copy();                       // deep clone for what-if / replay
    List<SimEvent> drainEvents();
}
```

The engine iterates modules in a fixed dependency order (energy → cities → transport →
finance) so one domain's emissions are visible to downstream domains within the same tick;
`SimulationState.deepCopy()` clones every module so scenario runs never affect the live world.