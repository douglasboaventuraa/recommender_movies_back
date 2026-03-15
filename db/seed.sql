-- SmartShop Recommender - Seed Data (PostgreSQL)
-- Run after schema:
-- psql -U postgres -d smartshop_recommender -f db/seed.sql

BEGIN;

-- Countries
INSERT INTO countries (iso_code, name)
VALUES
    ('BR', 'Brazil'),
    ('US', 'United States')
ON CONFLICT (iso_code) DO NOTHING;

-- Languages
INSERT INTO languages (code, name)
VALUES
    ('pt-BR', 'Portuguese (Brazil)'),
    ('en-US', 'English (US)'),
    ('es-ES', 'Spanish')
ON CONFLICT (code) DO NOTHING;

-- Genres
INSERT INTO genres (slug, name)
VALUES
    ('action', 'Action'),
    ('comedy', 'Comedy'),
    ('drama', 'Drama'),
    ('sci-fi', 'Sci-Fi'),
    ('thriller', 'Thriller'),
    ('animation', 'Animation')
ON CONFLICT (slug) DO NOTHING;

-- Providers
INSERT INTO providers (name, provider_type, homepage_url)
VALUES
    ('SmartPlay', 'streaming', 'https://smartplay.example'),
    ('CinemaNow', 'streaming', 'https://cinemanow.example')
ON CONFLICT (name) DO NOTHING;

-- Users
WITH c AS (
    SELECT id FROM countries WHERE iso_code = 'BR'
), l AS (
    SELECT id FROM languages WHERE code = 'pt-BR'
)
INSERT INTO users (external_id, full_name, email, birth_date, country_id, preferred_language_id)
SELECT * FROM (
    VALUES
        ('u-ana', 'Ana Lima', 'ana@example.com', DATE '1999-06-10'),
        ('u-bruno', 'Bruno Ferreira', 'bruno@example.com', DATE '1997-01-04'),
        ('u-camila', 'Camila Souza', 'camila@example.com', DATE '1994-09-21'),
        ('u-diego', 'Diego Almeida', 'diego@example.com', DATE '2002-02-18'),
        ('u-eduarda', 'Eduarda Nunes', 'eduarda@example.com', DATE '1998-12-03')
) AS x(external_id, full_name, email, birth_date)
CROSS JOIN c
CROSS JOIN l
ON CONFLICT (external_id) DO NOTHING;

-- Movies
WITH l_pt AS (SELECT id FROM languages WHERE code = 'pt-BR'),
     l_en AS (SELECT id FROM languages WHERE code = 'en-US'),
     c_br AS (SELECT id FROM countries WHERE iso_code = 'BR'),
     c_us AS (SELECT id FROM countries WHERE iso_code = 'US')
INSERT INTO movies (
    external_id, title, original_title, synopsis, release_date, runtime_min,
    primary_language_id, production_country_id, popularity_score
)
SELECT * FROM (
    VALUES
        ('m-001', 'Codigo Infinito', 'Infinite Code', 'Um dev descobre um algoritmo que preve o futuro.', DATE '2021-08-10', 118, 'en-US', 'US', 82.3000),
        ('m-002', 'Noite Neon', 'Neon Night', 'Uma investigacao em uma cidade futurista.', DATE '2022-11-05', 104, 'en-US', 'US', 77.1200),
        ('m-003', 'Vidas em Cena', 'Lives on Stage', 'Drama sobre familia e reconciliacao.', DATE '2020-03-14', 132, 'pt-BR', 'BR', 65.8400),
        ('m-004', 'Riso Total', 'Total Laughs', 'Comedia sobre uma equipe improvavel.', DATE '2019-07-19', 98, 'pt-BR', 'BR', 58.2300),
        ('m-005', 'Orbita Final', 'Final Orbit', 'Missao espacial de alto risco.', DATE '2023-01-27', 126, 'en-US', 'US', 91.5500),
        ('m-006', 'Sombras do Porto', 'Harbor Shadows', 'Thriller policial em porto internacional.', DATE '2021-12-02', 111, 'es-ES', 'US', 70.6000)
) AS x(external_id, title, original_title, synopsis, release_date, runtime_min, lang_code, country_code, popularity_score)
JOIN languages lang ON lang.code = x.lang_code
JOIN countries ctry ON ctry.iso_code = x.country_code
ON CONFLICT (external_id) DO NOTHING;

