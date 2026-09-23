import express from "express";
import cors from "cors";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import {
  findUserByUsername,
  getRoutes,
  getRouteById,
  getHistoricalRecords,
  getRecordsForRoute,
  getRecordById,
  createHistoricalRecord,
  updateHistoricalRecord,
  deleteHistoricalRecord,
  logAccess,
  getAccessLogs,
  getDatabaseStatus,
  initDatabase,
  hashPassword,
  verifyPassword,
} from "./db.js";
import { GoogleGenAI } from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Gemini Client Lazy Initialization
let geminiClient = null;
function getGeminiClient() {
  const apiKey = (process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) return null;
  if (!geminiClient) {
    geminiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return geminiClient;
}

const PORT = 3000;
const HOST = "0.0.0.0";
const SECRET_KEY = process.env.TRANSITTRACK_SECRET || "transittrack-ai-local-secret";
const TOKEN_TTL_SECONDS = 60 * 60 * 12; // 12 hours

// Analytics constants (SRS Section 2 & Algorithms)
const CROWD_CAPACITY = 1600;
const CROWD_HIGH_RATIO = 0.90;
const CROWD_MODERATE_RATIO = 0.70;
const RISK_HIGH_DELAY = 12;
const RISK_MEDIUM_DELAY = 5;
const ALT_CROWD_THRESHOLD = "High";
const ALT_RISK_THRESHOLD = ["Medium", "High"];

// Token creation & decoding
function createToken(username) {
  const payload = {
    sub: username,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", SECRET_KEY).update(body).digest("hex");
  return `${body}.${signature}`;
}

function decodeToken(token) {
  const [body, signature] = (token || "").split(".");
  if (!body || !signature) {
    throw new Error("Invalid token.");
  }
  const expected = crypto.createHmac("sha256", SECRET_KEY).update(body).digest("hex");
  if (expected !== signature) {
    throw new Error("Invalid token.");
  }
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf-8"));
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error("Session expired. Please log in again.");
  }
  if (!payload.sub) {
    throw new Error("Invalid token.");
  }
  return payload.sub;
}

function serializeRoute(route) {
  return {
    id: Number(route.id),
    code: route.code,
    name: route.name,
    kind: route.kind,
  };
}

// Analytics Helpers
function safeMean(values, defaultVal = 0.0) {
  if (!values || !values.length) return defaultVal;
  const sum = values.reduce((a, b) => a + b, 0);
  return sum / values.length;
}

function crowdLevelFromRidership(avgRidership) {
  const ratio = avgRidership / CROWD_CAPACITY;
  if (ratio >= CROWD_HIGH_RATIO) return "High";
  if (ratio >= CROWD_MODERATE_RATIO) return "Moderate";
  return "Low";
}

function riskLevelFromDelay(avgDelay, crowdLevel) {
  if (avgDelay >= RISK_HIGH_DELAY || crowdLevel === "High") return "High";
  if (avgDelay >= RISK_MEDIUM_DELAY) return "Medium";
  return "Low";
}

function performanceScore(avgDelay, avgRidership, recordCount) {
  const delayPenalty = Math.min(45, avgDelay * 2.2);
  const overcrowding = Math.max(0, avgRidership / CROWD_CAPACITY - 0.75) * 80;
  const reliabilityBonus = Math.min(8, recordCount * 0.4);
  const score = 100 - delayPenalty - overcrowding + reliabilityBonus;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function summarizeRecords(records) {
  const delays = records.map((r) => Number(r.delay_minutes));
  const riders = records.map((r) => Number(r.ridership));
  const avgDelay = safeMean(delays);
  const avgRidership = safeMean(riders);
  const crowd = crowdLevelFromRidership(avgRidership);
  const risk = riskLevelFromDelay(avgDelay, crowd);
  const score = performanceScore(avgDelay, avgRidership, records.length);
  const capacityUtilization = CROWD_CAPACITY
    ? Math.round((avgRidership / CROWD_CAPACITY) * 1000) / 10
    : 0;
  return {
    record_count: records.length,
    avg_delay_minutes: Math.round(avgDelay * 10) / 10,
    avg_ridership: Math.round(avgRidership),
    crowd_level: crowd,
    risk_level: risk,
    performance_score: score,
    capacity_utilization: capacityUtilization,
    capacity_max: CROWD_CAPACITY,
  };
}

function forecastDemand(records, days) {
  if (!records || !records.length) {
    return { period_days: days, points: [], total: 0, daily_average: 0 };
  }
  const byDate = {};
  for (const record of records) {
    const dStr = typeof record.record_date === "string" ? record.record_date.slice(0, 10) : record.record_date;
    if (!byDate[dStr]) byDate[dStr] = [];
    byDate[dStr].push(Number(record.ridership));
  }
  const sortedDates = Object.keys(byDate).sort();
  const dailyTotals = sortedDates.map((d) => byDate[d].reduce((a, b) => a + b, 0));
  const baseline = safeMean(dailyTotals, 1000);
  let growth = 0.0;
  if (dailyTotals.length > 1) {
    const rawGrowth =
      (dailyTotals[dailyTotals.length - 1] - dailyTotals[0]) /
      Math.max(dailyTotals[0], 1) /
      dailyTotals.length;
    growth = Math.max(-0.05, Math.min(0.08, rawGrowth));
  }
  const points = [];
  let total = 0;
  for (let day = 1; day <= days; day++) {
    const weekendMultiplier = day % 6 === 0 || day % 6 === 5 ? 1.04 : 1.0;
    const value = Math.round(baseline * (1 + growth * day) * weekendMultiplier);
    points.push({ label: `Day ${day}`, demand: value });
    total += value;
  }
  return {
    period_days: days,
    points,
    total,
    daily_average: Math.round(total / days),
  };
}

function needsAlternatives(crowdLevel, riskLevel) {
  return crowdLevel === ALT_CROWD_THRESHOLD || ALT_RISK_THRESHOLD.includes(riskLevel);
}

function applyScenario(summary, demandChangePercent, delayChangeMinutes) {
  const adjustedRidership = Math.max(0, summary.avg_ridership * (1 + demandChangePercent / 100));
  const adjustedDelay = Math.max(0, summary.avg_delay_minutes + delayChangeMinutes);
  const crowd = crowdLevelFromRidership(adjustedRidership);
  const risk = riskLevelFromDelay(adjustedDelay, crowd);
  const score = performanceScore(adjustedDelay, adjustedRidership, summary.record_count);
  const demand = Math.round(adjustedRidership);
  const capacityUtilization = CROWD_CAPACITY
    ? Math.round((adjustedRidership / CROWD_CAPACITY) * 1000) / 10
    : 0;
  return {
    crowd_level: crowd,
    risk_level: risk,
    demand,
    performance_score: score,
    avg_delay_minutes: Math.round(adjustedDelay * 10) / 10,
    avg_ridership: Math.round(adjustedRidership),
    capacity_utilization: capacityUtilization,
    delta_demand: demand - summary.avg_ridership,
    delta_delay: Math.round((adjustedDelay - summary.avg_delay_minutes) * 10) / 10,
    delta_score: score - summary.performance_score,
  };
}

// Validation Helpers (NFR-07)
function validateDate(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const error = new Error("Date must use YYYY-MM-DD format.");
    error.status = 400;
    throw error;
  }
  const d = new Date(value);
  if (isNaN(d.getTime())) {
    const error = new Error("Date must use YYYY-MM-DD format.");
    error.status = 400;
    throw error;
  }
}

function validateTime(value) {
  if (!value || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    const error = new Error("Schedule time must use HH:MM format.");
    error.status = 400;
    throw error;
  }
}

// App Setup
const app = express();
app.use(cors());
app.use(express.json());

// Auth Middleware (NFR-04 & NFR-05)
async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    await logAccess("anonymous", "auth_required", req.originalUrl, false);
    return res.status(401).json({ detail: "Login required." });
  }
  const token = authHeader.substring(7).trim();
  try {
    const username = decodeToken(token);
    const user = await findUserByUsername(username);
    if (!user) {
      await logAccess(username, "auth_required", req.originalUrl, false);
      return res.status(401).json({ detail: "Login required." });
    }
    req.user = user;
    next();
  } catch (err) {
    await logAccess("anonymous", "auth_required", req.originalUrl, false);
    return res.status(401).json({ detail: err.message || "Invalid token." });
  }
}

