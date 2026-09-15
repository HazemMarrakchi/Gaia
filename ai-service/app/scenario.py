from fastapi import APIRouter
from pydantic import BaseModel

from app.anomaly import AnomalyRequest, detect

router = APIRouter()


class ScenarioSuggestionRequest(BaseModel):
    domain_stress: dict[str, float]  # e.g. {"energy": 0.72, "cities": 0.31}
    recent_metrics: list[float]      # used to refine severity


class SuggestedAction(BaseModel):
    action: str
    domain: str
    rationale: str


# Rule base: severity bucket → intervention.
_RULES = [
    (0.80, "energy", "RAISE_BATTERY_DISCHARGE", "grid stress critical; discharge storage"),
    (0.65, "energy", "CLOSE_PLANT_X", "thermal plant at risk; isolate to protect grid"),
    (0.55, "cities", "REDUCE_SHIFT_FREQUENCY", "city strain high; trim non-essential load"),
    (0.60, "finance", "INJECT_LIQUIDITY", "liquidity stress; inject capital"),
    (0.50, "transport", "DIVERT_SHIPMENT_ROUTE", "delays rising; reroute shipments"),
]


@router.post("/suggest", response_model=list[SuggestedAction])
async def suggest(req: ScenarioSuggestionRequest) -> list[SuggestedAction]:
    """Suggests interventions from the rule base, refined by the forecast.

    Scaffold emits the rule matches; integrated version adds the forecast
    delta as a confidence weight before returning to the scenario-service.
    """
    acts: list[SuggestedAction] = []
    for threshold, domain, action, reason in _RULES:
        stress = req.domain_stress.get(domain, 0.0)
        if stress >= threshold:
            acts.append(SuggestedAction(action=action, domain=domain, rationale=reason))

    if not acts and req.recent_metrics:
        anomaly = detect(AnomalyRequest(metrics=req.recent_metrics))
        if anomaly:
            acts.append(SuggestedAction(
                action="REVIEW_ALERT", domain="global",
                rationale=f"rolling anomaly detected at index {anomaly[-1].index}"))
    return acts