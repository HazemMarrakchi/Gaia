from fastapi import FastAPI
from fastapi.responses import JSONResponse, Response

from prometheus_client import Counter, generate_latest, CONTENT_TYPE_LATEST

from app.forecast import router as forecast_router
from app.anomaly import router as anomaly_router
from app.scenario import router as scenario_router

app = FastAPI(
    title="GAIA AI Service",
    description="Forecasting, anomaly detection and scenario-suggestion engine for GAIA",
    version="0.1.0",
)

app.include_router(forecast_router, prefix="/forecast", tags=["forecast"])
app.include_router(anomaly_router, prefix="/anomaly", tags=["anomaly"])
app.include_router(scenario_router, prefix="/scenario", tags=["scenario"])

REQUESTS = Counter("gaia_ai_requests_total", "AI service requests", ["endpoint"])


@app.get("/health")
async def health():
    return {"status": "ok", "service": "ai-service"}


@app.get("/metrics")
async def metrics():
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.middleware("http")
async def count_requests(request, call_next):
    response = await call_next(request)
    route = request.url.path
    if route != "/metrics":
        REQUESTS.labels(endpoint=route).inc()
    return response