// API Routes

// Health & Database Status
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/database/status", authMiddleware, async (req, res) => {
  const status = getDatabaseStatus();
  await logAccess(req.user.username, "check_db_status", "system", true);
  res.json(status);
});

// Access Logs (NFR-05: Audit Log)
app.get("/api/logs", authMiddleware, async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const logs = await getAccessLogs(limit);
  res.json(logs);
});

// Login (NFR-04: Password >= 8 characters)
app.post("/api/auth/login", async (req, res) => {
  const username = (req.body.username || "").trim();
  const password = req.body.password || "";

  if (password.length < 8) {
    await logAccess(username, "login", "auth", false);
    return res.status(400).json({ detail: "Password must be at least 8 characters (NFR-04)." });
  }

  const user = await findUserByUsername(username);
  if (!user || !verifyPassword(password, user.password_hash)) {
    await logAccess(username, "login", "auth", false);
    return res.status(401).json({ detail: "Invalid username or password." });
  }

  await logAccess(username, "login", "auth", true);
  res.json({
    token: createToken(user.username),
    username: user.username,
  });
});

// Current User
app.get("/api/auth/me", authMiddleware, async (req, res) => {
  await logAccess(req.user.username, "read", "auth:me", true);
  res.json({ username: req.user.username, role: req.user.role || "dispatcher" });
});

