from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, Query, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.analytics import apply_scenario, forecast_demand, needs_alternatives, summarize_records
from backend.auth import (
    create_token,
    get_current_user,
    log_access,
    verify_password,
)
from backend.database import HistoricalRecord, Route, User, get_db, init_db
from backend.seed import seed_if_empty

ROOT_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = ROOT_DIR / "frontend"


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    db = next(get_db())
    try:
        seed_if_empty(db)
    finally:
        db.close()
    yield


app = FastAPI(title="TransitTrack AI", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    errors = exc.errors()
    messages = []
    for err in errors:
        loc = [str(part) for part in err.get("loc", []) if part != "body"]
        loc_str = " -> ".join(loc)
        msg = err.get("msg", "Invalid value")
        messages.append(f"{loc_str}: {msg}" if loc_str else msg)
    readable = "; ".join(messages) if messages else "Invalid input."
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": readable},
    )


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=128)


class HistoricalCreate(BaseModel):
    route_id: int
    record_date: str = Field(min_length=8, max_length=10)
    schedule_time: str = Field(min_length=4, max_length=5)
    delay_minutes: int = Field(ge=0, le=180)
    ridership: int = Field(ge=0, le=20000)


class HistoricalUpdate(BaseModel):
    route_id: Optional[int] = None
    record_date: Optional[str] = Field(default=None, min_length=8, max_length=10)
    schedule_time: Optional[str] = Field(default=None, min_length=4, max_length=5)
    delay_minutes: Optional[int] = Field(default=None, ge=0, le=180)
    ridership: Optional[int] = Field(default=None, ge=0, le=20000)


class TargetRequest(BaseModel):
    target_id: int


class ForecastRequest(BaseModel):
    target_id: int
    period_days: int = Field(ge=1, le=30)


class SimulationRequest(BaseModel):
    target_id: int
    demand_change_percent: float = Field(ge=-80, le=200)
    delay_change_minutes: float = Field(ge=-30, le=120)
    scenario: str = Field(min_length=3, max_length=400)



def serialize_route(route: Route) -> dict:
    return {"id": route.id, "code": route.code, "name": route.name, "kind": route.kind}


def serialize_record(record: HistoricalRecord) -> dict:
    return {
        "id": record.id,
        "route_id": record.route_id,
        "route_code": record.route.code if record.route else "",
        "route_name": record.route.name if record.route else "",
        "record_date": record.record_date,
        "schedule_time": record.schedule_time,
        "delay_minutes": record.delay_minutes,
        "ridership": record.ridership,
    }


def get_target(db: Session, target_id: int) -> Route:
    target = db.query(Route).filter(Route.id == target_id).first()
    if target is None:
        raise HTTPException(status_code=404, detail="Route or station not found.")
    return target


def records_for(db: Session, target_id: int):
    return db.query(HistoricalRecord).filter(HistoricalRecord.route_id == target_id).all()


def require_records(db: Session, target: Route):
    records = records_for(db, target.id)
    if not records:
        raise HTTPException(
            status_code=400,
            detail=f"No historical data is stored for {target.name}.",
        )
    return records


@app.post("/api/auth/login")
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    username = payload.username.strip()
    password = payload.password

    if len(password) < 8:
        log_access(db, username, "login", "auth", False)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password must be at least 8 characters.",
        )

    user = db.query(User).filter(User.username == username).first()
    if user is None or not verify_password(password, user.password_hash):
        log_access(db, username, "login", "auth", False)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password.")

    log_access(db, username, "login", "auth", True)
    return {"token": create_token(user.username), "username": user.username}