-- Movie genres
INSERT INTO movie_genres (movie_id, genre_id, weight)
SELECT m.id, g.id, 1.0000
FROM movies m
JOIN genres g ON (
    (m.external_id = 'm-001' AND g.slug IN ('sci-fi', 'thriller')) OR
    (m.external_id = 'm-002' AND g.slug IN ('thriller', 'action')) OR
    (m.external_id = 'm-003' AND g.slug IN ('drama')) OR
    (m.external_id = 'm-004' AND g.slug IN ('comedy')) OR
    (m.external_id = 'm-005' AND g.slug IN ('sci-fi', 'action')) OR
    (m.external_id = 'm-006' AND g.slug IN ('thriller', 'drama'))
)
ON CONFLICT (movie_id, genre_id) DO NOTHING;

-- Movie providers
INSERT INTO movie_providers (movie_id, provider_id, availability_type, deep_link)
SELECT m.id, p.id, 'subscription', 'https://smartplay.example/watch/' || m.external_id
FROM movies m
JOIN providers p ON p.name = 'SmartPlay'
ON CONFLICT (movie_id, provider_id, availability_type) DO NOTHING;

-- Interactions
INSERT INTO interaction_events (user_id, movie_id, event_type, event_value, event_weight, source, occurred_at)
SELECT u.id, m.id, e.event_type, e.event_value, e.event_weight, 'web', NOW() - (e.days_ago || ' days')::interval
FROM (
    VALUES
        ('u-ana', 'm-001', 'watch_complete', NULL::numeric, 1.0000, 9),
        ('u-ana', 'm-001', 'rating', 5.0, 5.0000, 9),
        ('u-ana', 'm-005', 'watch_complete', NULL::numeric, 1.0000, 5),
        ('u-bruno', 'm-002', 'watch_complete', NULL::numeric, 1.0000, 10),
        ('u-bruno', 'm-002', 'like', NULL::numeric, 2.0000, 10),
        ('u-bruno', 'm-006', 'watch_start', NULL::numeric, 0.3000, 2),
        ('u-camila', 'm-003', 'watch_complete', NULL::numeric, 1.0000, 15),
        ('u-camila', 'm-003', 'rating', 4.5, 4.5000, 15),
        ('u-camila', 'm-004', 'watch_complete', NULL::numeric, 1.0000, 7),
        ('u-diego', 'm-005', 'watch_complete', NULL::numeric, 1.0000, 3),
        ('u-diego', 'm-001', 'watch_start', NULL::numeric, 0.3000, 1),
        ('u-eduarda', 'm-004', 'watch_complete', NULL::numeric, 1.0000, 4),
        ('u-eduarda', 'm-003', 'like', NULL::numeric, 2.0000, 4)
) AS e(user_external_id, movie_external_id, event_type, event_value, event_weight, days_ago)
JOIN users u ON u.external_id = e.user_external_id
JOIN movies m ON m.external_id = e.movie_external_id;

-- Materialized feedback example
INSERT INTO user_movie_feedback (user_id, movie_id, rating_value, liked, watch_count, last_watched_at, aggregated_weight)
SELECT
    u.id,
    m.id,
    MAX(CASE WHEN ie.event_type = 'rating' THEN ie.event_value END) AS rating_value,
    BOOL_OR(ie.event_type = 'like') AS liked,
    COUNT(*) FILTER (WHERE ie.event_type IN ('watch_start', 'watch_complete')) AS watch_count,
    MAX(ie.occurred_at) AS last_watched_at,
    COALESCE(SUM(ie.event_weight), 0) AS aggregated_weight
FROM interaction_events ie
JOIN users u ON u.id = ie.user_id
JOIN movies m ON m.id = ie.movie_id
GROUP BY u.id, m.id
ON CONFLICT (user_id, movie_id) DO NOTHING;

COMMIT;
