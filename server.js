import express from "express";
import cors from "cors";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const HOST = "0.0.0.0";
const SECRET_KEY = process.env.TRANSITTRACK_SECRET || "transittrack-ai-local-secret";
const TOKEN_TTL_SECONDS = 60 * 60 * 12; // 12 hours
const PBKDF2_ITERATIONS = 120000;

// Analytics constants
const CROWD_CAPACITY = 1600;
const CROWD_HIGH_RATIO = 0.90;
const CROWD_MODERATE_RATIO = 0.70;
const RISK_HIGH_DELAY = 12;
const RISK_MEDIUM_DELAY = 5;
const ALT_CROWD_THRESHOLD = "High";
const ALT_RISK_THRESHOLD = ["Medium", "High"];

// Password hashing & verification
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const digest = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, "sha256");
  return `${salt.toString("hex")}$${digest.toString("hex")}`;
}

function verifyPassword(password, stored) {
  try {
    const [saltHex, digestHex] = stored.split("$");
    if (!saltHex || !digestHex) return false;
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(digestHex, "hex");
    const actual = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, expected.length, "sha256");
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

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

// In-memory Database
const users = [
  {
    id: 1,
    username: "admin",
    password_hash: hashPassword("transit123"),
    created_at: new Date().toISOString(),
  },
];

const routes = [
  { id: 1, code: "101", name: "Route 101 - Downtown Loop", kind: "route" },
  { id: 2, code: "202", name: "Route 202 - Airport Express", kind: "route" },
  { id: 3, code: "303", name: "Route 303 - University Line", kind: "route" },
  { id: 4, code: "CS", name: "Central Station", kind: "station" },
  { id: 5, code: "NS", name: "North Station", kind: "station" },
];

let nextRecordId = 1;
const rawHistory = [
  { route_code: "101", record_date: "2026-08-25", schedule_time: "08:00", delay_minutes: 5, ridership: 1120 },
  { route_code: "101", record_date: "2026-08-26", schedule_time: "08:00", delay_minutes: 4, ridership: 1180 },
  { route_code: "101", record_date: "2026-08-27", schedule_time: "13:00", delay_minutes: 7, ridership: 1250 },
  { route_code: "101", record_date: "2026-08-28", schedule_time: "17:30", delay_minutes: 6, ridership: 1310 },
  { route_code: "101", record_date: "2026-08-29", schedule_time: "08:00", delay_minutes: 5, ridership: 1205 },
  { route_code: "202", record_date: "2026-08-25", schedule_time: "09:30", delay_minutes: 12, ridership: 1480 },
  { route_code: "202", record_date: "2026-08-26", schedule_time: "09:30", delay_minutes: 14, ridership: 1520 },
  { route_code: "202", record_date: "2026-08-27", schedule_time: "17:30", delay_minutes: 15, ridership: 1620 },
  { route_code: "202", record_date: "2026-08-28", schedule_time: "09:30", delay_minutes: 11, ridership: 1490 },
  { route_code: "202", record_date: "2026-08-29", schedule_time: "17:30", delay_minutes: 16, ridership: 1680 },
  { route_code: "303", record_date: "2026-08-25", schedule_time: "10:00", delay_minutes: 3, ridership: 920 },
  { route_code: "303", record_date: "2026-08-26", schedule_time: "10:00", delay_minutes: 2, ridership: 880 },
  { route_code: "303", record_date: "2026-08-27", schedule_time: "16:00", delay_minutes: 4, ridership: 970 },
  { route_code: "303", record_date: "2026-08-28", schedule_time: "10:00", delay_minutes: 3, ridership: 910 },
  { route_code: "303", record_date: "2026-08-29", schedule_time: "16:00", delay_minutes: 1, ridership: 860 },
  { route_code: "CS", record_date: "2026-08-27", schedule_time: "08:15", delay_minutes: 8, ridership: 1410 },
  { route_code: "CS", record_date: "2026-08-28", schedule_time: "08:15", delay_minutes: 9, ridership: 1460 },
  { route_code: "CS", record_date: "2026-08-29", schedule_time: "18:00", delay_minutes: 10, ridership: 1510 },
  { route_code: "NS", record_date: "2026-08-27", schedule_time: "07:45", delay_minutes: 4, ridership: 780 },
  { route_code: "NS", record_date: "2026-08-28", schedule_time: "07:45", delay_minutes: 3, ridership: 740 },
  { route_code: "NS", record_date: "2026-08-29", schedule_time: "18:20", delay_minutes: 5, ridership: 810 },
];

const historicalRecords = rawHistory.map((item) => {
  const r = routes.find((route) => route.code === item.route_code);
  return {
    id: nextRecordId++,
    route_id: r ? r.id : 1,
    record_date: item.record_date,
    schedule_time: item.schedule_time,
    delay_minutes: item.delay_minutes,
    ridership: item.ridership,
    created_at: new Date().toISOString(),
  };
});

const accessLogs = [];

function logAccess(username, action, resource, success = true) {
  accessLogs.push({
    id: accessLogs.length + 1,
    username: username || "anonymous",
    action,
    resource,
    success,
    timestamp: new Date().toISOString(),
  });
}

function serializeRoute(route) {
  return {
    id: route.id,
    code: route.code,
    name: route.name,
    kind: route.kind,
  };
}

function serializeRecord(record) {
  const route = routes.find((r) => r.id === record.route_id);
  return {
    id: record.id,
    route_id: record.route_id,
    route_code: route ? route.code : "",
    route_name: route ? route.name : "",
    record_date: record.record_date,
    schedule_time: record.schedule_time,
    delay_minutes: record.delay_minutes,
    ridership: record.ridership,
  };
}

function getTarget(targetId) {
  const target = routes.find((r) => r.id === Number(targetId));
  if (!target) {
    const error = new Error("Route or station not found.");
    error.status = 404;
    throw error;
  }
  return target;
}

function recordsFor(targetId) {
  return historicalRecords.filter((r) => r.route_id === Number(targetId));
}

function requireRecords(target) {
  const recs = recordsFor(target.id);
  if (!recs.length) {
    const error = new Error(`No historical data is stored for ${target.name}.`);
    error.status = 400;
    throw error;
  }
  return recs;
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
  const delays = records.map((r) => r.delay_minutes);
  const riders = records.map((r) => r.ridership);
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
    if (!byDate[record.record_date]) byDate[record.record_date] = [];
    byDate[record.record_date].push(record.ridership);
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

// Validation Helpers
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

// Auth Middleware
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    logAccess("anonymous", "auth_required", "protected", false);
    return res.status(401).json({ detail: "Login required." });
  }
  const token = authHeader.substring(7).trim();
  try {
    const username = decodeToken(token);
    const user = users.find((u) => u.username === username);
    if (!user) {
      logAccess(username, "auth_required", "protected", false);
      return res.status(401).json({ detail: "Login required." });
    }
    req.user = user;
    next();
  } catch (err) {
    logAccess("anonymous", "auth_required", "protected", false);
    return res.status(401).json({ detail: err.message || "Invalid token." });
  }
}