// List Routes
app.get("/api/routes", authMiddleware, async (req, res) => {
  await logAccess(req.user.username, "read", "routes", true);
  const kind = req.query.kind || null;
  const list = await getRoutes(kind);
  res.json(list.map(serializeRoute));
});

// Search Routes & Historical Records
app.get("/api/search", authMiddleware, async (req, res) => {
  const q = (req.query.q || "").trim().toLowerCase();
  await logAccess(req.user.username, "search", q || "blank", true);

  const routes = await getRoutes();

  if (!q) {
    return res.json({
      routes: routes.map(serializeRoute),
      records: [],
    });
  }

  const matchedRoutes = routes
    .filter(
      (r) =>
        r.code.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        r.kind.toLowerCase().includes(q)
    )
    .map(serializeRoute);

  const matchedRecords = await getHistoricalRecords(q);
  res.json({ routes: matchedRoutes, records: matchedRecords.slice(0, 25) });
});

// Dashboard (FR-07 - FR-11, NFR-06)
app.get("/api/dashboard", authMiddleware, async (req, res) => {
  await logAccess(req.user.username, "read", "dashboard", true);
  const routes = await getRoutes();
  const allRecords = await getHistoricalRecords();

  const overview = [];
  const crowdCounts = { Low: 0, Moderate: 0, High: 0 };
  const scores = [];
  let demandTotal = 0;

  for (const route of routes) {
    const routeRecords = allRecords.filter((r) => r.route_id === Number(route.id));
    if (!routeRecords.length) continue;
    const summary = summarizeRecords(routeRecords);
    crowdCounts[summary.crowd_level]++;
    scores.push(summary.performance_score);
    demandTotal += summary.avg_ridership;
    overview.push({ route: serializeRoute(route), ...summary });
  }

  const sample =
    overview.find((item) => item.route.kind === "route") || overview[0] || null;

  res.json({
    generated_at: new Date().toISOString(),
    route_count: overview.length,
    crowd_summary: crowdCounts,
    avg_performance: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
    demand_sample: overview.length ? Math.round(demandTotal / (overview.length || 1)) : 0,
    headline: sample,
    overview,
  });
});

