# GAIA — Architecture

## Principles

- **Domain-driven**: each simulated domain is a bounded module in `simulator-core`.
- **Event-driven**: the engine emits domain events that are published to Kafka
  (`gaia.sim.events`); streaming/Flink and the frontends consume them.
- **Deterministic tick**: a simulation tick is a pure function of the previous tick (same
  config + seed = same events) — this is what makes replays and "what-if" cloning possible.
- **Open for simulation, closed for modification** (plugin/spring injection of domain modules).

## Modules

### engine/simulator-core (Java 21, no framework)
- 4 domain modules (energy, cities, transport, finance) with a shared entity budget
  (`WorldConfig.entities(n)`, default **1M+** entities), the `SimulationEngine`,
  `TickContext` (exposes cross-domain `externalShock`), event state machine.
- `SimModule.copy()` / `SimulationState.deepCopy()` for deterministic replay & scenarios.
- CLI (`SimulatorCli`) runs a headless simulation and prints the event summary.
- Builds without Spring → stays portable, fast to test.

### engine/ingestion-service (Spring Boot)
- Runs the engine loop (`@Scheduled`, default 1 s/tick, 1M entities) and publishes every
  event to `gaia.sim.events`.
- `GET /health/sim` — live tick counter + event count; `GET /events?limit=` — recent events.
- `GET /replay?fromTick=&toTick=` — **deterministic replay**: rebuilds a same-seed world and
  returns the exact events of the requested window without touching Kafka.
- Exposes health + Prometheus metrics (Micrometer).

### engine/scenario-service (Spring Boot)
- `POST /scenarios` — builds a same-seed world, runs a baseline, **deep-copies the state**,
  applies the requested perturbation(s), runs the scenario, returns per-domain deltas
  (what-if impact). Result cached in Redis (`gaia:scenario:{id}`). Port 8282.
- CORS-open for the World Brain (4302) and the portal.

### streaming (Flink)
- Consumes `gaia.sim.events`; sliding windows (env `GAIA_WINDOW_MS`/`GAIA_SLIDE_MS`,
  defaults 5 min / 1 min) compute per-domain aggregates (count, max & avg severity).
- Pushes aggregates back to Kafka (`gaia.sim.aggregates`) for Grafana.
- Runs in Docker (`flink:1.20-java17`), UI at `http://localhost:8381`.

### ai-service (Python FastAPI)
- `POST /forecast` — lightweight trend + seasonality forecast (linear model over features:
  t, sin/cos period 24), with tests.
- `POST /anomaly` — rolling z-score style anomaly detection.
- `POST /scenario/suggest` — suggests interventions from a rule base keyed on domain stress,
  falling back to the anomaly detector.
- Prometheus metrics (`/metrics`); documented via Swagger.

### frontend/world-brain (Angular 19, port 4302)
- 3D globe (Three.js) polling live events from ingestion, tick counter in the header.
- `/scenarios` — scenario runner UI: parameter form → POST 8282 → delta table →
  AI suggestions from 8091.
- `/replay` — deterministic replay timeline: slider → `GET /replay` → event log.

### frontend/portal (Vue 3 + Nuxt, port 3000)
- Public explorer listing live simulated events from ingestion (`/events`).

## Data

- **PostgreSQL/PostGIS**: geo entities, aggregates, scenario diffs (via docker-compose).
- **Kafka (KRaft)**: event bus — `gaia.sim.*` topics (dual listeners: container `kafka:9092`,
  host `localhost:9093`).
- **Redis**: live scenario cache, alerts, rate limits.
- **Prometheus + Grafana**: observability; GAIA-Live dashboard pre-provisioned.

## Deployment

- `docker-compose.yml` — Kafka, PostGIS, Mongo, Redis, Prometheus, Grafana, Flink.
- `infra/k8s/helm` + `infra/k8s/manifests` — Kubernetes packaging (demonstrates deployment
  readiness; not used for the local demo).
- `infra/terraform` — Azure AKS provisioning (demonstrates IaC).
- `.gitlab-ci.yml` — CI pipeline: build → test → image → deploy.

## Observability

- Prometheus exports from JVM services (Micrometer) + ai-service (prometheus-client).
- Grafana dashboards: GAIA-Live (tick throughput, event volume, severity by domain),
  Flink job status.
- Deterministic seed per run for reproducible replays; scenario runs are traceable by id.