// API Routes

// Health Check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// Login
app.post("/api/auth/login", (req, res) => {
  const username = (req.body.username || "").trim();
  const password = req.body.password || "";

  if (password.length < 8) {
    logAccess(username, "login", "auth", false);
    return res.status(400).json({ detail: "Password must be at least 8 characters." });
  }

  const user = users.find((u) => u.username === username);
  if (!user || !verifyPassword(password, user.password_hash)) {
    logAccess(username, "login", "auth", false);
    return res.status(401).json({ detail: "Invalid username or password." });
  }

  logAccess(username, "login", "auth", true);
  res.json({
    token: createToken(user.username),
    username: user.username,
  });
});

// Current User
app.get("/api/auth/me", authMiddleware, (req, res) => {
  logAccess(req.user.username, "read", "auth:me");
  res.json({ username: req.user.username });
});

// List Routes
app.get("/api/routes", authMiddleware, (req, res) => {
  logAccess(req.user.username, "read", "routes");
  const kind = req.query.kind;
  let list = routes;
  if (kind) {
    list = list.filter((r) => r.kind === kind);
  }
  res.json(list.map(serializeRoute));
});

// Search
app.get("/api/search", authMiddleware, (req, res) => {
  const q = (req.query.q || "").trim().toLowerCase();
  logAccess(req.user.username, "search", q || "blank");
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

  const matchedRecords = historicalRecords
    .map(serializeRecord)
    .filter((record) => {
      const blob = [
        record.route_code,
        record.route_name,
        record.record_date,
        record.schedule_time,
        String(record.delay_minutes),
        String(record.ridership),
      ]
        .join(" ")
        .toLowerCase();
      return blob.includes(q);
    })
    .slice(0, 25);

  res.json({ routes: matchedRoutes, records: matchedRecords });
});

