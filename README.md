# TransitTrack AI

TransitTrack AI is an intelligent public transit operations and analytics platform that predicts crowding, detects route risks, suggests alternative routes, forecasts passenger demand, generates performance scores, and simulates what-if scenarios for a single public transit agency.

All features are strictly aligned with [srs.md](file:///d:/KEC%20College/Prompt/srs.md) and [REQUIREMENTS.md](file:///d:/KEC%20College/Prompt/REQUIREMENTS.md) (Version 1).

---

## Capabilities & SRS Mapping

| Capability | SRS / Requirements | Description |
| --- | --- | --- |
| **Authentication & Security** | NFR-04 | Enforces login with password &ge; 8 characters, secure PBKDF2 hashing, and HMAC bearer tokens. |
| **Access Logging** | NFR-05 | Records all data access attempts in SQLite with second-accurate timestamps. |
| **Operations Dashboard** | FR-07–FR-11, NFR-06 | Real-time overview of crowd levels, risk alerts, ridership, scores, and quick 1-click prediction. |
| **Crowd Prediction** | FR-01, FR-07, NFR-01 | Predicts crowd level (Low, Moderate, High) with animated capacity utilization gauge in < 3 seconds. |
| **Route Risk Detection** | FR-02, FR-08, NFR-02 | Detects operational risk (Low, Medium, High) based on delays and crowding in < 3 seconds. |
| **Alternative Routes** | FR-03, FR-09 | Automatically recommends ranked alternative routes when crowd or risk exceeds threshold. |
| **Demand Forecasting** | FR-04, FR-10 | Projects future demand over 7, 14, or 30 days with interactive SVG bar charts and tooltips. |
| **Performance Scores** | FR-05, FR-11 | Generates 0–100 efficiency scores and grades (A/B/C/D) based on delays, overcrowding, and reliability. |
| **What-If Simulation** | FR-06, FR-12, NFR-03 | Evaluates hypothetical scenarios (weather, events, timetable shifts) with delta metrics in < 10 seconds. |
| **Historical Data CRUD** | FR-13 | Complete Create, Read (single & list), Update, Delete, and live search for operational records. |
| **Combined Performance Report** | FR-05, FR-11 | Comprehensive agency audit report with print-optimized styling (`@media print`). |
| **Global Search** | FR-13 | Instant search dropdown across routes, stations, and historical records. |

> **Out of Scope (Version 1):** Real-time GPS hardware tracking, payments/ticketing, mobile apps, multi-city support, driver communications, and third-party navigation apps.

---

## Requirements

- Python 3.10+ (tested on Python 3.14)
- Modern web browser (Chrome, Edge, Firefox, Safari)

---

## Setup and Run Instructions

### 1. Windows PowerShell

From the project root directory:

```powershell
# Create virtual environment (if not already created)
py -3 -m venv .venv

# Activate environment
.\.venv\Scripts\Activate.ps1

# Install dependencies
python -m pip install -r requirements.txt

# Start the FastAPI server
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload
```

Or run directly without activating:
```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload
```

### 2. macOS / Linux

```bash
# Create virtual environment
python3 -m venv .venv

# Activate environment
source .venv/bin/activate

# Install dependencies
python -m pip install -r requirements.txt

# Start server
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload
```

---

## Access the Web Application

Open your browser and navigate to:
**[http://127.0.0.1:8000](http://127.0.0.1:8000)**

### Default Credentials:
- **Username:** `admin`
- **Password:** `transit123` *(at least 8 characters)*

SQLite database is initialized automatically with sample routes, stations, and historical records at `data/transittrack.db` using Write-Ahead Logging (`WAL`) mode for high concurrency.

---

## Running Automated Tests

Run the full unittest test suite:

```powershell
# Windows
.\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py" -v

# macOS / Linux
python -m unittest discover -s tests -p "test_*.py" -v
```

All 12 tests verify authentication security, speed thresholds (<3s / <10s), access logging timestamps, CRUD operations, simulations, and report generation.

---

## API Reference

Interactive Swagger API docs are available at: **[http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)**

Authenticated endpoints require `Authorization: Bearer <token>` returned by `/api/auth/login`.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/auth/login` | Authenticate user (enforces password &ge; 8 chars) |
| `GET` | `/api/auth/me` | Current user profile |
| `GET` | `/api/routes` | List all routes and stations |
| `GET` | `/api/dashboard` | Dashboard metrics & monitored route summary |
| `POST` | `/api/predict/crowd` | Smart crowd prediction (Low / Moderate / High) |
| `POST` | `/api/predict/risk` | Route risk detection (Low / Medium / High) |
| `POST` | `/api/alternatives` | Suggest ranked alternatives if threshold exceeded |
| `POST` | `/api/forecast/demand` | Forecast future demand over 7, 14, or 30 days |
| `GET` | `/api/performance` | Fleet performance scorecards (0–100) |
| `POST` | `/api/simulate` | What-if scenario simulation & delta calculation |
| `GET` | `/api/reports` | Combined transit performance and audit report |
| `GET` | `/api/historical` | List & filter historical records (`?q=term`) |
| `GET` | `/api/historical/{id}` | Retrieve single historical record by ID |
| `POST` | `/api/historical` | Create new historical record |
| `PUT` | `/api/historical/{id}` | Update existing historical record |
| `DELETE` | `/api/historical/{id}` | Delete historical record |
| `GET` | `/api/search` | Instant search across routes and records |
| `GET` | `/api/health` | Health check endpoint |

---

## Project Structure

```
├── backend/
│   ├── __init__.py
│   ├── analytics.py       # Prediction, risk, simulation & forecast algorithms
│   ├── auth.py            # Password hashing, tokens, access logging
│   ├── database.py        # SQLAlchemy models, SQLite WAL mode, timestamps
│   ├── main.py            # FastAPI endpoints, lifespan, validation handlers
│   └── seed.py            # Initial seed dataset with routes & stations
├── data/
│   └── transittrack.db    # SQLite database (auto-generated)
├── frontend/
│   ├── index.html         # Responsive semantic UI layout
│   ├── script.js          # Client routing, SVG charts, modals, CRUD
│   └── style.css          # Modern transit control center design system
├── tests/
│   └── test_api.py        # Automated test suite
├── REQUIREMENTS.md        # Feature traceability matrix
├── requirements.txt       # Python dependencies
├── srs.md                 # System Requirements Specification
└── README.md              # Documentation and run instructions
```