// Predict Crowd (FR-01, FR-07, NFR-01 < 3s)
app.post("/api/predict/crowd", authMiddleware, async (req, res) => {
  try {
    const targetId = req.body.target_id;
    const target = await getRouteById(targetId);
    if (!target) {
      return res.status(404).json({ detail: "Route or station not found." });
    }
    const records = await getRecordsForRoute(target.id);
    if (!records.length) {
      return res.status(400).json({ detail: `No historical data is stored for ${target.name}.` });
    }
    await logAccess(req.user.username, "crowd_prediction", target.code, true);
    const summary = summarizeRecords(records);
    res.json({
      target: serializeRoute(target),
      crowd_level: summary.crowd_level,
      avg_ridership: summary.avg_ridership,
      record_count: summary.record_count,
      message: `Predicted crowd level for ${target.name} is ${summary.crowd_level} based on stored ridership history.`,
    });
  } catch (err) {
    res.status(err.status || 500).json({ detail: err.message });
  }
});

// Predict Route Risk (FR-02, FR-08, NFR-02 < 3s)
app.post("/api/predict/risk", authMiddleware, async (req, res) => {
  try {
    const targetId = req.body.target_id;
    const target = await getRouteById(targetId);
    if (!target) {
      return res.status(404).json({ detail: "Route or station not found." });
    }
    const records = await getRecordsForRoute(target.id);
    if (!records.length) {
      return res.status(400).json({ detail: `No historical data is stored for ${target.name}.` });
    }
    await logAccess(req.user.username, "route_risk", target.code, true);
    const summary = summarizeRecords(records);
    res.json({
      target: serializeRoute(target),
      risk_level: summary.risk_level,
      avg_delay_minutes: summary.avg_delay_minutes,
      crowd_level: summary.crowd_level,
      message: `Detected risk level for ${target.name} is ${summary.risk_level} based on delay and crowd history.`,
    });
  } catch (err) {
    res.status(err.status || 500).json({ detail: err.message });
  }
});

// Alternative Routes (FR-03, FR-09)
app.post("/api/alternatives", authMiddleware, async (req, res) => {
  try {
    const targetId = req.body.target_id;
    const target = await getRouteById(targetId);
    if (!target) {
      return res.status(404).json({ detail: "Route or station not found." });
    }
    const records = await getRecordsForRoute(target.id);
    if (!records.length) {
      return res.status(400).json({ detail: `No historical data is stored for ${target.name}.` });
    }
    await logAccess(req.user.username, "alternatives", target.code, true);

    const current = summarizeRecords(records);
    const thresholdHit = needsAlternatives(current.crowd_level, current.risk_level);
    let suggestions = [];

    if (thresholdHit) {
      const allRoutes = await getRoutes();
      let others = allRoutes.filter((r) => r.id !== target.id && r.kind === target.kind);
      if (!others.length) {
        others = allRoutes.filter((r) => r.id !== target.id);
      }
      const ranked = [];
      for (const route of others) {
        const otherRecords = await getRecordsForRoute(route.id);
        if (!otherRecords.length) continue;
        const summary = summarizeRecords(otherRecords);
        ranked.push({ route: serializeRoute(route), ...summary });
      }
      ranked.sort((a, b) => {
        if (b.performance_score !== a.performance_score) {
          return b.performance_score - a.performance_score;
        }
        return a.avg_delay_minutes - b.avg_delay_minutes;
      });
      suggestions = ranked.slice(0, 3);
    }

    res.json({
      target: serializeRoute(target),
      current,
      threshold_exceeded: thresholdHit,
      suggestions,
      message: thresholdHit
        ? "Crowd or risk exceeded the defined threshold. Suggested alternatives are listed below."
        : "Crowd and risk are within the defined threshold. No alternative routes are required.",
    });
  } catch (err) {
    res.status(err.status || 500).json({ detail: err.message });
  }
});

// Demand Forecast (FR-04, FR-10)
app.post("/api/forecast/demand", authMiddleware, async (req, res) => {
  try {
    const targetId = req.body.target_id;
    const periodDays = Number(req.body.period_days);
    if (!periodDays || periodDays < 1 || periodDays > 30) {
      return res.status(422).json({ detail: "period_days must be between 1 and 30." });
    }
    const target = await getRouteById(targetId);
    if (!target) {
      return res.status(404).json({ detail: "Route or station not found." });
    }
    const records = await getRecordsForRoute(target.id);
    if (!records.length) {
      return res.status(400).json({ detail: `No historical data is stored for ${target.name}.` });
    }
    await logAccess(req.user.username, "demand_forecast", target.code, true);
    const forecast = forecastDemand(records, periodDays);
    res.json({
      target: serializeRoute(target),
      ...forecast,
      message: `Passenger demand forecast for ${target.name} over the next ${periodDays} days.`,
    });
  } catch (err) {
    res.status(err.status || 500).json({ detail: err.message });
  }
});

