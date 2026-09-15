#!/usr/bin/env sh
# ------------------------------------------------------------------
# GAIA smoke test — verifies the endpoints documented in README.md
# ("Verified streams & endpoints"). Requires the platform to be up:
#   docker compose up -d && engine + ai-service + frontends
# Usage: sh scripts/smoke.sh
# ------------------------------------------------------------------
set -eu

INGESTION=${INGESTION_URL:-http://localhost:8181}
SCENARIO=${SCENARIO_URL:-http://localhost:8282}
AI=${AI_URL:-http://localhost:8091}
FLINK=${FLINK_URL:-http://localhost:8381}
PROMETHEUS=${PROMETHEUS_URL:-http://localhost:9090}
GRAFANA=${GRAFANA_URL:-http://localhost:3001}
WORLD_BRAIN=${WORLD_BRAIN_URL:-http://localhost:4302}

failures=0

get() { # <label> <url>
  if curl -fsS --max-time 15 "$2" >/dev/null 2>&1; then
    printf '  ok    %s\n        %s\n' "$1" "$2"
  else
    printf '  FAIL  %s\n        %s\n' "$1" "$2"
    failures=$((failures + 1))
  fi
}

post() { # <label> <url> <json>
  if curl -fsS --max-time 30 -X POST -H 'Content-Type: application/json' -d "$3" "$2" >/dev/null 2>&1; then
    printf '  ok    %s\n        %s\n' "$1" "$2"
  else
    printf '  FAIL  %s\n        %s\n' "$1" "$2"
    failures=$((failures + 1))
  fi
}

echo "GAIA smoke test"

echo '- simulation engine (ingestion-service)'
get "health / tick counter" "$INGESTION/health/sim"
get "live events"           "$INGESTION/events?limit=5"
get "deterministic replay"  "$INGESTION/replay?fromTick=0&toTick=20"

echo '- what-if scenario engine'
post "run scenario (heatwave)" "$SCENARIO/scenarios" \
  '{"baselineTicks":20,"ticks":10,"perturbations":["heatwave"],"seed":42,"entities":2000}'

echo '- AI service'
get  "health"      "$AI/health"
post "forecast"    "$AI/forecast" '{"series":[1,2,3,4,5,6,7,8],"steps":4}'
post "anomaly"     "$AI/anomaly"  '{"metrics":[10,10,10,10,10,120,10,10],"window":5,"threshold":3}'
post "suggestions" "$AI/scenario/suggest" '{"domain_stress":{"energy":0.9},"recent_metrics":[1,2,3]}'

echo '- streaming (Flink) + observability'
get "Flink job overview" "$FLINK/jobs/overview"
get "Prometheus"         "$PROMETHEUS/-/healthy"
get "Grafana"            "$GRAFANA/api/health"

echo '- world brain (Angular control room)'
get "world brain" "$WORLD_BRAIN/"
get "replay UI"   "$WORLD_BRAIN/replay"
get "scenario UI" "$WORLD_BRAIN/scenarios"

if [ "$failures" -eq 0 ]; then
  echo "ALL CHECKS PASSED"
else
  echo "$failures CHECK(S) FAILED"
  exit 1
fi