-- Bulk seed for recommender_movies
-- Safe to rerun: users/movies use ON CONFLICT; bulk interactions are replaced by source tag.
-- Execute with:
-- docker compose exec postgres psql -U postgres -d smartshop_recommender -f /docker-entrypoint-initdb.d/seed_bulk.sql

BEGIN;

-- 1) Ensure minimal references exist
INSERT INTO countries (iso_code, name)
VALUES
    ('BR', 'Brazil'),
    ('US', 'United States')
ON CONFLICT (iso_code) DO NOTHING;

INSERT INTO languages (code, name)
VALUES
    ('pt-BR', 'Portuguese (Brazil)'),
    ('en-US', 'English (US)'),
    ('es-ES', 'Spanish')
ON CONFLICT (code) DO NOTHING;

-- 2) Bulk users (500)
WITH ref AS (
    SELECT
        (SELECT id FROM countries WHERE iso_code = 'BR' LIMIT 1) AS br_country_id,
        (SELECT id FROM languages WHERE code = 'pt-BR' LIMIT 1) AS pt_language_id
)
INSERT INTO users (external_id, full_name, email, birth_date, country_id, preferred_language_id)
SELECT
    'bulk-u-' || LPAD(gs::text, 5, '0') AS external_id,
    'User ' || gs AS full_name,
    'bulk_user_' || gs || '@example.com' AS email,
    (DATE '1975-01-01' + ((random() * 12000)::int)) AS birth_date,
    ref.br_country_id,
    ref.pt_language_id
FROM generate_series(1, 500) AS gs
CROSS JOIN ref
ON CONFLICT (external_id) DO NOTHING;

-- 3) Bulk movies (1200)
WITH ref AS (
    SELECT
        (SELECT id FROM countries WHERE iso_code = 'US' LIMIT 1) AS us_country_id,
        (SELECT id FROM languages WHERE code = 'en-US' LIMIT 1) AS en_language_id
)
INSERT INTO movies (
    external_id,
    title,
    original_title,
    synopsis,
    release_date,
    runtime_min,
    primary_language_id,
    production_country_id,
    popularity_score
)
SELECT
    'bulk-m-' || LPAD(gs::text, 6, '0') AS external_id,
    'Movie ' || gs AS title,
    'Movie Original ' || gs AS original_title,
    'Auto generated movie synopsis ' || gs AS synopsis,
    (DATE '1980-01-01' + ((random() * 16000)::int)) AS release_date,
    (80 + (random() * 80)::int) AS runtime_min,
    ref.en_language_id,
    ref.us_country_id,
    ROUND((random() * 100)::numeric, 4) AS popularity_score
FROM generate_series(1, 1200) AS gs
CROSS JOIN ref
ON CONFLICT (external_id) DO NOTHING;

-- 4) Replace old bulk interactions
DELETE FROM interaction_events
WHERE source = 'bulk_seed_v1';

-- 5) Bulk interactions (60000)
WITH bulk_users AS (
    SELECT array_agg(id) AS ids
    FROM users
    WHERE external_id LIKE 'bulk-u-%'
),
bulk_movies AS (
    SELECT array_agg(id) AS ids
    FROM movies
    WHERE external_id LIKE 'bulk-m-%'
)
INSERT INTO interaction_events (
    user_id,
    movie_id,
    event_type,
    event_value,
    event_weight,
    source,
    occurred_at
)
SELECT
    u.ids[1 + floor(random() * array_length(u.ids, 1))::int] AS user_id,
    m.ids[1 + floor(random() * array_length(m.ids, 1))::int] AS movie_id,
    CASE
        WHEN r < 0.35 THEN 'watch_complete'
        WHEN r < 0.60 THEN 'watch_start'
        WHEN r < 0.75 THEN 'like'
        WHEN r < 0.85 THEN 'dislike'
        WHEN r < 0.95 THEN 'rating'
        WHEN r < 0.98 THEN 'wishlist_add'
        ELSE 'skip'
    END AS event_type,
    CASE
        WHEN r >= 0.85 AND r < 0.95 THEN (1 + floor(random() * 5))::numeric
        ELSE NULL::numeric
    END AS event_value,
    CASE
        WHEN r < 0.35 THEN 1.0::numeric
        WHEN r < 0.60 THEN 0.3::numeric
        WHEN r < 0.75 THEN 2.0::numeric
        WHEN r < 0.85 THEN -1.0::numeric
        WHEN r < 0.95 THEN (1 + floor(random() * 5))::numeric
        WHEN r < 0.98 THEN 0.5::numeric
        ELSE -0.2::numeric
    END AS event_weight,
    'bulk_seed_v1' AS source,
    NOW() - ((random() * 365)::int || ' days')::interval
FROM generate_series(1, 60000) AS gs
CROSS JOIN bulk_users u
CROSS JOIN bulk_movies m
CROSS JOIN LATERAL (SELECT random() AS r) AS rnd;

COMMIT;