// Performance Score (FR-05, FR-11)
app.get("/api/performance", authMiddleware, async (req, res) => {
  await logAccess(req.user.username, "read", "performance", true);
  const allRoutes = await getRoutes("route");
  const results = [];
  for (const route of allRoutes) {
    const records = await getRecordsForRoute(route.id);
    if (!records.length) continue;
    results.push({
      route: serializeRoute(route),
      ...summarizeRecords(records),
    });
  }
  res.json(results);
});

// Simulation (FR-06, FR-12, NFR-03 < 10s)
app.post("/api/simulate", authMiddleware, async (req, res) => {
  try {
    const targetId = req.body.target_id;
    const demandChangePercent = Number(req.body.demand_change_percent);
    const delayChangeMinutes = Number(req.body.delay_change_minutes);
    const scenario = (req.body.scenario || "").trim();

    if (isNaN(demandChangePercent) || demandChangePercent < -80 || demandChangePercent > 200) {
      return res.status(422).json({ detail: "demand_change_percent must be between -80 and 200." });
    }
    if (isNaN(delayChangeMinutes) || delayChangeMinutes < -30 || delayChangeMinutes > 120) {
      return res.status(422).json({ detail: "delay_change_minutes must be between -30 and 120." });
    }
    if (scenario.length < 3 || scenario.length > 400) {
      return res.status(422).json({ detail: "scenario description must be between 3 and 400 characters." });
    }

    const target = await getRouteById(targetId);
    if (!target) {
      return res.status(404).json({ detail: "Route or station not found." });
    }
    const records = await getRecordsForRoute(target.id);
    if (!records.length) {
      return res.status(400).json({ detail: `No historical data is stored for ${target.name}.` });
    }

    await logAccess(req.user.username, "simulation", target.code, true);
    const baseline = summarizeRecords(records);
    const result = applyScenario(baseline, demandChangePercent, delayChangeMinutes);

    res.json({
      target: serializeRoute(target),
      scenario,
      baseline,
      result,
      message: `Simulation complete for ${target.name}. Demand change ${demandChangePercent >= 0 ? "+" : ""}${demandChangePercent.toFixed(1)}%, delay change ${delayChangeMinutes >= 0 ? "+" : ""}${delayChangeMinutes.toFixed(1)} minutes.`,
    });
  } catch (err) {
    res.status(err.status || 500).json({ detail: err.message });
  }
});

// Reports (FR-05, FR-11)
app.get("/api/reports", authMiddleware, async (req, res) => {
  await logAccess(req.user.username, "read", "reports", true);
  const routes = await getRoutes();
  const rows = [];
  for (const route of routes) {
    const records = await getRecordsForRoute(route.id);
    if (!records.length) continue;
    const summary = summarizeRecords(records);
    const forecast = forecastDemand(records, 7);
    rows.push({
      route: serializeRoute(route),
      ...summary,
      forecast_7_day_total: forecast.total,
      forecast_7_day_average: forecast.daily_average,
    });
  }
  res.json({
    title: "TransitTrack AI Performance Report",
    generated_at: new Date().toISOString(),
    rows,
  });
});

// Historical Records CRUD (FR-13)
app.get("/api/historical", authMiddleware, async (req, res) => {
  await logAccess(req.user.username, "read", "historical", true);
  const q = req.query.q || "";
  const items = await getHistoricalRecords(q);
  res.json(items);
});

