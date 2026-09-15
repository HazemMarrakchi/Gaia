# GAIA — The Living Planet Simulation

**GAIA** is a real-time, distributed simulation platform that models the world as a system of
interacting domains — **energy/climate, cities, transport and finance** — and lets operators ask
**"what-if?"** questions, then watch the consequences ripple across the globe in 3D.

This is not a dashboard that *shows* data. It is a **simulation engine that runs the world**:
1M+ entities are simulated each tick, events stream through Kafka, streaming compute aggregates
continuously, and an AI service (Python/FastAPI + ML) forecasts, detects anomalies and drives the
scenario engine.

---

## Architecture at a glance

```
                        ┌──────────────────────────────────────────────┐
                        │               GAIA Platform                   │
                        └──────────────────────────────────────────────┘

  ┌──────────────┐      ┌────────────────────┐     ┌──────────────────┐
  │  simulator-  │─────▶│    ingestion-      │────▶│      Kafka       │◀────────────────────┐
  │  core (Java) │tick  │    service (Boot)  │     │  gaia.sim.* topics│                     │
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
                                          │ FastAPI/ML │                   │legend (tenant)│
                                          └─────────────┘                                      │
                                                 ▲                                           │
                        ┌────────────────────────┴────────────────────────┐                  │
                        ▼                                                 ▼                  │
                  ┌──────────────┐                                ┌──────────────┐           │
                  │ World Brain  │                                │ Public Portal│           │
                  │ (Angular 19) │                                │ (Vue 3/Nuxt) │           │
                  └──────────────┘                                └──────────────┘           │
```

**Services:**
- `engine/simulator-core` — Java 21 discrete-event simulation engine (5 domains, 1M+ entities).
- `engine/ingestion-service` — Spring Boot; publishes each simulated event to Kafka.
- `engine/scenario-service` — Spring Boot; runs "what-if" scenarios by cloning simulation state.
- `streaming` — Flink job; continuous sliding-window aggregations and cross-domain correlations.
- `ai-service` — Python FastAPI; forecasting (LSTM/lightweight), anomaly detection, scenario driver.
- `frontend/world-brain` — Angular 19 "mission control" (3D globe, replay, scenario UI).
- `frontend/portal` — Vue 3 + Nuxt public explorer and alert subscriptions.

**Infra:** Kafka (KRaft), PostgreSQL/PostGIS, MongoDB, Redis, Prometheus + Grafana (docker-compose).

---

## Quick start

Prerequisites: Docker, JDK 21, Maven, Node 20+, Python 3.11+.

```bash
# 1. infra (Kafka, PostGIS, Mongo, Redis, Prometheus, Grafana)
cp .env.example .env
docker compose up -d

# 2. AI service (port 8090)
cd ai-service
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8090

# 3. build & run the Java engine (simulator-core → ingestion → scenario)
cd engine
mvn -q -DskipTests package
java -jar simulator-core/target/simulator-core.jar

# 4. frontends
cd frontend/world-brain && npm i && npm start     # port 4200
cd frontend/portal        && npm i && npm run dev  # port 3000
```

---

## The multi-domain simulation model

Each domain is a module of the core engine with its own entities, state transitions and
couplings to the other domains. Cross-domain couplings are what make GAIA a *system*, not a stack
of independent models:

| Domain           | Entities                                           | Emits                                             | Affected by                                    |
|------------------|----------------------------------------------------|---------------------------------------------------|------------------------------------------------|
| Energy/Climate   | power plants, grid nodes, batteries, weather cells | electricity price, load, outages                    | heatwave (climate) → demand spike, transport     |
| Cities           | districts, buildings, hospitals, water            | demand curves, congestion, strain                   | energy price → budgets, heat → health           |
| Transport        | road/rail networks, vehicles, shipments           | flow rates, delays, emissions                       | energy price → costs, weather → disruption      |
| Finance          | market, banks, risk desks, cash flows             | price shock, liquidity strain, exposure             | any crisis → contagion, VaR/risk alerts         |

A **crisis** starts in one domain (e.g. a heatwave) and propagates:
heat → energy demand ↑ → price spike → transport costs ↑ → market stress → risk alert →
scenario engine proposes an intervention → operator runs a "what-if" → replay in World Brain.

---

## Documentation

- `docs/ARCHITECTURE.md` — system design, deployment, observability.
- `docs/SIMULATION_MODEL.md` — full domain model, entities, event schemas, coupling rules.

## License

MIT (see `LICENSE`).