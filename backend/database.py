from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    create_engine,
    event,
)
from sqlalchemy.orm import declarative_base, relationship, sessionmaker

ROOT_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)

DATABASE_URL = f"sqlite:///{DATA_DIR / 'transittrack.db'}"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
)


@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA busy_timeout=5000")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(80), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=utc_now, nullable=False)


class Route(Base):
    __tablename__ = "routes"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(40), unique=True, nullable=False, index=True)
    name = Column(String(120), nullable=False)
    kind = Column(String(20), nullable=False, default="route")

    records = relationship("HistoricalRecord", back_populates="route", cascade="all, delete-orphan")


class HistoricalRecord(Base):
    __tablename__ = "historical_data"

    id = Column(Integer, primary_key=True, index=True)
    route_id = Column(Integer, ForeignKey("routes.id"), nullable=False, index=True)
    record_date = Column(String(10), nullable=False, index=True)
    schedule_time = Column(String(5), nullable=False)
    delay_minutes = Column(Integer, nullable=False)
    ridership = Column(Integer, nullable=False)
    created_at = Column(DateTime, default=utc_now, nullable=False)

    route = relationship("Route", back_populates="records", lazy="joined")


class AccessLog(Base):
    __tablename__ = "access_logs"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(80), nullable=False)
    action = Column(String(80), nullable=False)
    resource = Column(String(160), nullable=False)
    success = Column(Boolean, nullable=False, default=True)
    timestamp = Column(DateTime, default=utc_now, nullable=False, index=True)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    Base.metadata.create_all(bind=engine)

