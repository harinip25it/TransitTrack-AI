import time
import unittest
from datetime import datetime, timezone
from fastapi.testclient import TestClient

from backend.main import app
from backend.database import AccessLog, HistoricalRecord, Route, SessionLocal, init_db
from backend.seed import seed_if_empty


class TransitTrackApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        init_db()
        db = SessionLocal()
        seed_if_empty(db)
        db.close()
        cls.client = TestClient(app)

        # Log in to acquire a test token
        res = cls.client.post("/api/auth/login", json={"username": "admin", "password": "transit123"})
        assert res.status_code == 200, f"Login failed: {res.text}"
        cls.token = res.json()["token"]
        cls.auth_headers = {"Authorization": f"Bearer {cls.token}"}

    def test_01_login_security_nfr04(self):
        """NFR-04: Require valid login with password of at least 8 characters."""
        # Short password (< 8 chars)
        res_short = self.client.post("/api/auth/login", json={"username": "admin", "password": "short"})
        self.assertEqual(res_short.status_code, 400)
        self.assertIn("at least 8 characters", res_short.json()["detail"])

        # Invalid password (>= 8 chars)
        res_wrong = self.client.post("/api/auth/login", json={"username": "admin", "password": "wrongpassword123"})
        self.assertEqual(res_wrong.status_code, 401)
        self.assertIn("Invalid username or password", res_wrong.json()["detail"])

        # Valid login
        res_ok = self.client.post("/api/auth/login", json={"username": "admin", "password": "transit123"})
        self.assertEqual(res_ok.status_code, 200)
        self.assertIn("token", res_ok.json())
        self.assertEqual(res_ok.json()["username"], "admin")

    def test_02_unauthenticated_access_rejected(self):
        """Ensure endpoints enforce token authentication."""
        endpoints = [
            ("GET", "/api/dashboard"),
            ("GET", "/api/routes"),
            ("GET", "/api/performance"),
            ("GET", "/api/reports"),
            ("GET", "/api/historical"),
        ]
        for method, path in endpoints:
            res = self.client.request(method, path)
            self.assertEqual(res.status_code, 401, f"{method} {path} should require auth")

    def test_03_access_logging_nfr05(self):
        """NFR-05: Log data access attempts with second-accurate timestamps."""
        db = SessionLocal()
        count_before = db.query(AccessLog).count()
        db.close()

        # Trigger authenticated read
        res = self.client.get("/api/dashboard", headers=self.auth_headers)
        self.assertEqual(res.status_code, 200)

        db = SessionLocal()
        latest_log = db.query(AccessLog).order_by(AccessLog.id.desc()).first()
        self.assertIsNotNone(latest_log)
        self.assertEqual(latest_log.username, "admin")
        self.assertEqual(latest_log.action, "read")
        self.assertEqual(latest_log.resource, "dashboard")
        # Ensure timestamp has 0 microseconds (second-accurate)
        self.assertEqual(latest_log.timestamp.microsecond, 0)
        db.close()

    def test_04_crowd_prediction_fr01_fr07_nfr01(self):
        """FR-01, FR-07, NFR-01: Crowd prediction returns within 3 seconds with valid data."""
        start = time.time()
        res = self.client.post("/api/predict/crowd", json={"target_id": 1}, headers=self.auth_headers)
        duration = time.time() - start

        self.assertLess(duration, 3.0, "NFR-01 speed requirement: < 3s")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("crowd_level", data)
        self.assertIn(data["crowd_level"], ["Low", "Moderate", "High"])
        self.assertGreater(data["avg_ridership"], 0)
        self.assertEqual(data["target"]["id"], 1)

    def test_05_route_risk_detection_fr02_fr08_nfr02(self):
        """FR-02, FR-08, NFR-02: Route risk detection returns within 3 seconds."""
        start = time.time()
        res = self.client.post("/api/predict/risk", json={"target_id": 2}, headers=self.auth_headers)
        duration = time.time() - start

        self.assertLess(duration, 3.0, "NFR-02 speed requirement: < 3s")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("risk_level", data)
        self.assertIn(data["risk_level"], ["Low", "Medium", "High"])
        self.assertIn("avg_delay_minutes", data)

    def test_06_alternative_routes_fr03_fr09(self):
        """FR-03, FR-09: Suggest alternatives when crowd or risk exceeds threshold."""
        # Route 202 has high delay & ridership -> should exceed threshold and suggest alternatives
        res_exceeded = self.client.post("/api/alternatives", json={"target_id": 2}, headers=self.auth_headers)
        self.assertEqual(res_exceeded.status_code, 200)
        data_exceeded = res_exceeded.json()
        self.assertTrue(data_exceeded["threshold_exceeded"])
        self.assertGreater(len(data_exceeded["suggestions"]), 0)
        # Suggestions must be sorted by score descending
        scores = [s["performance_score"] for s in data_exceeded["suggestions"]]
        self.assertEqual(scores, sorted(scores, reverse=True))

        # Route 303 has low delay & ridership -> should NOT exceed threshold
        res_ok = self.client.post("/api/alternatives", json={"target_id": 3}, headers=self.auth_headers)
        self.assertEqual(res_ok.status_code, 200)
        self.assertFalse(res_ok.json()["threshold_exceeded"])
        self.assertEqual(len(res_ok.json()["suggestions"]), 0)

    def test_07_demand_forecast_fr04_fr10(self):
        """FR-04, FR-10: Passenger demand forecast over 7, 14, 30 days."""
        for days in [7, 14, 30]:
            res = self.client.post("/api/forecast/demand", json={"target_id": 1, "period_days": days}, headers=self.auth_headers)
            self.assertEqual(res.status_code, 200)
            data = res.json()
            self.assertEqual(data["period_days"], days)
            self.assertEqual(len(data["points"]), days)
            self.assertGreater(data["total"], 0)
            self.assertGreater(data["daily_average"], 0)

    def test_08_performance_scoring_fr05_fr11(self):
        """FR-05, FR-11: Performance score generation for transit routes."""
        res = self.client.get("/api/performance", headers=self.auth_headers)
        self.assertEqual(res.status_code, 200)
        rows = res.json()
        self.assertGreater(len(rows), 0)
        for r in rows:
            self.assertIn("performance_score", r)
            self.assertTrue(0 <= r["performance_score"] <= 100)
            self.assertEqual(r["route"]["kind"], "route")

    def test_09_what_if_simulation_fr06_fr12_nfr03(self):
        """FR-06, FR-12, NFR-03: What-if simulation within 10 seconds."""
        payload = {
            "target_id": 1,
            "scenario": "Severe Snowstorm causing transit disruptions",
            "demand_change_percent": -15.0,
            "delay_change_minutes": 14.0,
        }
        start = time.time()
        res = self.client.post("/api/simulate", json=payload, headers=self.auth_headers)
        duration = time.time() - start

        self.assertLess(duration, 10.0, "NFR-03 speed requirement: < 10s")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("baseline", data)
        self.assertIn("result", data)
        self.assertEqual(data["scenario"], payload["scenario"])
        # Check delta values
        self.assertIn("delta_demand", data["result"])
        self.assertIn("delta_delay", data["result"])
        self.assertIn("delta_score", data["result"])

    def test_10_historical_data_crud_and_search_fr13(self):
        """FR-13: Complete CRUD & Search for historical transit data."""
        # 1. Create Record
        new_record = {
            "route_id": 1,
            "record_date": "2026-09-01",
            "schedule_time": "14:30",
            "delay_minutes": 8,
            "ridership": 1250,
        }
        create_res = self.client.post("/api/historical", json=new_record, headers=self.auth_headers)
        self.assertEqual(create_res.status_code, 201)
        created_data = create_res.json()
        record_id = created_data["id"]
        self.assertEqual(created_data["delay_minutes"], 8)
        self.assertEqual(created_data["ridership"], 1250)

        # 2. Get Single Record
        get_res = self.client.get(f"/api/historical/{record_id}", headers=self.auth_headers)
        self.assertEqual(get_res.status_code, 200)
        self.assertEqual(get_res.json()["id"], record_id)

        # 3. Update Record
        update_payload = {
            "delay_minutes": 12,
            "ridership": 1380,
        }
        update_res = self.client.put(f"/api/historical/{record_id}", json=update_payload, headers=self.auth_headers)
        self.assertEqual(update_res.status_code, 200)
        self.assertEqual(update_res.json()["delay_minutes"], 12)
        self.assertEqual(update_res.json()["ridership"], 1380)

        # 4. Search Filter
        search_res = self.client.get("/api/historical?q=2026-09-01", headers=self.auth_headers)
        self.assertEqual(search_res.status_code, 200)
        matches = [r for r in search_res.json() if r["id"] == record_id]
        self.assertEqual(len(matches), 1)

        # Global search endpoint
        global_search = self.client.get("/api/search?q=2026-09-01", headers=self.auth_headers)
        self.assertEqual(global_search.status_code, 200)
        self.assertGreater(len(global_search.json()["records"]), 0)

        # 5. Delete Record
        del_res = self.client.delete(f"/api/historical/{record_id}", headers=self.auth_headers)
        self.assertEqual(del_res.status_code, 200)
        self.assertTrue(del_res.json()["ok"])

        # Verify 404 after delete
        get_deleted = self.client.get(f"/api/historical/{record_id}", headers=self.auth_headers)
        self.assertEqual(get_deleted.status_code, 404)

    def test_11_reports_combined_fr05_fr11(self):
        """FR-05, FR-11: Combined performance report."""
        res = self.client.get("/api/reports", headers=self.auth_headers)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("TransitTrack AI Performance Report", data["title"])
        self.assertIn("rows", data)
        self.assertGreater(len(data["rows"]), 0)
        for row in data["rows"]:
            self.assertIn("forecast_7_day_total", row)
            self.assertIn("performance_score", row)

    def test_12_frontend_index_delivered(self):
        """Check frontend HTML is served at root."""
        res = self.client.get("/")
        self.assertEqual(res.status_code, 200)
        self.assertIn("TransitTrack AI", res.text)
        self.assertIn("Operations Dashboard", res.text)


if __name__ == "__main__":
    unittest.main()
