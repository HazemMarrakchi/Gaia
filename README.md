# GAIA — The Living Planet Simulation

**GAIA** is a real-time, distributed simulation platform that models the world as a system of
interacting domains — **energy/climate, cities, transport and finance** — and lets operators ask
**"what-if?"** questions, then watch the consequences ripple across the world in 3D.

This is not a dashboard that *shows* data. It is a **simulation engine that runs the world**:
1M+ entities (configurable via `SIM_MAX_ENTITIES`) are simulated each tick, events stream through
Kafka, Flink aggregates continuously into PostGIS, and an AI service forecasts, detects anomalies
and suggests interventions — which operators can validate in the scenario engine.

Everything below is **what runs today**, verified end-to-end (build, tests, live streams).

---

## Architecture at a glance

```
                        ┌──────────────────────────────────────────────┐
                        │               GAIA Platform                   │
                        └──────────────────────────────────────────────┘

  ┌──────────────┐      ┌────────────────────┐     ┌──────────────────┐
  │  simulator-  │─────▶│    ingestion-      │────▶│      Kafka       │◀────────────────────┐
  │  core (Java) │tick  │    service (Boot)  │     │ gaia.sim.* topics│                     │
  │  1M+ entities│      └────────────────────┘     └────────┬─────────┘                     │
  └──────────────┘                                         streaming (Flink)               │
                                           ┌────────────────┼─────────────────┐              │
                                           ▼                ▼                 ▼              │
                                    ┌────────────┐   ┌────────────┐   ┌──────────────┐       │
                                    │ aggregates │   │   alerts   │   │  scenario-   │       │
                                    │ (PostGIS)  │   │  (Redis)   │   │  service     │       │
                                    └────────────┘   └────────────┘   └──────┬───────┘       │
                                           ┌─────────────┐                  │               │
                                           │ ai-service  │◀─────────────────┘ (what-if)     │
                                           │ FastAPI/ML │                   │               │
                                           └─────────────┘                                  │
                  ┌────────────────────────────┴──────────────────────────┐                  │
                  ▼                                                       ▼                  │
            ┌──────────────┐                                      ┌──────────────┐           │
            │ World Brain  │                                      │ Public Portal│           │
            │ (Angular 19) │                                      │ (Vue 3/Nuxt) │           │
            └──────────────┘                                      └──────────────┘           │
```

**Services:**
- `engine/simulator-core` — Java 21 discrete-event simulation engine (4 domains, 1M+ entities/tick).
- `engine/ingestion-service` — Spring Boot; publishes each simulated event to Kafka, exposes live events + deterministic replay.
- `engine/scenario-service` — Spring Boot; runs "what-if" scenarios by deep-cloning simulation state and diffing domain metrics.
- `streaming` — Flink job; continuous sliding-window aggregations written to PostGIS.
- `ai-service` — Python FastAPI; trend+seasonality forecast, rolling anomaly detection, rule-based intervention suggestions.
- `frontend/world-brain` — Angular 19 "mission control" (3D globe, replay, scenario UI).
- `frontend/portal` — Vue 3 + Nuxt public event explorer.

**Infra:** Kafka (KRaft), PostgreSQL/PostGIS, MongoDB, Redis, Prometheus + Grafana (docker-compose),
Flink (docker).

---

## Quick start

Prerequisites: Docker, JDK 21, Maven, Node 20+, Python 3.11+.

```bash
# 1. infra (Kafka, PostGIS, Mongo, Redis, Prometheus, Grafana, Flink)
docker compose up -d

# 2. AI service (port 8091)
cd ai-service
pip install -r requirements.txt
uvicorn app.main:app --port 8091

# 3. build & run the Java engine
cd engine
mvn -q -DskipTests install
# ingestion publishes events to Kafka every second (port 8181, default 1M entities)
java -jar ingestion-service/target/ingestion-service-0.1.0-SNAPSHOT.jar --server.port=8181
# scenario engine for what-if (port 8282)
java -jar scenario-service/target/scenario-service-0.1.0-SNAPSHOT.jar --server.port=8282

# 4. production frontends (from the built bundles)
cd frontend/world-brain && npm i && npm run build && npm start      # 3D control room
cd frontend/portal        && npm i && npm run dev                   # public portal
```

Entity scale is set per service with the `SIM_MAX_ENTITIES` env var (default `1000000`);
measured throughput is ~130 ticks/s on the default 1M-entity world.

---

## The multi-domain simulation model

Each domain is a module of the core engine with its own entities, state transitions and
couplings to the other domains. Cross-domain couplings are what make GAIA a *system*, not a stack
of independent models:

| Domain           | Entities                                           | Emits                                             | Couplings (both ways)                         |
|------------------|----------------------------------------------------|---------------------------------------------------|------------------------------------------------|
| Energy/Climate   | power plants, grid nodes, weather cells             | price, load, grid stress, outages                 | heatwave → demand spike ↔ transport/finance     |
| Cities           | districts, water reserves, strain                  | demand curves, strain, water level                | energy price → budgets ↔ heat wave              |
| Transport        | vehicles, shipments                                | flow rates, delays, emissions                     | energy price → costs ↔ weather disruption       |
| Finance          | banks, capital, index, volatility                  | liquidity strain, VaR breach, capital stress      | any real crisis → contagion via `externalShock` |

A **crisis** starts in one domain (e.g. a heatwave) and propagates mechanically:
heat → energy demand ↑ → price spike → transport costs ↑ → market stress → risk alert →
scenario engine proposes an intervention (AI) → operator runs a "what-if" on a deep clone →
diffs per domain → replay in World Brain.

The finance module reacts to the **live severity** of events in the other domains (EMA shock),
so shocks propagated across the system are real and visible in scenarios — not hard-coded.

---

## Verified streams & endpoints

| What                          | Where                                        | Proof today                |
|-------------------------------|----------------------------------------------|----------------------------|
| Sim events (1M entities, ~1/s) | `http://localhost:8181/events?limit=`        | live                      |
| Health/tick                   | `http://localhost:8181/health/sim`           | `tick=N published=M`      |
| Deterministic replay          | `http://localhost:8181/replay?fromTick&toTick` | same seed ⇒ same events  |
| What-if scenario              | `POST http://localhost:8282/scenarios`       | per-domain deltas          |
| AI suggestions                | `POST http://localhost:8091/scenario/suggest` | rule + anomaly based      |
| Flink UI / Job status         | `http://localhost:8381`                      | job RUNNING               |
| Prometheus                    | `http://localhost:9090`                      | ingestion + AI metrics     |
| Grafana (GAIA-Live dashboard) | `http://localhost:3001/d/gaia-live/gaia-live-platform` | datasource wired |

## Documentation

- `docs/ARCHITECTURE.md` — system design, deployment, observability.
- `docs/SIMULATION_MODEL.md` — full domain model, entities, event schemas, coupling rules.

## License

MIT (see `LICENSE`).