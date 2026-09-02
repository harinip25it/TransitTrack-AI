# 1. Purpose and Scope

**Purpose:** This document specifies the requirements for TransitTrack AI, a system that predicts crowding, detects route risk, suggests alternative routes, forecasts passenger demand, scores transit performance, and simulates what-if scenarios for public transit routes.

**In Scope (Version 1):**
- Smart Crowd Prediction for routes/stations
- Route Risk Detection based on historical and live data
- Smart Alternative Route Suggestion based on crowd and risk outputs
- Passenger Demand Forecasting for planning purposes
- Transit Performance Score generation and reporting
- What-If Transit Simulation for user-defined scenarios

**Out of Scope (Version 1):**
- Real-time GPS vehicle tracking hardware integration
- Payment or ticketing systems
- Mobile app development
- Multi-city/multi-agency support
- Live driver/staff communication tools
- Integration with third-party navigation apps

---

# 2. Functional Requirements

**FR-01:** The system shall predict crowd levels for a given route or station based on historical and available data.

**FR-02:** The system shall detect risk levels for a given transit route based on historical and available data.

**FR-03:** The system shall suggest alternative routes when crowd prediction or route risk exceeds a defined threshold.

**FR-04:** The system shall forecast passenger demand for routes over a specified future time period.

**FR-05:** The system shall generate a performance score for each transit route based on historical data.

**FR-06:** The system shall allow a user to input a hypothetical scenario and simulate its impact on crowd levels, risk, and demand.

**FR-07:** The system shall display the crowd prediction results to the user.

**FR-08:** The system shall display the route risk detection results to the user.

**FR-09:** The system shall display the suggested alternative routes to the user.

**FR-10:** The system shall display the passenger demand forecast to the user.

**FR-11:** The system shall display the transit performance score to the user.

**FR-12:** The system shall display the results of the what-if simulation to the user.

**FR-13:** The system shall store historical transit data used for predictions, forecasts, and scoring.

---

# 3. Non-Functional Requirements

**NFR-01 (Speed):** The system shall return crowd prediction results within 3 seconds of a request.

**NFR-02 (Speed):** The system shall return route risk detection results within 3 seconds of a request.

**NFR-03 (Speed):** The system shall complete a what-if simulation within 10 seconds for a single scenario.

**NFR-04 (Security):** The system shall require a valid login with password of at least 8 characters before granting access.

**NFR-05 (Security):** The system shall log all data access attempts with a timestamp accurate to the nearest second.

**NFR-06 (Usability):** A first-time user shall be able to generate a crowd prediction within 5 clicks or actions from login.

**NFR-07 (Usability):** The system shall display error messages within 2 seconds of an invalid input.

**NFR-08 (Reliability):** The system shall maintain 95% uptime measured on a monthly basis.

**NFR-09 (Reliability):** The system shall support at least 50 concurrent user requests without failure.

**NFR-10 (Reliability):** The system shall recover from a crash and restore last saved state within 60 seconds.

---

# 4. Assumptions and Constraints

**Assumptions:**
- Historical transit data (schedules, delays, ridership) is available and accessible for training/testing.
- Users have basic familiarity with reading charts and scores.
- A single city/agency's data is used for Version 1.
- Internet connectivity is available where the system is accessed.

**Constraints:**
- The system shall be built using Python as the primary programming language.
- The system shall use SQLite as the database for data storage.
- The system shall run on a single server instance (no distributed/cloud cluster in Version 1).
- SQLite's concurrent write limitations shall cap simultaneous write operations.
- No dedicated mobile application shall be built in Version 1; access is via desktop/web interface only.