# GAIA — Architecture

## Principles

- **Domain-driven**: each simulated domain is a bounded module in `simulator-core`.
- **Event-driven**: the only way domains interact is via Kafka events (`gaia.sim.events`).
  Nothing calls another domain directly.
- **Deterministic tick**: a simulation tick is a pure function of the previous tick (same seed =
  same replay) — this is what makes replays and "what-if" cloning possible.
- **Open for simulation, closed for modification** (plugin/spring injection of domain modules).

## Modules

### engine/simulator-core (Java 21, no framework)
- Domain entities (5 domains), the `SimulationEngine`, event state machine.
- Deterministic seedable clock for reproducible replays.
- Builds without Spring → stays portable, fast to test.

### engine/ingestion-service (Spring Boot)
- Reads ticks from the engine loop, serializes each entity/event, publishes to
  `gaia.sim.events`, `gaia.sim.aggregates`, `gaia.sim.alerts`.
- Exposes health + metrics (Micrometer/Prometheus) and a `POST /ticks` manual-drive endpoint
  for demos.

### engine/scenario-service (Spring Boot)
- `POST /scenarios` — clones a simulation state (snapshot), applies a perturbation
  (e.g. `HEATWAVE_EU_JULY, CLOSE_PLANT_X`), runs N ticks on a worker, returns a diff vs
  baseline. Result cached in Redis (`gaia:scenario:{id}`).
- Workers auto-scale: each scenario is a bounded task submitted to a queue (Kafka) consumed by
  worker pods on Kubernetes.

### streaming (Flink)
- Consumes `gaia.sim.events`; sliding windows (5 min) compute:
  - per-domain aggregates (mean/max load, price, velocity)
  - cross-domain correlation scores (energy-demand vs price vs delay)
- Sinks to PostGIS (long-term history) and Redis (live windows).

### ai-service (Python FastAPI)
- `POST /forecast` — time-series forecast (lightweight LSTM / polynomial baseline with tests).
- `POST /anomaly` — streaming anomaly detection (z-score + Isolation Forest extension points).
- `POST /scenario/suggest` — suggests interventions from a rule base + forecast.
- Async Kafka consumer to keep live dashboards updated.

### frontend/world-brain (Angular 19)
- 3D globe (Three.js via `ngx-three`/plain), timeline replay slider, layer toggles
  (energy/city/transport/finance), scenario runner panel.
- WebSocket connection for live entity updates.

### frontend/portal (Vue 3 + Nuxt)
- Public exploration of simulation state, alert subscriptions, PWA (notifications).

## Data

- **PostgreSQL/PostGIS**: authoritative state snapshots + geo entities + scenario diffs.
- **MongoDB**: time-series of raw event streams for replay/history.
- **Redis**: live windows from Flink, scenario cache, rate limits.

## Deployment

- `infra/k8s/helm` — umbrella chart; per-service charts with HPA (simulator workers,
  scenario workers).
- `infra/k8s/manifests` — plain YAML for fast local experimentation (kind/k3s).
- `infra/terraform` — Azure resource group + AKS + managed services (demonstrates IaC).
- GitLab CI (`/.gitlab-ci.yml`) — multi-stage pipeline: build → test (Testcontainers) →
  sonar/trivy → images → deploy preview.

## Observability

- Prometheus exports from JVM services (Micrometer) + ai-service (prometheus-client).
- Grafana dashboards: tick throughput, entity count, queue lag, scenario job duration,
  anomaly rate.
- Structured JSON logs (logback) with traceId/messageId for event tracing.