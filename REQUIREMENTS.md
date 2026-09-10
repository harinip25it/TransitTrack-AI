# TransitTrack AI — Implementation Requirements

This file maps the Version 1 product to `srs.md`. Do not implement items listed as out of scope in the SRS.

## Source of truth

- Functional and non-functional product rules: `srs.md`
- Delivery stack for this build: FastAPI backend, SQLite database, web frontend

## In-scope capabilities

| Capability | SRS |
| --- | --- |
| Login and authentication, password length ≥ 8 | NFR-04 |
| Access logging with second-accurate timestamps | NFR-05 |
| Dashboard | FR-07–FR-11 display, usability NFR-06 |
| Crowd prediction | FR-01, FR-07, NFR-01 |
| Route risk detection | FR-02, FR-08, NFR-02 |
| Alternative routes when crowd/risk exceeds threshold | FR-03, FR-09 |
| Passenger demand forecast | FR-04, FR-10 |
| Performance score | FR-05, FR-11 |
| What-if simulation | FR-06, FR-12, NFR-03 |
| Historical data storage with CRUD and search | FR-13 |
| Combined performance report | FR-05, FR-11 |
| Input validation and visible error messages | NFR-07 |
| Python + SQLite, single-server web access | Constraints |

## Out of scope

GPS hardware, payments, mobile apps, multi-city support, driver comms, and third-party navigation apps.