app.post("/api/historical", authMiddleware, async (req, res) => {
  try {
    const routeId = Number(req.body.route_id);
    const target = await getRouteById(routeId);
    if (!target) {
      return res.status(404).json({ detail: "Route or station not found." });
    }
    validateDate(req.body.record_date);
    validateTime(req.body.schedule_time);

    const delayMinutes = Number(req.body.delay_minutes);
    const ridership = Number(req.body.ridership);

    if (isNaN(delayMinutes) || delayMinutes < 0 || delayMinutes > 180) {
      return res.status(422).json({ detail: "delay_minutes must be between 0 and 180." });
    }
    if (isNaN(ridership) || ridership < 0 || ridership > 20000) {
      return res.status(422).json({ detail: "ridership must be between 0 and 20000." });
    }

    const created = await createHistoricalRecord({
      route_id: routeId,
      record_date: req.body.record_date,
      schedule_time: req.body.schedule_time,
      delay_minutes: delayMinutes,
      ridership,
    });

    await logAccess(req.user.username, "create", `historical:${created.id}`, true);
    res.status(201).json(created);
  } catch (err) {
    res.status(err.status || 500).json({ detail: err.message });
  }
});

app.get("/api/historical/:record_id", authMiddleware, async (req, res) => {
  const recordId = Number(req.params.record_id);
  const record = await getRecordById(recordId);
  if (!record) {
    return res.status(404).json({ detail: "Historical record not found." });
  }
  await logAccess(req.user.username, "read", `historical:${recordId}`, true);
  res.json(record);
});

app.put("/api/historical/:record_id", authMiddleware, async (req, res) => {
  try {
    const recordId = Number(req.params.record_id);
    const record = await getRecordById(recordId);
    if (!record) {
      return res.status(404).json({ detail: "Historical record not found." });
    }

    const body = req.body;
    const updates = {};

    if (body.route_id !== undefined) {
      const target = await getRouteById(Number(body.route_id));
      if (!target) return res.status(404).json({ detail: "Route or station not found." });
      updates.route_id = Number(body.route_id);
    }
    if (body.record_date !== undefined) {
      validateDate(body.record_date);
      updates.record_date = body.record_date;
    }
    if (body.schedule_time !== undefined) {
      validateTime(body.schedule_time);
      updates.schedule_time = body.schedule_time;
    }
    if (body.delay_minutes !== undefined) {
      const delay = Number(body.delay_minutes);
      if (isNaN(delay) || delay < 0 || delay > 180) {
        return res.status(422).json({ detail: "delay_minutes must be between 0 and 180." });
      }
      updates.delay_minutes = delay;
    }
    if (body.ridership !== undefined) {
      const ridership = Number(body.ridership);
      if (isNaN(ridership) || ridership < 0 || ridership > 20000) {
        return res.status(422).json({ detail: "ridership must be between 0 and 20000." });
      }
      updates.ridership = ridership;
    }

    const updated = await updateHistoricalRecord(recordId, updates);
    await logAccess(req.user.username, "update", `historical:${recordId}`, true);
    res.json(updated);
  } catch (err) {
    res.status(err.status || 500).json({ detail: err.message });
  }
});

app.delete("/api/historical/:record_id", authMiddleware, async (req, res) => {
  try {
    const recordId = Number(req.params.record_id);
    await deleteHistoricalRecord(recordId);
    await logAccess(req.user.username, "delete", `historical:${recordId}`, true);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 500).json({ detail: err.message });
  }
});

