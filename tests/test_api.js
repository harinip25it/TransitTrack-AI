import assert from "assert";

const BASE_URL = process.env.TEST_URL || "http://127.0.0.1:3000";

let authToken = null;
let createdRecordId = null;

async function request(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (authToken && !headers.Authorization) {
    headers.Authorization = `Bearer ${authToken}`;
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

async function runTests() {
  console.log("==========================================");
  console.log("TransitTrack AI — SRS & Supabase Test Suite");
  console.log("==========================================");

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    const startTime = Date.now();
    try {
      await fn();
      const duration = Date.now() - startTime;
      console.log(`  ✓ ${name} (${duration}ms)`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}:`, err.message);
      failed++;
    }
  }

  // 1. Health check
  await test("System Health Check (/api/health)", async () => {
    const res = await request("/api/health");
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.status, "ok");
  });

  // 2. NFR-04: Password validation >= 8 chars
  await test("NFR-04: Reject password shorter than 8 characters", async () => {
    const res = await request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "admin", password: "123" }),
    });
    assert.strictEqual(res.status, 400);
    assert(res.data.detail.includes("8 characters"));
  });

  await test("NFR-04: Reject invalid credentials", async () => {
    const res = await request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "admin", password: "wrongpassword123" }),
    });
    assert.strictEqual(res.status, 401);
  });

  await test("NFR-04: Successful operator login (admin / transit123)", async () => {
    const res = await request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "admin", password: "transit123" }),
    });
    assert.strictEqual(res.status, 200);
    assert(res.data.token, "Token should be returned");
    assert.strictEqual(res.data.username, "admin");
    authToken = res.data.token;
  });

  // 3. Database Status & Migration Verification
  await test("Database Status & Migration Check (/api/database/status)", async () => {
    const res = await request("/api/database/status");
    assert.strictEqual(res.status, 200);
    assert(res.data.provider, "Provider should be reported");
    assert(res.data.recordCount >= 21, "All 21 seed records must be present without loss");
    assert.strictEqual(res.data.routeCount, 5, "All 5 transit routes must be present");
  });

  // 4. Routes Check
  await test("List Transit Routes (/api/routes)", async () => {
    const res = await request("/api/routes");
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.length, 5);
    const codes = res.data.map((r) => r.code);
    assert(codes.includes("101") && codes.includes("202") && codes.includes("303") && codes.includes("CS") && codes.includes("NS"));
  });

  // 5. FR-01, FR-07, NFR-01: Crowd Prediction (<3s)
  await test("FR-01 / FR-07 / NFR-01: Crowd prediction for Route 101 within 3s", async () => {
    const start = Date.now();
    const res = await request("/api/predict/crowd", {
      method: "POST",
      body: JSON.stringify({ target_id: 1 }),
    });
    const elapsed = Date.now() - start;
    assert.strictEqual(res.status, 200);
    assert(res.data.crowd_level, "Crowd level must be returned");
    assert(res.data.avg_ridership > 0, "Average ridership must be positive");
    assert(res.data.record_count === 5, "Route 101 should have 5 records");
    assert(elapsed < 3000, `Must respond within 3000ms, took ${elapsed}ms`);
  });

  // 6. FR-02, FR-08, NFR-02: Route Risk Detection (<3s)
  await test("FR-02 / FR-08 / NFR-02: Route risk detection for Route 202 within 3s", async () => {
    const start = Date.now();
    const res = await request("/api/predict/risk", {
      method: "POST",
      body: JSON.stringify({ target_id: 2 }),
    });
    const elapsed = Date.now() - start;
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.risk_level, "High", "Route 202 has high average delay and crowd");
    assert(res.data.avg_delay_minutes > 10, "Average delay should exceed 10m");
    assert(elapsed < 3000, `Must respond within 3000ms, took ${elapsed}ms`);
  });

  // 7. FR-03, FR-09: Alternative Routes Suggestion
  await test("FR-03 / FR-09: Alternative routes suggested when threshold exceeded (Route 202)", async () => {
    const res = await request("/api/alternatives", {
      method: "POST",
      body: JSON.stringify({ target_id: 2 }),
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.threshold_exceeded, true);
    assert(res.data.suggestions.length > 0, "Should suggest alternative options");
    assert(res.data.suggestions[0].performance_score >= 0);
  });

  await test("FR-03 / FR-09: Normal route does not trigger alternative routes (Route 303)", async () => {
    const res = await request("/api/alternatives", {
      method: "POST",
      body: JSON.stringify({ target_id: 3 }),
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.threshold_exceeded, false);
    assert.strictEqual(res.data.suggestions.length, 0);
  });

  // 8. FR-04, FR-10: Passenger Demand Forecasting
  await test("FR-04 / FR-10: 7-day demand forecast for Route 101", async () => {
    const res = await request("/api/forecast/demand", {
      method: "POST",
      body: JSON.stringify({ target_id: 1, period_days: 7 }),
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.period_days, 7);
    assert.strictEqual(res.data.points.length, 7);
    assert(res.data.total > 0, "Forecast total must be positive");
    assert(res.data.daily_average > 0, "Daily average must be positive");
  });

  // 9. FR-05, FR-11: Performance Scores
  await test("FR-05 / FR-11: Performance scoring for monitored routes", async () => {
    const res = await request("/api/performance");
    assert.strictEqual(res.status, 200);
    assert(res.data.length >= 3, "Monitored routes should have scores");
    for (const item of res.data) {
      assert(item.performance_score >= 0 && item.performance_score <= 100);
      assert(item.avg_delay_minutes >= 0);
    }
  });

  // 10. FR-06, FR-12, NFR-03: What-if Simulation (<10s)
  await test("FR-06 / FR-12 / NFR-03: What-if simulation for severe weather within 10s", async () => {
    const start = Date.now();
    const res = await request("/api/simulate", {
      method: "POST",
      body: JSON.stringify({
        target_id: 1,
        scenario: "Severe Blizzard Weather Advisory",
        demand_change_percent: -15,
        delay_change_minutes: 20,
      }),
    });
    const elapsed = Date.now() - start;
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.scenario, "Severe Blizzard Weather Advisory");
    assert(res.data.baseline, "Baseline must exist");
    assert(res.data.result, "Simulated result must exist");
    assert.strictEqual(res.data.result.risk_level, "High");
    assert(elapsed < 10000, `Must complete simulation within 10s, took ${elapsed}ms`);
  });

  // 11. FR-13: Historical Records CRUD
  await test("FR-13: Read historical records and search", async () => {
    const all = await request("/api/historical");
    assert.strictEqual(all.status, 200);
    assert(all.data.length >= 21, "Initial 21 records must exist");

    const searchRes = await request("/api/historical?q=Airport");
    assert.strictEqual(searchRes.status, 200);
    assert(searchRes.data.length >= 5, "Should find Airport Express records");
  });

  await test("FR-13: Create new historical record with validation", async () => {
    // Test invalid delay
    const invalidRes = await request("/api/historical", {
      method: "POST",
      body: JSON.stringify({
        route_id: 1,
        record_date: "2026-08-30",
        schedule_time: "09:00",
        delay_minutes: 250, // exceeds 180 constraint
        ridership: 1100,
      }),
    });
    assert.strictEqual(invalidRes.status, 422, "Must reject delay_minutes > 180");

    // Test valid creation
    const validRes = await request("/api/historical", {
      method: "POST",
      body: JSON.stringify({
        route_id: 1,
        record_date: "2026-08-30",
        schedule_time: "09:00",
        delay_minutes: 8,
        ridership: 1250,
      }),
    });
    assert.strictEqual(validRes.status, 201);
    assert(validRes.data.id, "Created record should have ID");
    createdRecordId = validRes.data.id;
  });

  await test("FR-13: Update created historical record", async () => {
    assert(createdRecordId, "Must have created record ID");
    const res = await request(`/api/historical/${createdRecordId}`, {
      method: "PUT",
      body: JSON.stringify({
        delay_minutes: 5,
        ridership: 1300,
      }),
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.delay_minutes, 5);
    assert.strictEqual(res.data.ridership, 1300);
  });

  await test("FR-13: Delete created historical record", async () => {
    assert(createdRecordId, "Must have created record ID");
    const res = await request(`/api/historical/${createdRecordId}`, {
      method: "DELETE",
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.ok, true);

    // Verify deletion
    const getRes = await request(`/api/historical/${createdRecordId}`);
    assert.strictEqual(getRes.status, 404);
  });

  // 12. Combined Reports
  await test("Combined Fleet Performance Report (/api/reports)", async () => {
    const res = await request("/api/reports");
    assert.strictEqual(res.status, 200);
    assert(res.data.rows.length >= 3);
    assert(res.data.rows[0].forecast_7_day_total > 0);
  });

  // 13. NFR-05: Access Logging Verification
  await test("NFR-05: Access logging recorded with timestamp", async () => {
    const res = await request("/api/logs?limit=10");
    assert.strictEqual(res.status, 200);
    assert(Array.isArray(res.data) && res.data.length > 0, "Access logs should contain entries");
    const latest = res.data[0];
    assert(latest.timestamp, "Log must have timestamp");
    assert(!isNaN(new Date(latest.timestamp).getTime()), "Timestamp must be valid ISO date");
  });

  // 14. AI Feature: Transit Operations AI Copilot (/api/ai/chat)
  await test("AI Copilot: Validation rejects empty message (422)", async () => {
    const res = await request("/api/ai/chat", {
      method: "POST",
      body: JSON.stringify({ message: "   " }),
    });
    assert.strictEqual(res.status, 422);
    assert(res.data.detail.includes("cannot be empty"));
  });

  await test("AI Copilot: Process realistic transit query for Route 202 (/api/ai/chat)", async () => {
    const res = await request("/api/ai/chat", {
      method: "POST",
      body: JSON.stringify({
        message: "What is the operational status and delay risk for Route 202 Airport Express?",
        history: [],
      }),
    });
    assert.strictEqual(res.status, 200);
    assert(typeof res.data.reply === "string" && res.data.reply.length > 20, "Reply should be a comprehensive response");
    assert(res.data.model, "Model identifier should be returned");
    assert(Array.isArray(res.data.suggestions) && res.data.suggestions.length > 0, "Suggestions should be provided");
    assert(res.data.timestamp, "Timestamp should be present");
  });

  console.log("==========================================");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log("==========================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