@app.get("/api/auth/me")
def me(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    log_access(db, current_user.username, "read", "auth:me")
    return {"username": current_user.username}



@app.get("/api/routes")
def list_routes(
    kind: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    log_access(db, current_user.username, "read", "routes")
    query = db.query(Route)
    if kind:
        query = query.filter(Route.kind == kind)
    return [serialize_route(route) for route in query.order_by(Route.kind, Route.code).all()]


@app.get("/api/search")
def search(
    q: str = Query(default="", max_length=80),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    log_access(db, current_user.username, "search", q or "blank")
    term = q.strip().lower()
    routes = db.query(Route).all()
    records = db.query(HistoricalRecord).all()
    if not term:
        return {"routes": [serialize_route(route) for route in routes], "records": []}

    matched_routes = [
        serialize_route(route)
        for route in routes
        if term in route.code.lower() or term in route.name.lower() or term in route.kind.lower()
    ]
    matched_records = []
    for record in records:
        blob = " ".join(
            [
                record.route.code if record.route else "",
                record.route.name if record.route else "",
                record.record_date,
                record.schedule_time,
                str(record.delay_minutes),
                str(record.ridership),
            ]
        ).lower()
        if term in blob:
            matched_records.append(serialize_record(record))
    return {"routes": matched_routes, "records": matched_records[:25]}


@app.get("/api/dashboard")
def dashboard(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    log_access(db, current_user.username, "read", "dashboard")
    routes = db.query(Route).order_by(Route.code).all()
    overview = []
    crowd_counts = {"Low": 0, "Moderate": 0, "High": 0}
    scores = []
    demand_total = 0
    for route in routes:
        records = records_for(db, route.id)
        if not records:
            continue
        summary = summarize_records(records)
        crowd_counts[summary["crowd_level"]] += 1
        scores.append(summary["performance_score"])
        demand_total += summary["avg_ridership"]
        overview.append({"route": serialize_route(route), **summary})

    sample = next((item for item in overview if item["route"]["kind"] == "route"), overview[0] if overview else None)
    return {
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "route_count": len(overview),

        "crowd_summary": crowd_counts,
        "avg_performance": round(sum(scores) / len(scores)) if scores else 0,
        "demand_sample": round(demand_total / len(overview)) if overview else 0,
        "headline": sample,
        "overview": overview,
    }


@app.post("/api/predict/crowd")
def predict_crowd(
    payload: TargetRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    target = get_target(db, payload.target_id)
    records = require_records(db, target)
    log_access(db, current_user.username, "crowd_prediction", target.code)
    summary = summarize_records(records)
    return {
        "target": serialize_route(target),
        "crowd_level": summary["crowd_level"],
        "avg_ridership": summary["avg_ridership"],
        "record_count": summary["record_count"],
        "message": f"Predicted crowd level for {target.name} is {summary['crowd_level']} based on stored ridership history.",
    }


@app.post("/api/predict/risk")
def predict_risk(
    payload: TargetRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    target = get_target(db, payload.target_id)
    records = require_records(db, target)
    log_access(db, current_user.username, "route_risk", target.code)
    summary = summarize_records(records)
    return {
        "target": serialize_route(target),
        "risk_level": summary["risk_level"],
        "avg_delay_minutes": summary["avg_delay_minutes"],
        "crowd_level": summary["crowd_level"],
        "message": f"Detected risk level for {target.name} is {summary['risk_level']} based on delay and crowd history.",
    }


@app.post("/api/alternatives")
def alternatives(
    payload: TargetRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    target = get_target(db, payload.target_id)
    records = require_records(db, target)
    log_access(db, current_user.username, "alternatives", target.code)
    current = summarize_records(records)
    threshold_hit = needs_alternatives(current["crowd_level"], current["risk_level"])
    suggestions = []
    if threshold_hit:
        others = db.query(Route).filter(Route.id != target.id, Route.kind == target.kind).all()
        if not others:
            others = db.query(Route).filter(Route.id != target.id).all()
        ranked = []

        for route in others:
            other_records = records_for(db, route.id)
            if not other_records:
                continue
            summary = summarize_records(other_records)
            ranked.append({"route": serialize_route(route), **summary})
        ranked.sort(key=lambda item: (-item["performance_score"], item["avg_delay_minutes"]))
        suggestions = ranked[:3]

    return {
        "target": serialize_route(target),
        "current": current,
        "threshold_exceeded": threshold_hit,
        "suggestions": suggestions,
        "message": (
            "Crowd or risk exceeded the defined threshold. Suggested alternatives are listed below."
            if threshold_hit
            else "Crowd and risk are within the defined threshold. No alternative routes are required."
        ),
    }


@app.post("/api/forecast/demand")
def demand_forecast(
    payload: ForecastRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    target = get_target(db, payload.target_id)
    records = require_records(db, target)
    log_access(db, current_user.username, "demand_forecast", target.code)
    forecast = forecast_demand(records, payload.period_days)
    return {
        "target": serialize_route(target),
        **forecast,
        "message": f"Passenger demand forecast for {target.name} over the next {payload.period_days} days.",
    }


@app.get("/api/performance")
def performance(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    log_access(db, current_user.username, "read", "performance")
    results = []
    for route in db.query(Route).filter(Route.kind == "route").order_by(Route.code).all():
        records = records_for(db, route.id)
        if not records:
            continue
        results.append({"route": serialize_route(route), **summarize_records(records)})
    return results


@app.post("/api/simulate")
def simulate(
    payload: SimulationRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    target = get_target(db, payload.target_id)
    records = require_records(db, target)
    log_access(db, current_user.username, "simulation", target.code)
    baseline = summarize_records(records)
    result = apply_scenario(baseline, payload.demand_change_percent, payload.delay_change_minutes)
    return {
        "target": serialize_route(target),
        "scenario": payload.scenario.strip(),
        "baseline": baseline,
        "result": result,
        "message": (
            f"Simulation complete for {target.name}. "
            f"Demand change {payload.demand_change_percent:+.1f}%, "
            f"delay change {payload.delay_change_minutes:+.1f} minutes."
        ),
    }


@app.get("/api/reports")
def reports(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    log_access(db, current_user.username, "read", "reports")
    rows = []
    for route in db.query(Route).order_by(Route.kind, Route.code).all():
        records = records_for(db, route.id)
        if not records:
            continue
        summary = summarize_records(records)
        forecast = forecast_demand(records, 7)
        rows.append(
            {
                "route": serialize_route(route),
                **summary,
                "forecast_7_day_total": forecast["total"],
                "forecast_7_day_average": forecast["daily_average"],
            }
        )
    return {
        "title": "TransitTrack AI Performance Report",
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "rows": rows,
    }



@app.get("/api/historical")
def list_historical(
    q: str = Query(default="", max_length=80),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    log_access(db, current_user.username, "read", "historical")
    records = db.query(HistoricalRecord).order_by(HistoricalRecord.record_date.desc(), HistoricalRecord.id.desc()).all()
    items = [serialize_record(record) for record in records]
    term = q.strip().lower()
    if term:
        items = [
            item
            for item in items
            if term in " ".join(str(value).lower() for value in item.values())
        ]
    return items


@app.post("/api/historical", status_code=201)
def create_historical(
    payload: HistoricalCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    get_target(db, payload.route_id)
    validate_date(payload.record_date)
    validate_time(payload.schedule_time)
    record = HistoricalRecord(
        route_id=payload.route_id,
        record_date=payload.record_date,
        schedule_time=payload.schedule_time,
        delay_minutes=payload.delay_minutes,
        ridership=payload.ridership,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    record.route = db.query(Route).filter(Route.id == record.route_id).first()
    log_access(db, current_user.username, "create", f"historical:{record.id}")
    return serialize_record(record)


@app.get("/api/historical/{record_id}")
def get_historical_record(
    record_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    record = db.query(HistoricalRecord).filter(HistoricalRecord.id == record_id).first()
    if record is None:
        raise HTTPException(status_code=404, detail="Historical record not found.")
    log_access(db, current_user.username, "read", f"historical:{record_id}")
    return serialize_record(record)


@app.put("/api/historical/{record_id}")

def update_historical(
    record_id: int,
    payload: HistoricalUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    record = db.query(HistoricalRecord).filter(HistoricalRecord.id == record_id).first()
    if record is None:
        raise HTTPException(status_code=404, detail="Historical record not found.")
    data = payload.model_dump(exclude_unset=True)
    if "route_id" in data:
        get_target(db, data["route_id"])
    if "record_date" in data:
        validate_date(data["record_date"])
    if "schedule_time" in data:
        validate_time(data["schedule_time"])
    for key, value in data.items():
        setattr(record, key, value)
    db.commit()
    db.refresh(record)
    record.route = db.query(Route).filter(Route.id == record.route_id).first()
    log_access(db, current_user.username, "update", f"historical:{record.id}")
    return serialize_record(record)


@app.delete("/api/historical/{record_id}")
def delete_historical(
    record_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    record = db.query(HistoricalRecord).filter(HistoricalRecord.id == record_id).first()
    if record is None:
        raise HTTPException(status_code=404, detail="Historical record not found.")
    db.delete(record)
    db.commit()
    log_access(db, current_user.username, "delete", f"historical:{record_id}")
    return {"ok": True}


def validate_date(value: str):
    try:
        datetime.strptime(value, "%Y-%m-%d")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Date must use YYYY-MM-DD format.") from exc


def validate_time(value: str):
    try:
        datetime.strptime(value, "%H:%M")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Schedule time must use HH:MM format.") from exc


@app.get("/api/health")
def health():
    return {"status": "ok"}


if FRONTEND_DIR.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIR), name="assets")


@app.get("/")
def root():
    index = FRONTEND_DIR / "index.html"
    if not index.exists():
        raise HTTPException(status_code=404, detail="Frontend is missing.")
    return FileResponse(index)
