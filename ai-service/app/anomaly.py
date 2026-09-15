from fastapi import APIRouter
from pydantic import BaseModel

import numpy as np

router = APIRouter()


class AnomalyRequest(BaseModel):
    metrics: list[float]
    window: int = 12
    threshold: float = 2.5  # z-score threshold


class AnomalyResult(BaseModel):
    index: int
    value: float
    zscore: float


@router.post("", response_model=list[AnomalyResult])
async def detect(req: AnomalyRequest) -> list[AnomalyResult]:
    """Rolling z-score anomaly detection over a metric stream.

    Returns the points whose absolute z-score exceeds the threshold. The
    production path layers an Isolation Forest over rolling features.
    """
    metrics = np.asarray(req.metrics, dtype=float)
    out: list[AnomalyResult] = []
    for i in range(req.window, len(metrics)):
        window = metrics[i - req.window:i]
        mean, std = window.mean(), window.std()
        if std == 0:
            z = 0.0 if metrics[i] == mean else req.threshold + 1.0
        else:
            z = (metrics[i] - mean) / std
        if abs(z) > req.threshold:
            out.append(AnomalyResult(index=i, value=float(metrics[i]), zscore=float(z)))
    return out