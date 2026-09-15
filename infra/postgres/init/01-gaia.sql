-- ------------------------------------------------------------------
-- GAIA — PostGIS bootstrap (geo entities, aggregates, scenario diffs)
-- Mounted into the postgis container through docker-compose:
--   ./infra/postgres/init:/docker-entrypoint-initdb.d
-- ------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS postgis;

-- ── Geo entities: the 8 named regions the world generator spreads over ──
CREATE TABLE IF NOT EXISTS gaia_regions (
    region text PRIMARY KEY,
    label  text NOT NULL,
    bbox   geometry(Polygon, 4326) NOT NULL
);

INSERT INTO gaia_regions (region, label, bbox) VALUES
    ('eu-west',  'Europe West',      ST_MakeEnvelope(-10,  36,   8,  60, 4326)),
    ('eu-east',  'Europe East',      ST_MakeEnvelope(  8,  36,  40,  60, 4326)),
    ('na-east',  'North America East', ST_MakeEnvelope(-100, 25, -60,  50, 4326)),
    ('na-west',  'North America West', ST_MakeEnvelope(-130, 30, -100, 55, 4326)),
    ('me',       'Middle East',      ST_MakeEnvelope( 25,  12,  60,  40, 4326)),
    ('asia-n',   'Asia North',       ST_MakeEnvelope( 60,  20, 150,  60, 4326)),
    ('asia-s',   'Asia South',       ST_MakeEnvelope( 60, -10, 150,  20, 4326)),
    ('africa',   'Africa',           ST_MakeEnvelope(-20, -35,  50,  12, 4326))
ON CONFLICT (region) DO NOTHING;

-- ── Flink sliding-window aggregates, per domain (mirror of Kafka) ──
CREATE TABLE IF NOT EXISTS gaia_domain_aggregates (
    domain       text NOT NULL,
    window_start timestamptz NOT NULL,
    window_end   timestamptz NOT NULL,
    event_count  bigint NOT NULL,
    max_severity double precision NOT NULL,
    avg_severity double precision NOT NULL,
    inserted_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT gaia_domain_aggregates_uniq UNIQUE (domain, window_start, window_end)
);

-- ── Flink sliding-window aggregates, per geography (PostGIS) ──
CREATE TABLE IF NOT EXISTS gaia_region_aggregates (
    region       text NOT NULL,
    window_start timestamptz NOT NULL,
    window_end   timestamptz NOT NULL,
    event_count  bigint NOT NULL,
    max_severity double precision NOT NULL,
    avg_severity double precision NOT NULL,
    inserted_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT gaia_region_aggregates_uniq UNIQUE (region, window_start, window_end)
);

CREATE INDEX IF NOT EXISTS gaia_domain_aggregates_recent_idx
    ON gaia_domain_aggregates (domain, window_end DESC);
CREATE INDEX IF NOT EXISTS gaia_region_aggregates_recent_idx
    ON gaia_region_aggregates (region, window_end DESC);

-- ── What-if scenario diffs (scenario-service appends one row per run) ──
CREATE TABLE IF NOT EXISTS gaia_scenarios (
    id              uuid PRIMARY KEY,
    created_at      timestamptz NOT NULL DEFAULT now(),
    seed            bigint,
    entities        bigint,
    baseline_ticks  integer,
    scenario_ticks  integer,
    scenario_events bigint,
    perturbations   text[] NOT NULL DEFAULT '{}',
    diffs           jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- ── Spatial views ──
CREATE OR REPLACE VIEW gaia_region_geometry AS
SELECT r.region,
       r.label,
       r.bbox,
       ST_Centroid(r.bbox)                       AS centroid,
       ST_Area(r.bbox::geography) / 1000000.0    AS area_km2
FROM gaia_regions r;

CREATE OR REPLACE VIEW gaia_region_severity AS
SELECT g.region,
       g.label,
       g.area_km2,
       a.window_end,
       a.event_count,
       a.max_severity,
       a.avg_severity,
       g.bbox AS geom
FROM gaia_region_aggregates a
LEFT JOIN gaia_region_geometry g ON g.region = a.region;