// Dashboard
app.get("/api/dashboard", authMiddleware, (req, res) => {
  logAccess(req.user.username, "read", "dashboard");
  const overview = [];
  const crowdCounts = { Low: 0, Moderate: 0, High: 0 };
  const scores = [];
  let demandTotal = 0;

  for (const route of routes) {
    const records = recordsFor(route.id);
    if (!records.length) continue;
    const summary = summarizeRecords(records);
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
    demand_sample: overview.length ? Math.round(demandTotal / overview.length) : 0,
    headline: sample,
    overview,
  });
});

// Predict Crowd
app.post("/api/predict/crowd", authMiddleware, (req, res) => {
  try {
    const targetId = req.body.target_id;
    const target = getTarget(targetId);
    const records = requireRecords(target);
    logAccess(req.user.username, "crowd_prediction", target.code);
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

// Predict Risk
app.post("/api/predict/risk", authMiddleware, (req, res) => {
  try {
    const targetId = req.body.target_id;
    const target = getTarget(targetId);
    const records = requireRecords(target);
    logAccess(req.user.username, "route_risk", target.code);
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

// Alternative Routes
app.post("/api/alternatives", authMiddleware, (req, res) => {
  try {
    const targetId = req.body.target_id;
    const target = getTarget(targetId);
    const records = requireRecords(target);
    logAccess(req.user.username, "alternatives", target.code);
    const current = summarizeRecords(records);
    const thresholdHit = needsAlternatives(current.crowd_level, current.risk_level);
    let suggestions = [];

    if (thresholdHit) {
      let others = routes.filter((r) => r.id !== target.id && r.kind === target.kind);
      if (!others.length) {
        others = routes.filter((r) => r.id !== target.id);
      }
      const ranked = [];
      for (const route of others) {
        const otherRecords = recordsFor(route.id);
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

// Demand Forecast
app.post("/api/forecast/demand", authMiddleware, (req, res) => {
  try {
    const targetId = req.body.target_id;
    const periodDays = Number(req.body.period_days);
    if (!periodDays || periodDays < 1 || periodDays > 30) {
      return res.status(422).json({ detail: "period_days must be between 1 and 30." });
    }
    const target = getTarget(targetId);
    const records = requireRecords(target);
    logAccess(req.user.username, "demand_forecast", target.code);
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

// Performance
app.get("/api/performance", authMiddleware, (req, res) => {
  logAccess(req.user.username, "read", "performance");
  const results = [];
  const activeRoutes = routes.filter((r) => r.kind === "route");
  for (const route of activeRoutes) {
    const records = recordsFor(route.id);
    if (!records.length) continue;
    results.push({
      route: serializeRoute(route),
      ...summarizeRecords(records),
    });
  }
  res.json(results);
});

// Simulation
app.post("/api/simulate", authMiddleware, (req, res) => {
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

    const target = getTarget(targetId);
    const records = requireRecords(target);
    logAccess(req.user.username, "simulation", target.code);
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

// Reports
app.get("/api/reports", authMiddleware, (req, res) => {
  logAccess(req.user.username, "read", "reports");
  const rows = [];
  for (const route of routes) {
    const records = recordsFor(route.id);
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

// Historical Records CRUD
app.get("/api/historical", authMiddleware, (req, res) => {
  logAccess(req.user.username, "read", "historical");
  const q = (req.query.q || "").trim().toLowerCase();
  const sorted = [...historicalRecords].sort((a, b) => {
    if (b.record_date !== a.record_date) {
      return b.record_date.localeCompare(a.record_date);
    }
    return b.id - a.id;
  });

  let items = sorted.map(serializeRecord);
  if (q) {
    items = items.filter((item) =>
      Object.values(item).some((v) => String(v).toLowerCase().includes(q))
    );
  }
  res.json(items);
});

app.post("/api/historical", authMiddleware, (req, res) => {
  try {
    const routeId = Number(req.body.route_id);
    getTarget(routeId);
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

    const record = {
      id: nextRecordId++,
      route_id: routeId,
      record_date: req.body.record_date,
      schedule_time: req.body.schedule_time,
      delay_minutes: delayMinutes,
      ridership,
      created_at: new Date().toISOString(),
    };
    historicalRecords.push(record);
    logAccess(req.user.username, "create", `historical:${record.id}`);
    res.status(201).json(serializeRecord(record));
  } catch (err) {
    res.status(err.status || 500).json({ detail: err.message });
  }
});

app.get("/api/historical/:record_id", authMiddleware, (req, res) => {
  const recordId = Number(req.params.record_id);
  const record = historicalRecords.find((r) => r.id === recordId);
  if (!record) {
    return res.status(404).json({ detail: "Historical record not found." });
  }
  logAccess(req.user.username, "read", `historical:${recordId}`);
  res.json(serializeRecord(record));
});

app.put("/api/historical/:record_id", authMiddleware, (req, res) => {
  try {
    const recordId = Number(req.params.record_id);
    const record = historicalRecords.find((r) => r.id === recordId);
    if (!record) {
      return res.status(404).json({ detail: "Historical record not found." });
    }

    const body = req.body;
    if (body.route_id !== undefined) {
      getTarget(Number(body.route_id));
      record.route_id = Number(body.route_id);
    }
    if (body.record_date !== undefined) {
      validateDate(body.record_date);
      record.record_date = body.record_date;
    }
    if (body.schedule_time !== undefined) {
      validateTime(body.schedule_time);
      record.schedule_time = body.schedule_time;
    }
    if (body.delay_minutes !== undefined) {
      const delay = Number(body.delay_minutes);
      if (isNaN(delay) || delay < 0 || delay > 180) {
        return res.status(422).json({ detail: "delay_minutes must be between 0 and 180." });
      }
      record.delay_minutes = delay;
    }
    if (body.ridership !== undefined) {
      const ridership = Number(body.ridership);
      if (isNaN(ridership) || ridership < 0 || ridership > 20000) {
        return res.status(422).json({ detail: "ridership must be between 0 and 20000." });
      }
      record.ridership = ridership;
    }

    logAccess(req.user.username, "update", `historical:${record.id}`);
    res.json(serializeRecord(record));
  } catch (err) {
    res.status(err.status || 500).json({ detail: err.message });
  }
});

app.delete("/api/historical/:record_id", authMiddleware, (req, res) => {
  const recordId = Number(req.params.record_id);
  const index = historicalRecords.findIndex((r) => r.id === recordId);
  if (index === -1) {
    return res.status(404).json({ detail: "Historical record not found." });
  }
  historicalRecords.splice(index, 1);
  logAccess(req.user.username, "delete", `historical:${recordId}`);
  res.json({ ok: true });
});

// Static Assets Serving
const frontendDir = path.join(__dirname, "frontend");
app.use("/assets", express.static(frontendDir));
app.use(express.static(frontendDir));

// Fallback for SPA
app.get("*", (req, res) => {
  res.sendFile(path.join(frontendDir, "index.html"));
});

// Start Server
app.listen(PORT, HOST, () => {
  console.log(`TransitTrack AI server listening on http://${HOST}:${PORT}`);
});
