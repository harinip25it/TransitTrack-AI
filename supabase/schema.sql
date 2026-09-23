-- TransitTrack AI — Supabase PostgreSQL Schema & Migration
-- Based on SRS (srs.md, REQUIREMENTS.md)
-- Designed for Supabase PostgreSQL with relationships, constraints, indexes, and initial data migration.

-- 1. Users Table (NFR-04: Operator Authentication)
CREATE TABLE IF NOT EXISTS public.users (
    id BIGSERIAL PRIMARY KEY,
    username VARCHAR(64) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role VARCHAR(32) NOT NULL DEFAULT 'dispatcher',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Transit Routes & Stations Table
CREATE TABLE IF NOT EXISTS public.routes (
    id BIGSERIAL PRIMARY KEY,
    code VARCHAR(16) NOT NULL UNIQUE,
    name VARCHAR(128) NOT NULL,
    kind VARCHAR(32) NOT NULL CHECK (kind IN ('route', 'station')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Historical Transit Records Table (FR-13)
CREATE TABLE IF NOT EXISTS public.historical_records (
    id BIGSERIAL PRIMARY KEY,
    route_id BIGINT NOT NULL REFERENCES public.routes(id) ON DELETE CASCADE,
    record_date DATE NOT NULL,
    schedule_time VARCHAR(8) NOT NULL,
    delay_minutes INTEGER NOT NULL CHECK (delay_minutes >= 0 AND delay_minutes <= 180),
    ridership INTEGER NOT NULL CHECK (ridership >= 0 AND ridership <= 20000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Access Logs Table (NFR-05: Data Access Logging with Timestamps)
CREATE TABLE IF NOT EXISTS public.access_logs (
    id BIGSERIAL PRIMARY KEY,
    username VARCHAR(64) NOT NULL,
    action VARCHAR(64) NOT NULL,
    resource VARCHAR(128) NOT NULL,
    success BOOLEAN NOT NULL DEFAULT true,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_historical_records_route_id ON public.historical_records(route_id);
CREATE INDEX IF NOT EXISTS idx_historical_records_date ON public.historical_records(record_date);
CREATE INDEX IF NOT EXISTS idx_access_logs_timestamp ON public.access_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_routes_kind ON public.routes(kind);

-- Enable Row Level Security (RLS)
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.historical_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.access_logs ENABLE ROW LEVEL SECURITY;

-- Service Role full access policies (for backend server)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'service_role_all_users') THEN
        CREATE POLICY service_role_all_users ON public.users FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'service_role_all_routes') THEN
        CREATE POLICY service_role_all_routes ON public.routes FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'service_role_all_records') THEN
        CREATE POLICY service_role_all_records ON public.historical_records FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'service_role_all_logs') THEN
        CREATE POLICY service_role_all_logs ON public.access_logs FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
    -- Authenticated / anon policies if accessing directly
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'anon_read_routes') THEN
        CREATE POLICY anon_read_routes ON public.routes FOR SELECT TO anon, authenticated USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'anon_all_records') THEN
        CREATE POLICY anon_all_records ON public.historical_records FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'anon_all_logs') THEN
        CREATE POLICY anon_all_logs ON public.access_logs FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'anon_read_users') THEN
        CREATE POLICY anon_read_users ON public.users FOR SELECT TO anon, authenticated USING (true);
    END IF;
END
$$;

-- 5. Data Migration: Seed Initial Users
-- Default operator: admin / transit123 (PBKDF2 hash salt$digest)
INSERT INTO public.users (id, username, password_hash, role)
VALUES (
    1,
    'admin',
    '342b47f0fecadcf26ca51079fb26046e$c3c6f0d14b433e54b6118d05ddc831cb635670845a7d65ca0f2aa7b1897d2fd3',
    'dispatcher'
)
ON CONFLICT (id) DO NOTHING;

-- Data Migration: Seed Initial Routes & Stations
INSERT INTO public.routes (id, code, name, kind) VALUES
    (1, '101', 'Route 101 - Downtown Loop', 'route'),
    (2, '202', 'Route 202 - Airport Express', 'route'),
    (3, '303', 'Route 303 - University Line', 'route'),
    (4, 'CS', 'Central Station', 'station'),
    (5, 'NS', 'North Station', 'station')
ON CONFLICT (id) DO UPDATE SET
    code = EXCLUDED.code,
    name = EXCLUDED.name,
    kind = EXCLUDED.kind;

-- Data Migration: Seed All 21 Initial Historical Records
INSERT INTO public.historical_records (id, route_id, record_date, schedule_time, delay_minutes, ridership) VALUES
    (1, 1, '2026-08-25', '08:00', 5, 1120),
    (2, 1, '2026-08-26', '08:00', 4, 1180),
    (3, 1, '2026-08-27', '13:00', 7, 1250),
    (4, 1, '2026-08-28', '17:30', 6, 1310),
    (5, 1, '2026-08-29', '08:00', 5, 1205),
    (6, 2, '2026-08-25', '09:30', 12, 1480),
    (7, 2, '2026-08-26', '09:30', 14, 1520),
    (8, 2, '2026-08-27', '17:30', 15, 1620),
    (9, 2, '2026-08-28', '09:30', 11, 1490),
    (10, 2, '2026-08-29', '17:30', 16, 1680),
    (11, 3, '2026-08-25', '10:00', 3, 920),
    (12, 3, '2026-08-26', '10:00', 2, 880),
    (13, 3, '2026-08-27', '16:00', 4, 970),
    (14, 3, '2026-08-28', '10:00', 3, 910),
    (15, 3, '2026-08-29', '16:00', 1, 860),
    (16, 4, '2026-08-27', '08:15', 8, 1410),
    (17, 4, '2026-08-28', '08:15', 9, 1460),
    (18, 4, '2026-08-29', '18:00', 10, 1510),
    (19, 5, '2026-08-27', '07:45', 4, 780),
    (20, 5, '2026-08-28', '07:45', 3, 740),
    (21, 5, '2026-08-29', '18:20', 5, 810)
ON CONFLICT (id) DO NOTHING;

-- Reset sequence values to continue after seeded IDs
SELECT setval('public.users_id_seq', COALESCE((SELECT MAX(id) FROM public.users), 1));
SELECT setval('public.routes_id_seq', COALESCE((SELECT MAX(id) FROM public.routes), 1));
SELECT setval('public.historical_records_id_seq', COALESCE((SELECT MAX(id) FROM public.historical_records), 1));