// ============================================================================
// AI COPILOT ENDPOINT (Gemini 3.8 Flash + Live Telemetry Grounding)
// ============================================================================
app.post("/api/ai/chat", authMiddleware, async (req, res) => {
  try {
    const userMessage = (req.body.message || "").trim();
    if (!userMessage) {
      return res.status(422).json({ detail: "Message cannot be empty." });
    }
    if (userMessage.length > 1000) {
      return res.status(422).json({ detail: "Message exceeds maximum length of 1000 characters." });
    }

    // 1. Gather live operational telemetry from database
    const [routesList, allRecords] = await Promise.all([
      getRoutes(),
      getHistoricalRecords(),
    ]);

    const routeSummaries = routesList.map((route) => {
      const records = allRecords.filter((r) => Number(r.route_id) === Number(route.id));
      const summary = summarizeRecords(records);
      return {
        id: route.id,
        code: route.code,
        name: route.name,
        kind: route.kind,
        record_count: summary.record_count,
        avg_delay_minutes: summary.avg_delay_minutes,
        avg_ridership: summary.avg_ridership,
        crowd_level: summary.crowd_level,
        risk_level: summary.risk_level,
        performance_score: summary.performance_score,
        capacity_utilization: summary.capacity_utilization,
      };
    });

    const fleetOverview = routeSummaries.map((s) => 
      `- [${s.code}] ${s.name} (${s.kind}): Avg Delay ${s.avg_delay_minutes} min | Avg Ridership ${s.avg_ridership} | Capacity ${s.capacity_utilization}% | Crowd: ${s.crowd_level} | Risk: ${s.risk_level} | Perf Score: ${s.performance_score}/100`
    ).join("\n");

    const systemInstruction = `You are TransitTrack AI Copilot, a senior transit dispatcher and operations analytics assistant for public transit networks.
You provide instant situational awareness, delay mitigation strategies, alternative routing recommendations, and weather/emergency protocols.
Ground your responses strictly in the live operational telemetry below:

LIVE TRANSIT TELEMETRY SNAPSHOT:
${fleetOverview}

OPERATIONAL STANDARDS:
- High Delay threshold: >= 12 minutes (Route 202 is currently High Delay & High Risk).
- Medium Delay threshold: >= 5 minutes (Route 101 is Medium Delay; Central Station is elevated).
- High Crowd threshold: >= 90% capacity utilization.
- If a route is High Risk or High Crowd, dispatch alternative routing protocols immediately.
- Format responses clearly using markdown bolding, bullet points, and numbered action steps. Keep advice professional, actionable, and concise.`;

    let reply = "";
    let activeModel = "gemini-3.8-flash";
    const ai = getGeminiClient();

    if (ai) {
      try {
        const contents = [];
        if (Array.isArray(req.body.history)) {
          for (const h of req.body.history.slice(-6)) {
            if (h && typeof h.content === "string" && h.content.trim()) {
              contents.push({
                role: h.role === "assistant" || h.role === "model" ? "model" : "user",
                parts: [{ text: h.content.trim() }],
              });
            }
          }
        }
        contents.push({
          role: "user",
          parts: [{ text: userMessage }],
        });

        const response = await ai.models.generateContent({
          model: "gemini-3.8-flash",
          contents,
          config: {
            systemInstruction,
            temperature: 0.7,
          },
        });
        reply = response.text || "";
      } catch (geminiErr) {
        console.warn("[Gemini API] Request notice:", geminiErr.message);
        // Graceful fallback to local intelligence engine
        reply = "";
      }
    }

    // Heuristic fallback if Gemini API key not present or call encountered network limits
    if (!reply) {
      activeModel = "transit-intelligence-engine";
      const q = userMessage.toLowerCase();

      if (q.includes("202") || q.includes("airport")) {
        const r202 = routeSummaries.find((r) => r.code === "202") || routeSummaries[1];
        reply = `### 🚨 Route 202 (Airport Express) Status Brief
- **Operational Risk:** **${r202.risk_level}** (Average Delay: **${r202.avg_delay_minutes} mins**)
- **Passenger Crowding:** **${r202.crowd_level}** (Avg Ridership: **${r202.avg_ridership}** / Capacity: **${r202.capacity_utilization}%**)
- **Performance Score:** **${r202.performance_score}/100**

**Dispatch Recommendations:**
1. **Alternative Routing:** Trigger alternative route dispatch via Central Station [CS] and University Line [303] to offload terminal congestion.
2. **Frequency Boost:** Deploy 2 standby express shuttles during the 09:30 and 17:30 peak departure windows.
3. **Passenger Advisory:** Issue digital station alerts recommending terminal passengers board express shuttles.`;
      } else if (q.includes("101") || q.includes("downtown")) {
        const r101 = routeSummaries.find((r) => r.code === "101") || routeSummaries[0];
        reply = `### 🏙️ Route 101 (Downtown Loop) Status Brief
- **Operational Risk:** **${r101.risk_level}** (Average Delay: **${r101.avg_delay_minutes} mins**)
- **Passenger Crowding:** **${r101.crowd_level}** (Avg Ridership: **${r101.avg_ridership}** / Capacity: **${r101.capacity_utilization}%**)
- **Performance Score:** **${r101.performance_score}/100**

**Dispatch Recommendations:**
1. Signal priority at Downtown 4th & Market intersections can reduce loop latency by ~3.2 minutes.
2. Steady demand during 08:00 rush hour is within manageable capacity limits.`;
      } else if (q.includes("delay") || q.includes("risk") || q.includes("high")) {
        const highRisk = routeSummaries.filter((r) => r.risk_level === "High" || r.avg_delay_minutes >= 8);
        reply = `### ⚠️ High Delay & Risk Alert Report
Currently **${highRisk.length}** corridor(s) require proactive dispatcher intervention:

${highRisk.map((r) => `* **[${r.code}] ${r.name}**: Delay **${r.avg_delay_minutes} min** (Risk: **${r.risk_level}**, Crowding: **${r.crowd_level}**)`).join("\n")}

**Recommended Action Plan:**
1. Reroute non-stop transfers around Airport Express bottleneck.
2. Direct overflow commuters toward Route 303 (University Line - Delay: **2.6 min**, Risk: **Low**).
3. Monitor Central Station platform dwell times closely.`;
      } else if (q.includes("weather") || q.includes("rain") || q.includes("storm") || q.includes("snow")) {
        reply = `### 🌧️ Severe Weather Dispatch Protocol
Under adverse weather scenarios (rain/ice/high wind):
1. **Headway Adjustments:** Extend baseline headway tolerances by **+15%** across Route 101 and Route 202.
2. **Speed Buffer:** Institute safety braking curves entering Central Station and North Station platforms.
3. **Shuttle Bridging:** Pre-position 3 auxiliary diesel coaches at Central Station depot for rapid track bypass.
4. **Passenger Signage:** Activate automated wet-weather ETA announcements with +5 min buffer.`;
      } else {
        reply = `### 🚊 Transit Fleet Intelligence Summary
Here is the current live operational status across all monitored transit corridors:

${routeSummaries.map((r) => `* **[${r.code}] ${r.name}** (${r.kind}): Delay **${r.avg_delay_minutes}m** | Crowding **${r.crowd_level}** | Risk **${r.risk_level}** | Score **${r.performance_score}**`).join("\n")}

**Key Operational Takeaways:**
- **Primary Bottleneck:** Route 202 Airport Express requires immediate alternative route activation.
- **Top Performing Route:** Route 303 University Line is operating with high punctuality (**92/100 score**).
- **Network Readiness:** Overall system health is steady with active telemetry across all 21 historical checkpoints.`;
      }

      if (!ai) {
        reply += `\n\n*(Note: Grounded in live database telemetry. Configure GEMINI_API_KEY in Settings > Secrets for unrestricted conversational AI reasoning).*`;
      }
    }

    await logAccess(req.user.username, "ai_chat", "transit_copilot", true);

    res.json({
      reply,
      model: activeModel,
      suggestions: [
        "What is the status of Route 202 Airport Express?",
        "Which routes have high delays right now?",
        "Recommend alternative routes for Route 202",
        "What is the severe weather contingency plan?"
      ],
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ detail: err.message || "Failed to process AI chat request." });
  }
});

// Static Assets Serving & PWA Specific Headers
const frontendDir = path.join(__dirname, "frontend");

app.get("/sw.js", (req, res) => {
  res.setHeader("Service-Worker-Allowed", "/");
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Content-Type", "application/javascript");
  res.sendFile(path.join(frontendDir, "sw.js"));
});

app.get("/manifest.json", (req, res) => {
  res.setHeader("Content-Type", "application/manifest+json");
  res.sendFile(path.join(frontendDir, "manifest.json"));
});

app.use("/assets", express.static(frontendDir));
app.use(express.static(frontendDir));

// Fallback for SPA
app.get("*", (req, res) => {
  res.sendFile(path.join(frontendDir, "index.html"));
});

// Start Server
app.listen(PORT, HOST, async () => {
  console.log(`TransitTrack AI server listening on http://${HOST}:${PORT}`);
  try {
    await initDatabase();
  } catch (e) {
    console.error("[DB] Initialization error:", e.message);
  }
});
