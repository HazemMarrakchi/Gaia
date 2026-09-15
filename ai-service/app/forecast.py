from fastapi import APIRouter
from pydantic import BaseModel
from sklearn.linear_model import LinearRegression

import numpy as np

router = APIRouter()


class ForecastRequest(BaseModel):
    series: list[float]
    steps: int = 12


class ForecastPoint(BaseModel):
    step: int
    value: float


@router.post("", response_model=list[ForecastPoint])
async def forecast(req: ForecastRequest) -> list[ForecastPoint]:
    """Lightweight trend+seasonality forecast over a univariate series.

    Scaffold uses a linear model over t and sin/cos seasonal features; the
    production path swaps in a small LSTM served from the same endpoint.
    """
    y = np.asarray(req.series, dtype=float)
    t = np.arange(len(y))
    features = _features(t, period=24)

    model = LinearRegression()
    model.fit(features, y)

    future_t = np.arange(len(y), len(y) + req.steps)
    future = model.predict(_features(future_t, period=24))

    return [ForecastPoint(step=i + 1, value=float(v)) for i, v in enumerate(future)]


def _features(t: np.ndarray, period: int) -> np.ndarray:
    return np.column_stack([
        t,
        np.sin(2 * np.pi * t / period),
        np.cos(2 * np.pi * t / period),
    ])