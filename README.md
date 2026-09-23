# TransitTrack AI — Supabase PostgreSQL Edition

TransitTrack AI is an intelligent public transit operations and analytics platform that predicts crowding, detects route risks, suggests alternative routes, forecasts passenger demand, generates performance scores, and simulates what-if scenarios for public transit agencies.

All functional features, validation constraints, and performance requirements are strictly aligned with `srs.md` and `REQUIREMENTS.md`.

---

## Supabase PostgreSQL Architecture & Schema

The system is connected to Supabase PostgreSQL, designed with relational integrity, foreign key cascades, check constraints, and performance indexes.

### 1. Tables Designed & Created

| Table Name | Description | Keys & Constraints |
| --- | --- | --- |
| `public.users` | Operator user accounts (NFR-04) | `id` (PK, BIGSERIAL), `username` (UNIQUE, VARCHAR(64)), `password_hash` (TEXT), `role` (VARCHAR(32)), `created_at` (TIMESTAMPTZ) |
| `public.routes` | Monitored transit routes & stations | `id` (PK, BIGSERIAL), `code` (UNIQUE, VARCHAR(16)), `name` (VARCHAR(128)), `kind` (CHECK in `'route'`, `'station'`), `created_at` (TIMESTAMPTZ) |
| `public.historical_records` | Operational ridership and delay logs (FR-13) | `id` (PK, BIGSERIAL), `route_id` (FK &rarr; `routes.id` ON DELETE CASCADE), `record_date` (DATE), `schedule_time` (VARCHAR(8)), `delay_minutes` (CHECK `0 <= delay <= 180`), `ridership` (CHECK `0 <= ridership <= 20000`), `created_at` (TIMESTAMPTZ) |
| `public.access_logs` | Audit trail for security & compliance (NFR-05) | `id` (PK, BIGSERIAL), `username` (VARCHAR(64)), `action` (VARCHAR(64)), `resource` (VARCHAR(128)), `success` (BOOLEAN), `timestamp` (TIMESTAMPTZ DEFAULT NOW()) |

### 2. Indexes & Performance Optimization
- `idx_historical_records_route_id` on `historical_records(route_id)`
- `idx_historical_records_date` on `historical_records(record_date)`
- `idx_access_logs_timestamp` on `access_logs(timestamp)`
- `idx_routes_kind` on `routes(kind)`

### 3. Row-Level Security (RLS)
RLS policies are defined in `supabase/schema.sql` enabling secure read/write policies for service roles and authenticated operators.

---

## Data Migration

All 5 core transit routes and all 21 historical records are preserved and migrated:

- **5 Routes / Stations**:
  - `101`: Route 101 - Downtown Loop (route)
  - `202`: Route 202 - Airport Express (route)
  - `303`: Route 303 - University Line (route)
  - `CS`: Central Station (station)
  - `NS`: North Station (station)
- **21 Operational Historical Records**:
  - Covering dates `2026-08-25` to `2026-08-29` across all routes and stations with delay minutes and passenger counts.
- **Operator Account**:
  - `admin` with secure PBKDF2 password hash (Password: `transit123`, &ge; 8 characters per NFR-04).

---

## Connecting to Your Supabase Project

Set the following environment variables (defined in `.env.example`):

```env
# Option 1: Supabase API URL & Key (Project Settings -> API)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Option 2: Supabase Direct / Pooler PostgreSQL URL (Project Settings -> Database)
DATABASE_URL=postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
```

The database adapter in `db.js` automatically:
1. Detects `DATABASE_URL` (direct/pooler PG connection) or `SUPABASE_URL` + keys (`@supabase/supabase-js`).
2. Creates any missing tables, keys, constraints, and indexes.
3. Automatically seeds the initial 5 routes, admin user, and 21 records if the database is newly initialized.
4. Provides a graceful fallback so the web app and dev server remain 100% operational during configuration.

---

## Capabilities & SRS Traceability

| Capability | SRS / Requirements | Status | Description |
| --- | --- | --- | --- |
| **Authentication & Security** | NFR-04 | Implemented | Enforces password &ge; 8 characters, PBKDF2 hashing (120k iterations), HMAC session tokens. |
| **Access Logging** | NFR-05 | Implemented | Records every action with second-accurate ISO timestamps in `access_logs`. |
| **Operations Dashboard** | FR-07–FR-11, NFR-06 | Implemented | Live overview of crowd levels, risk alerts, ridership, scores, and quick 1-click prediction. |
| **Crowd Prediction** | FR-01, FR-07, NFR-01 | Implemented | Predicts crowd level (Low, Moderate, High) with animated capacity utilization gauge in < 3s. |
| **Route Risk Detection** | FR-02, FR-08, NFR-02 | Implemented | Detects operational risk (Low, Medium, High) based on delays and crowding in < 3s. |
| **Alternative Routes** | FR-03, FR-09 | Implemented | Automatically recommends ranked alternative routes when crowd or risk exceeds threshold. |
| **Demand Forecasting** | FR-04, FR-10 | Implemented | Projects future demand over 7, 14, or 30 days with interactive SVG bar charts. |
| **Performance Scores** | FR-05, FR-11 | Implemented | Generates 0–100 efficiency scores and grades (A/B/C/D) based on delays and reliability. |
| **What-If Simulation** | FR-06, FR-12, NFR-03 | Implemented | Evaluates hypothetical scenarios (weather, events, timetable shifts) with delta metrics in < 10s. |
| **Historical Data CRUD** | FR-13 | Implemented | Complete Create, Read, Update, Delete, and instant search for operational records. |
| **Combined Performance Report** | FR-05, FR-11 | Implemented | Comprehensive agency audit report with print-optimized styling (`@media print`). |

---

## Running the Automated Test Suite

Run the full automated test suite:

```bash
npm test
```

All 19 tests verify authentication security, speed thresholds (<3s / <10s), access logging timestamps, CRUD operations, simulations, and report generation.

---

## Default Login Credentials
- **Username:** `admin`
- **Password:** `transit123` *(NFR-04 compliant: &ge; 8 characters)*
