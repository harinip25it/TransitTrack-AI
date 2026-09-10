from collections import defaultdict
from statistics import mean

CROWD_CAPACITY = 1600
CROWD_HIGH_RATIO = 0.90
CROWD_MODERATE_RATIO = 0.70
RISK_HIGH_DELAY = 12
RISK_MEDIUM_DELAY = 5
ALT_CROWD_THRESHOLD = "High"
ALT_RISK_THRESHOLD = ("Medium", "High")


def _safe_mean(values, default=0.0):
    return mean(values) if values else default


def crowd_level_from_ridership(avg_ridership: float) -> str:
    ratio = avg_ridership / CROWD_CAPACITY
    if ratio >= CROWD_HIGH_RATIO:
        return "High"
    if ratio >= CROWD_MODERATE_RATIO:
        return "Moderate"
    return "Low"


def risk_level_from_delay(avg_delay: float, crowd_level: str) -> str:
    if avg_delay >= RISK_HIGH_DELAY or crowd_level == "High":
        return "High"
    if avg_delay >= RISK_MEDIUM_DELAY:
        return "Medium"
    return "Low"


def performance_score(avg_delay: float, avg_ridership: float, record_count: int) -> int:
    delay_penalty = min(45, avg_delay * 2.2)
    overcrowding = max(0, (avg_ridership / CROWD_CAPACITY) - 0.75) * 80
    reliability_bonus = min(8, record_count * 0.4)
    score = 100 - delay_penalty - overcrowding + reliability_bonus
    return max(0, min(100, round(score)))


def summarize_records(records):
    delays = [r.delay_minutes for r in records]
    riders = [r.ridership for r in records]
    avg_delay = _safe_mean(delays)
    avg_ridership = _safe_mean(riders)
    crowd = crowd_level_from_ridership(avg_ridership)
    risk = risk_level_from_delay(avg_delay, crowd)
    score = performance_score(avg_delay, avg_ridership, len(records))
    capacity_utilization = round((avg_ridership / CROWD_CAPACITY) * 100, 1) if CROWD_CAPACITY else 0
    return {
        "record_count": len(records),
        "avg_delay_minutes": round(avg_delay, 1),
        "avg_ridership": round(avg_ridership),
        "crowd_level": crowd,
        "risk_level": risk,
        "performance_score": score,
        "capacity_utilization": capacity_utilization,
        "capacity_max": CROWD_CAPACITY,
    }


def forecast_demand(records, days: int):
    if not records:
        return {"period_days": days, "points": [], "total": 0, "daily_average": 0}

    by_date = defaultdict(list)
    for record in records:
        by_date[record.record_date].append(record.ridership)

    daily_totals = [sum(values) for _, values in sorted(by_date.items())]
    baseline = _safe_mean(daily_totals, 1000)
    growth = 0.012 if len(daily_totals) > 1 else 0.0
    if len(daily_totals) > 1:
        growth = max(-0.05, min(0.08, (daily_totals[-1] - daily_totals[0]) / max(daily_totals[0], 1) / len(daily_totals)))

    points = []
    total = 0
    for day in range(1, days + 1):
        value = round(baseline * (1 + growth * day) * (1.04 if day % 6 in (0, 5) else 1.0))
        points.append({"label": f"Day {day}", "demand": value})
        total += value

    return {
        "period_days": days,
        "points": points,
        "total": total,
        "daily_average": round(total / days),
    }


def needs_alternatives(crowd_level: str, risk_level: str) -> bool:
    return crowd_level == ALT_CROWD_THRESHOLD or risk_level in ALT_RISK_THRESHOLD


def apply_scenario(summary: dict, demand_change_percent: float, delay_change_minutes: float):
    adjusted_ridership = max(0, summary["avg_ridership"] * (1 + demand_change_percent / 100))
    adjusted_delay = max(0, summary["avg_delay_minutes"] + delay_change_minutes)
    crowd = crowd_level_from_ridership(adjusted_ridership)
    risk = risk_level_from_delay(adjusted_delay, crowd)
    score = performance_score(adjusted_delay, adjusted_ridership, summary["record_count"])
    demand = round(adjusted_ridership)
    capacity_utilization = round((adjusted_ridership / CROWD_CAPACITY) * 100, 1) if CROWD_CAPACITY else 0
    return {
        "crowd_level": crowd,
        "risk_level": risk,
        "demand": demand,
        "performance_score": score,
        "avg_delay_minutes": round(adjusted_delay, 1),
        "avg_ridership": round(adjusted_ridership),
        "capacity_utilization": capacity_utilization,
        "delta_demand": demand - summary["avg_ridership"],
        "delta_delay": round(adjusted_delay - summary["avg_delay_minutes"], 1),
        "delta_score": score - summary["performance_score"],
    }

