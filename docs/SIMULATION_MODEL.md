# GAIA — Simulation Model

## Core concepts

A GAIA simulation is a sequence of **ticks**. Each tick has a timestamp and a deterministic
seed-derived random sequence. All state lives in `SimulationState` — a registry of domain
`Module` instances, each exposing `tick(ctx)` and `state()`.

Reproducibility contract: same (config, seed, interventions) ⇒ identical sequence of events.
This is what powers replay ("replay the last 24 hours") and "what-if" (clone state → perturb →
run N ticks → diff).

## Domains

### 1. energy (Energy & Climate)
Entities:
- `PowerPlant` (type: solar/wind/thermal/backup, capacity, status)
- `GridNode` (region, load, price)
- `Battery` (state of charge)
- `WeatherCell` (temperature, irradiance, wind, anomaly flags)

Emission event: `ENERGY_PRICE_CHANGED`, `LOAD_SPIKE`, `PLANT_OUTAGE`, `GRID_STRESS`.
Couplings: weather anomalies (heatwave) raise plant load; transport demand raises grid load.

### 2. cities
Entities:
- `District` (population, buildings)
- `Building` (class: residential/office/hospital, power draw, water draw)
- `Hospital` (capacity, occupancy) — saturation drives public strain
- `WaterTank` (level, inflow/outflow)

Emission: `CITY_STRAIN`, `HOSPITAL_LOAD`, `WATER_SHORTAGE`.
Couplings: grid stress ↑ → power draw curtailed → hospital strain; heat → hospital admissions ↑.

### 3. transport
Entities:
- `TransportNetwork` (nodes/edges)
- `Vehicle` (type truck/train/ship, cargo, route)
- `Shipment` (owner, origin, destination, deadline)
- `TrafficMetric` (flow, speed, delay, emissions)

Emission: `FLOW_CHANGED`, `SHIPMENT_DELAY`, `EMISSIONS_SPIKE`.
Couplings: energy price ↑ → cost/lag; weather disruption reduces network capacity.

### 4. finance
Entities:
- `Market` (index, volatility)
- `Bank` (capital, exposure)
- `RiskDesk` (VaR, limits)
- `CashFlow` (currency flows between actors)

Emission: `PRICE_SHOCK`, `LIQUIDITY_STRESS`, `VAR_BREACH`.
Couplings: any domain crisis may feed `shock` into `Market`; banks exposed to energy/transport
sector show liquidity stress.

## Event schema (Kafka `gaia.sim.events`)

```json
{
  "id": "uuid",
  "tick": 10420,
  "ts": "2026-09-15T10:00:00Z",
  "domain": "energy",
  "type": "LOAD_SPIKE",
  "region": "eu-west",
  "severity": 0.62,
  "payload": {"gridNode": "node-42", "loadMw": 980}
}
```

Topic layout: `gaia.sim.events` (all), `gaia.sim.aggregates` (flink), `gaia.sim.alerts`
(filtered severity > threshold), partitioned by `domain`.

## Scenario (what-if)

`POST /scenarios {baseId, perturbations: ["HEATWAVE_EU_JULY"], ticks: 240, seed: 7}`
1. Clone current snapshot (PostGIS, per-domain state JSON) → worker pod.
2. Apply perturbation via `Module.applyPerturbation(...)`.
3. Run N ticks; compute diff metrics vs baseline snapshot.
4. Cache diff in Redis; World Brain replays both paths side-by-side.

Interventions the scenario engine can propose (`ai-service` rule base + forecast):
`RAISE_BATTERY_DISCHARGE`, `CLOSE_PLANT_X`, `REDUCE_SHIFT_FREQUENCY`,
`INJECT_LIQUIDITY`, `DIVERT_SHIPMENT_ROUTE`.

## Domain module contract (Java)

```java
public interface SimModule {
    String name();
    void tick(TickContext ctx);
    Map<String, Object> state();
    void applyPerturbation(String key, Map<String, Object> params);
    List<SimEvent> drainEvents();
}
```
The engine iterates modules in a fixed dependency order (energy → cities → transport →
finance) so one domain's emissions are visible to downstream domains within the same tick.