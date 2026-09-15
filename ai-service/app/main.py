from fastapi import FastAPI
from fastapi.responses import JSONResponse

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


@app.get("/health")
async def health():
    return {"status": "ok", "service": "ai-service"}