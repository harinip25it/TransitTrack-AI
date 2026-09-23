import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import crypto from "crypto";

const { Pool } = pg;

export const PBKDF2_ITERATIONS = 120000;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const digest = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, "sha256");
  return `${salt.toString("hex")}$${digest.toString("hex")}`;
}

export function verifyPassword(password, stored) {
  try {
    const [saltHex, digestHex] = (stored || "").split("$");
    if (!saltHex || !digestHex) return false;
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(digestHex, "hex");
    const actual = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, expected.length, "sha256");
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

// Seed data definitions to migrate or fallback
// transit123 default password hash
const DEFAULT_PASSWORD_HASH = "46671371cb6c0288fc5f9a97afaf266e$d0ff549974acd35005f0355735faf15882b170aae4fd03de244dcc7845527d28";

export const SEED_ROUTES = [
  { id: 1, code: "101", name: "Route 101 - Downtown Loop", kind: "route" },
  { id: 2, code: "202", name: "Route 202 - Airport Express", kind: "route" },
  { id: 3, code: "303", name: "Route 303 - University Line", kind: "route" },
  { id: 4, code: "CS", name: "Central Station", kind: "station" },
  { id: 5, code: "NS", name: "North Station", kind: "station" },
];

export const SEED_RECORDS = [
  { id: 1, route_id: 1, record_date: "2026-08-25", schedule_time: "08:00", delay_minutes: 5, ridership: 1120 },
  { id: 2, route_id: 1, record_date: "2026-08-26", schedule_time: "08:00", delay_minutes: 4, ridership: 1180 },
  { id: 3, route_id: 1, record_date: "2026-08-27", schedule_time: "13:00", delay_minutes: 7, ridership: 1250 },
  { id: 4, route_id: 1, record_date: "2026-08-28", schedule_time: "17:30", delay_minutes: 6, ridership: 1310 },
  { id: 5, route_id: 1, record_date: "2026-08-29", schedule_time: "08:00", delay_minutes: 5, ridership: 1205 },
  { id: 6, route_id: 2, record_date: "2026-08-25", schedule_time: "09:30", delay_minutes: 12, ridership: 1480 },
  { id: 7, route_id: 2, record_date: "2026-08-26", schedule_time: "09:30", delay_minutes: 14, ridership: 1520 },
  { id: 8, route_id: 2, record_date: "2026-08-27", schedule_time: "17:30", delay_minutes: 15, ridership: 1620 },
  { id: 9, route_id: 2, record_date: "2026-08-28", schedule_time: "09:30", delay_minutes: 11, ridership: 1490 },
  { id: 10, route_id: 2, record_date: "2026-08-29", schedule_time: "17:30", delay_minutes: 16, ridership: 1680 },
  { id: 11, route_id: 3, record_date: "2026-08-25", schedule_time: "10:00", delay_minutes: 3, ridership: 920 },
  { id: 12, route_id: 3, record_date: "2026-08-26", schedule_time: "10:00", delay_minutes: 2, ridership: 880 },
  { id: 13, route_id: 3, record_date: "2026-08-27", schedule_time: "16:00", delay_minutes: 4, ridership: 970 },
  { id: 14, route_id: 3, record_date: "2026-08-28", schedule_time: "10:00", delay_minutes: 3, ridership: 910 },
  { id: 15, route_id: 3, record_date: "2026-08-29", schedule_time: "16:00", delay_minutes: 1, ridership: 860 },
  { id: 16, route_id: 4, record_date: "2026-08-27", schedule_time: "08:15", delay_minutes: 8, ridership: 1410 },
  { id: 17, route_id: 4, record_date: "2026-08-28", schedule_time: "08:15", delay_minutes: 9, ridership: 1460 },
  { id: 18, route_id: 4, record_date: "2026-08-29", schedule_time: "18:00", delay_minutes: 10, ridership: 1510 },
  { id: 19, route_id: 5, record_date: "2026-08-27", schedule_time: "07:45", delay_minutes: 4, ridership: 780 },
  { id: 20, route_id: 5, record_date: "2026-08-28", schedule_time: "07:45", delay_minutes: 3, ridership: 740 },
  { id: 21, route_id: 5, record_date: "2026-08-29", schedule_time: "18:20", delay_minutes: 5, ridership: 810 },
];

export const SEED_USERS = [
  {
    id: 1,
    username: "admin",
    password_hash: DEFAULT_PASSWORD_HASH,
    role: "dispatcher",
  },
];

// Local standby memory store (keeps app 100% resilient before or between Supabase connections)
let localUsers = [...SEED_USERS];
let localRoutes = [...SEED_ROUTES];
let localRecords = [...SEED_RECORDS];
let localLogs = [];
let nextLocalRecordId = 22;

// Supabase client instance & PG Pool (lazy loaded)
let supabaseClient = null;
let pgPool = null;
let isInitialized = false;
let databaseProvider = "standby"; // "supabase_js" | "supabase_pg" | "standby"

export function getDatabaseStatus() {
  return {
    provider: databaseProvider,
    connected: databaseProvider !== "standby",
    configured: Boolean(process.env.SUPABASE_URL || process.env.DATABASE_URL),
    routeCount: localRoutes.length,
    recordCount: localRecords.length,
    statusNote: databaseProvider === "supabase_pg"
      ? "Connected via Supabase Direct PostgreSQL"
      : databaseProvider === "supabase_js"
      ? "Connected via Supabase REST API"
      : "Operating on resilient local operational store (Supabase standby)",
  };
}

export async function initDatabase() {
  if (isInitialized) return;

  let supabaseUrl = (process.env.SUPABASE_URL || "").trim();
  if (supabaseUrl) {
    try {
      const parsed = new URL(supabaseUrl);
      supabaseUrl = parsed.origin;
    } catch (_) {}
  }
  const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || "").trim();
  const databaseUrl = (process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || "").trim();

  // 1. Try Direct PostgreSQL Connection to Supabase if DATABASE_URL is set
  if (databaseUrl) {
    try {
      console.log("[DB] Connecting to Supabase via PostgreSQL connection string...");
      pgPool = new Pool({
        connectionString: databaseUrl,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 5000,
      });

      // Test connection and auto-create tables
      await pgPool.query(`
        CREATE TABLE IF NOT EXISTS public.users (
          id BIGSERIAL PRIMARY KEY,
          username VARCHAR(64) NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          role VARCHAR(32) NOT NULL DEFAULT 'dispatcher',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS public.routes (
          id BIGSERIAL PRIMARY KEY,
          code VARCHAR(16) NOT NULL UNIQUE,
          name VARCHAR(128) NOT NULL,
          kind VARCHAR(32) NOT NULL CHECK (kind IN ('route', 'station')),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS public.historical_records (
          id BIGSERIAL PRIMARY KEY,
          route_id BIGINT NOT NULL REFERENCES public.routes(id) ON DELETE CASCADE,
          record_date DATE NOT NULL,
          schedule_time VARCHAR(8) NOT NULL,
          delay_minutes INTEGER NOT NULL CHECK (delay_minutes >= 0 AND delay_minutes <= 180),
          ridership INTEGER NOT NULL CHECK (ridership >= 0 AND ridership <= 20000),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS public.access_logs (
          id BIGSERIAL PRIMARY KEY,
          username VARCHAR(64) NOT NULL,
          action VARCHAR(64) NOT NULL,
          resource VARCHAR(128) NOT NULL,
          success BOOLEAN NOT NULL DEFAULT true,
          timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);

      // Seed if routes empty
      const routesCountRes = await pgPool.query("SELECT COUNT(*) FROM public.routes");
      const routesCount = parseInt(routesCountRes.rows[0].count, 10);
      if (routesCount === 0) {
        console.log("[DB] Migrating initial routes and records to Supabase PostgreSQL...");
        for (const u of SEED_USERS) {
          await pgPool.query(
            "INSERT INTO public.users (id, username, password_hash, role) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING",
            [u.id, u.username, u.password_hash, u.role]
          );
        }
        for (const r of SEED_ROUTES) {
          await pgPool.query(
            "INSERT INTO public.routes (id, code, name, kind) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING",
            [r.id, r.code, r.name, r.kind]
          );
        }
        for (const rec of SEED_RECORDS) {
          await pgPool.query(
            "INSERT INTO public.historical_records (id, route_id, record_date, schedule_time, delay_minutes, ridership) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING",
            [rec.id, rec.route_id, rec.record_date, rec.schedule_time, rec.delay_minutes, rec.ridership]
          );
        }
        await pgPool.query("SELECT setval('public.historical_records_id_seq', (SELECT MAX(id) FROM public.historical_records))");
      }

      databaseProvider = "supabase_pg";
      isInitialized = true;
      console.log("[DB] Successfully connected and migrated to Supabase PostgreSQL via pgPool.");
      return;
    } catch (pgErr) {
      console.warn(`[DB] Direct PostgreSQL connection notice (${pgErr.message}). Falling back to Supabase API / local store.`);
    }
  }

  // 2. Try Supabase REST Client if SUPABASE_URL & KEY are provided
  if (supabaseUrl && supabaseKey) {
    try {
      console.log(`[DB] Connecting to Supabase project at ${supabaseUrl}...`);
      supabaseClient = createClient(supabaseUrl, supabaseKey, {
        auth: { persistSession: false },
      });

      // Verify connection by reading routes
      const { data: remoteRoutes, error: routeError } = await supabaseClient.from("routes").select("*").limit(1);

      if (!routeError) {
        // Connected! Check if seed data exists
        const { count } = await supabaseClient.from("routes").select("*", { count: "exact", head: true });
        if (!count || count === 0) {
          console.log("[DB] Seeding Supabase database with initial routes and records...");
          await supabaseClient.from("users").upsert(SEED_USERS);
          await supabaseClient.from("routes").upsert(SEED_ROUTES);
          await supabaseClient.from("historical_records").upsert(SEED_RECORDS);
        }
        databaseProvider = "supabase_js";
        isInitialized = true;
        console.log("[DB] Successfully connected to Supabase project via @supabase/supabase-js.");
        return;
      } else {
        console.warn(`[DB] Supabase REST notice: ${routeError.message}. Operating on local store until database tables are provisioned via supabase/schema.sql.`);
      }
    } catch (sbErr) {
      console.warn("[DB] Supabase client initialization notice:", sbErr.message);
    }
  }

  // 3. Fallback to resilient in-memory data store with all SRS seed records
  console.log("[DB] Running on local in-memory store initialized with all 21 SRS records. Ready to connect to Supabase.");
  databaseProvider = "standby";
  isInitialized = true;
}

// User Methods
export async function findUserByUsername(username) {
  await initDatabase();

  if (databaseProvider === "supabase_pg" && pgPool) {
    const res = await pgPool.query("SELECT * FROM public.users WHERE username = $1 LIMIT 1", [username]);
    return res.rows[0] || null;
  }

  if (databaseProvider === "supabase_js" && supabaseClient) {
    const { data } = await supabaseClient.from("users").select("*").eq("username", username).single();
    return data || null;
  }

  return localUsers.find((u) => u.username === username) || null;
}

// Route Methods
export async function getRoutes(kind = null) {
  await initDatabase();

  if (databaseProvider === "supabase_pg" && pgPool) {
    let query = "SELECT * FROM public.routes ORDER BY id ASC";
    let params = [];
    if (kind) {
      query = "SELECT * FROM public.routes WHERE kind = $1 ORDER BY id ASC";
      params = [kind];
    }
    const res = await pgPool.query(query, params);
    return res.rows;
  }

  if (databaseProvider === "supabase_js" && supabaseClient) {
    let q = supabaseClient.from("routes").select("*").order("id", { ascending: true });
    if (kind) q = q.eq("kind", kind);
    const { data, error } = await q;
    if (!error && data) return data;
  }

  let list = localRoutes;
  if (kind) list = list.filter((r) => r.kind === kind);
  return list;
}

export async function getRouteById(id) {
  await initDatabase();
  const routeId = Number(id);

  if (databaseProvider === "supabase_pg" && pgPool) {
    const res = await pgPool.query("SELECT * FROM public.routes WHERE id = $1 LIMIT 1", [routeId]);
    return res.rows[0] || null;
  }

  if (databaseProvider === "supabase_js" && supabaseClient) {
    const { data } = await supabaseClient.from("routes").select("*").eq("id", routeId).single();
    return data || null;
  }

  return localRoutes.find((r) => r.id === routeId) || null;
}

// Historical Records Methods
export async function getHistoricalRecords(searchQuery = "") {
  await initDatabase();
  const routes = await getRoutes();
  const routeMap = new Map(routes.map((r) => [r.id, r]));

  let records = [];

  if (databaseProvider === "supabase_pg" && pgPool) {
    const res = await pgPool.query("SELECT * FROM public.historical_records ORDER BY record_date DESC, id DESC");
    records = res.rows;
  } else if (databaseProvider === "supabase_js" && supabaseClient) {
    const { data, error } = await supabaseClient
      .from("historical_records")
      .select("*")
      .order("record_date", { ascending: false })
      .order("id", { ascending: false });
    if (!error && data) records = data;
  } else {
    records = [...localRecords].sort((a, b) => {
      if (b.record_date !== a.record_date) return b.record_date.localeCompare(a.record_date);
      return b.id - a.id;
    });
  }

  const enriched = records.map((rec) => {
    const r = routeMap.get(Number(rec.route_id));
    return {
      id: Number(rec.id),
      route_id: Number(rec.route_id),
      route_code: r ? r.code : "",
      route_name: r ? r.name : "",
      record_date: typeof rec.record_date === "string" ? rec.record_date.slice(0, 10) : rec.record_date.toISOString().slice(0, 10),
      schedule_time: rec.schedule_time,
      delay_minutes: Number(rec.delay_minutes),
      ridership: Number(rec.ridership),
      created_at: rec.created_at,
    };
  });

  if (!searchQuery) return enriched;

  const q = searchQuery.toLowerCase().trim();
  return enriched.filter((item) =>
    [
      item.route_code,
      item.route_name,
      item.record_date,
      item.schedule_time,
      String(item.delay_minutes),
      String(item.ridership),
    ]
      .join(" ")
      .toLowerCase()
      .includes(q)
  );
}

export async function getRecordsForRoute(routeId) {
  const records = await getHistoricalRecords();
  return records.filter((r) => r.route_id === Number(routeId));
}

export async function getRecordById(id) {
  const recId = Number(id);
  const records = await getHistoricalRecords();
  return records.find((r) => r.id === recId) || null;
}

export async function createHistoricalRecord({ route_id, record_date, schedule_time, delay_minutes, ridership }) {
  await initDatabase();
  const route = await getRouteById(route_id);
  if (!route) {
    const err = new Error("Route or station not found.");
    err.status = 404;
    throw err;
  }

  const newRecord = {
    route_id: Number(route_id),
    record_date,
    schedule_time,
    delay_minutes: Number(delay_minutes),
    ridership: Number(ridership),
    created_at: new Date().toISOString(),
  };

  if (databaseProvider === "supabase_pg" && pgPool) {
    const res = await pgPool.query(
      `INSERT INTO public.historical_records (route_id, record_date, schedule_time, delay_minutes, ridership)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [newRecord.route_id, newRecord.record_date, newRecord.schedule_time, newRecord.delay_minutes, newRecord.ridership]
    );
    const saved = res.rows[0];
    return {
      ...saved,
      id: Number(saved.id),
      route_code: route.code,
      route_name: route.name,
      record_date: typeof saved.record_date === "string" ? saved.record_date.slice(0, 10) : saved.record_date.toISOString().slice(0, 10),
    };
  }

  if (databaseProvider === "supabase_js" && supabaseClient) {
    const { data, error } = await supabaseClient
      .from("historical_records")
      .insert([newRecord])
      .select()
      .single();
    if (error) throw new Error(error.message);
    return {
      ...data,
      id: Number(data.id),
      route_code: route.code,
      route_name: route.name,
    };
  }

  const created = {
    ...newRecord,
    id: nextLocalRecordId++,
    route_code: route.code,
    route_name: route.name,
  };
  localRecords.push(created);
  return created;
}

export async function updateHistoricalRecord(id, updates) {
  await initDatabase();
  const recId = Number(id);

  if (updates.route_id !== undefined) {
    const route = await getRouteById(updates.route_id);
    if (!route) {
      const err = new Error("Route or station not found.");
      err.status = 404;
      throw err;
    }
  }

  if (databaseProvider === "supabase_pg" && pgPool) {
    const fields = [];
    const values = [];
    let idx = 1;

    if (updates.route_id !== undefined) { fields.push(`route_id = $${idx++}`); values.push(Number(updates.route_id)); }
    if (updates.record_date !== undefined) { fields.push(`record_date = $${idx++}`); values.push(updates.record_date); }
    if (updates.schedule_time !== undefined) { fields.push(`schedule_time = $${idx++}`); values.push(updates.schedule_time); }
    if (updates.delay_minutes !== undefined) { fields.push(`delay_minutes = $${idx++}`); values.push(Number(updates.delay_minutes)); }
    if (updates.ridership !== undefined) { fields.push(`ridership = $${idx++}`); values.push(Number(updates.ridership)); }

    if (fields.length === 0) return await getRecordById(recId);

    values.push(recId);
    const res = await pgPool.query(
      `UPDATE public.historical_records SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *`,
      values
    );
    if (res.rows.length === 0) {
      const err = new Error("Historical record not found.");
      err.status = 404;
      throw err;
    }
    return await getRecordById(recId);
  }

  if (databaseProvider === "supabase_js" && supabaseClient) {
    const { data, error } = await supabaseClient
      .from("historical_records")
      .update(updates)
      .eq("id", recId)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return await getRecordById(recId);
  }

  const existing = localRecords.find((r) => r.id === recId);
  if (!existing) {
    const err = new Error("Historical record not found.");
    err.status = 404;
    throw err;
  }
  Object.assign(existing, updates);
  return await getRecordById(recId);
}

export async function deleteHistoricalRecord(id) {
  await initDatabase();
  const recId = Number(id);

  if (databaseProvider === "supabase_pg" && pgPool) {
    const res = await pgPool.query("DELETE FROM public.historical_records WHERE id = $1 RETURNING id", [recId]);
    if (res.rows.length === 0) {
      const err = new Error("Historical record not found.");
      err.status = 404;
      throw err;
    }
    return true;
  }

  if (databaseProvider === "supabase_js" && supabaseClient) {
    const { error } = await supabaseClient.from("historical_records").delete().eq("id", recId);
    if (error) throw new Error(error.message);
    return true;
  }

  const index = localRecords.findIndex((r) => r.id === recId);
  if (index === -1) {
    const err = new Error("Historical record not found.");
    err.status = 404;
    throw err;
  }
  localRecords.splice(index, 1);
  return true;
}

// Access Logs Methods (NFR-05)
export async function logAccess(username, action, resource, success = true) {
  const entry = {
    username: username || "anonymous",
    action,
    resource,
    success: Boolean(success),
    timestamp: new Date().toISOString(),
  };

  try {
    if (databaseProvider === "supabase_pg" && pgPool) {
      await pgPool.query(
        "INSERT INTO public.access_logs (username, action, resource, success, timestamp) VALUES ($1, $2, $3, $4, $5)",
        [entry.username, entry.action, entry.resource, entry.success, entry.timestamp]
      );
      return;
    }

    if (databaseProvider === "supabase_js" && supabaseClient) {
      await supabaseClient.from("access_logs").insert([entry]);
      return;
    }
  } catch (err) {
    console.warn("[DB] Error persisting access log to Supabase:", err.message);
  }

  localLogs.push({ id: localLogs.length + 1, ...entry });
}

export async function getAccessLogs(limit = 100) {
  await initDatabase();

  if (databaseProvider === "supabase_pg" && pgPool) {
    const res = await pgPool.query("SELECT * FROM public.access_logs ORDER BY timestamp DESC LIMIT $1", [limit]);
    return res.rows;
  }

  if (databaseProvider === "supabase_js" && supabaseClient) {
    const { data } = await supabaseClient
      .from("access_logs")
      .select("*")
      .order("timestamp", { ascending: false })
      .limit(limit);
    if (data) return data;
  }

  return [...localLogs].reverse().slice(0, limit);
}
