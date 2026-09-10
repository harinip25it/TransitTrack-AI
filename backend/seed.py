from sqlalchemy.orm import Session

from backend.auth import hash_password
from backend.database import HistoricalRecord, Route, User

DEFAULT_USERNAME = "admin"
DEFAULT_PASSWORD = "transit123"

ROUTES = [
    ("101", "Route 101 - Downtown Loop", "route"),
    ("202", "Route 202 - Airport Express", "route"),
    ("303", "Route 303 - University Line", "route"),
    ("CS", "Central Station", "station"),
    ("NS", "North Station", "station"),
]

HISTORY = [
    ("101", "2026-08-25", "08:00", 5, 1120),
    ("101", "2026-08-26", "08:00", 4, 1180),
    ("101", "2026-08-27", "13:00", 7, 1250),
    ("101", "2026-08-28", "17:30", 6, 1310),
    ("101", "2026-08-29", "08:00", 5, 1205),
    ("202", "2026-08-25", "09:30", 12, 1480),
    ("202", "2026-08-26", "09:30", 14, 1520),
    ("202", "2026-08-27", "17:30", 15, 1620),
    ("202", "2026-08-28", "09:30", 11, 1490),
    ("202", "2026-08-29", "17:30", 16, 1680),
    ("303", "2026-08-25", "10:00", 3, 920),
    ("303", "2026-08-26", "10:00", 2, 880),
    ("303", "2026-08-27", "16:00", 4, 970),
    ("303", "2026-08-28", "10:00", 3, 910),
    ("303", "2026-08-29", "16:00", 1, 860),
    ("CS", "2026-08-27", "08:15", 8, 1410),
    ("CS", "2026-08-28", "08:15", 9, 1460),
    ("CS", "2026-08-29", "18:00", 10, 1510),
    ("NS", "2026-08-27", "07:45", 4, 780),
    ("NS", "2026-08-28", "07:45", 3, 740),
    ("NS", "2026-08-29", "18:20", 5, 810),
]


def seed_if_empty(db: Session):
    if db.query(User).count() == 0:
        db.add(User(username=DEFAULT_USERNAME, password_hash=hash_password(DEFAULT_PASSWORD)))

    if db.query(Route).count() == 0:
        routes = [Route(code=code, name=name, kind=kind) for code, name, kind in ROUTES]
        db.add_all(routes)
        db.flush()
        by_code = {route.code: route.id for route in db.query(Route).all()}
        db.add_all(
            [
                HistoricalRecord(
                    route_id=by_code[code],
                    record_date=record_date,
                    schedule_time=schedule_time,
                    delay_minutes=delay_minutes,
                    ridership=ridership,
                )
                for code, record_date, schedule_time, delay_minutes, ridership in HISTORY
            ]
        )
    else:
        # Repair any corrupted route names if necessary
        routes_map = {code: name for code, name, _ in ROUTES}
        for route in db.query(Route).all():
            if route.code in routes_map and ("\ufffd" in route.name or "" in route.name or "—" in route.name):
                route.name = routes_map[route.code]

    db.commit()

