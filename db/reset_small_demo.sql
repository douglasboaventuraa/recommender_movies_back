-- Reset dataset to a small demo size for easier validation and presentation.
-- Target volume:
-- - 6 genres
-- - 30 movies (5 per genre)
-- - 7 users
-- - 35 interaction events (5 per user)
--
-- Run with:
-- docker compose exec postgres psql -U postgres -d smartshop_recommender -f /docker-entrypoint-initdb.d/reset_small_demo.sql

BEGIN;

TRUNCATE TABLE
  recommendation_results,
  recommendation_batches,
  training_runs,
  model_registry,
  interaction_events,
  user_movie_feedback,
  user_preferred_genres,
  movie_genres,
  movies,
  users,
  genres,
  languages,
  countries
RESTART IDENTITY CASCADE;

INSERT INTO countries (iso_code, name)
VALUES ('US', 'United States'), ('BR', 'Brazil');

INSERT INTO languages (code, name)
VALUES ('en-US', 'English (US)'), ('pt-BR', 'Portuguese (Brazil)');

INSERT INTO genres (slug, name)
VALUES
  ('action', 'Action'),
  ('comedy', 'Comedy'),
  ('drama', 'Drama'),
  ('horror', 'Horror'),
  ('scifi', 'SciFi'),
  ('romance', 'Romance');

WITH ref AS (
  SELECT
    (SELECT id FROM countries WHERE iso_code = 'BR' LIMIT 1) AS country_id,
    (SELECT id FROM languages WHERE code = 'pt-BR' LIMIT 1) AS language_id
), names AS (
  SELECT * FROM (VALUES
    ('Alice Araujo'),
    ('Bruno Silva'),
    ('Camila Souza'),
    ('Daniel Costa'),
    ('Erick Vieira'),
    ('Fernanda Cunha'),
    ('Gustavo Neves')
  ) AS t(full_name)
)
INSERT INTO users (external_id, full_name, email, birth_date, country_id, preferred_language_id)
SELECT
  'demo-u-' || LPAD((ROW_NUMBER() OVER ())::text, 4, '0') AS external_id,
  n.full_name,
  lower(replace(n.full_name, ' ', '.')) || '@mail.com' AS email,
  DATE '1970-01-01' + ((random() * 12000)::int) AS birth_date,
  ref.country_id,
  ref.language_id
FROM names n
CROSS JOIN ref;

-- Deterministic preferred genre per user for easier recommendation tracking.
WITH users_ranked AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS rn
  FROM users
)
INSERT INTO user_preferred_genres (user_id, genre_id, affinity_score)
SELECT
  u.id,
  g.id,
  1.0000
FROM users_ranked u
CROSS JOIN LATERAL (
  SELECT id
  FROM genres
  ORDER BY id
  OFFSET ((u.rn - 1) % 6)
  LIMIT 1
) g;

WITH movie_seed(title, release_year, genre_name) AS (
  VALUES
    ('Die Hard', 1988, 'Action'),
    ('The Dark Knight', 2008, 'Action'),
    ('John Wick', 2014, 'Action'),
    ('Mad Max: Fury Road', 2015, 'Action'),
    ('Mission: Impossible - Fallout', 2018, 'Action'),

    ('Superbad', 2007, 'Comedy'),
    ('The Hangover', 2009, 'Comedy'),
    ('Mean Girls', 2004, 'Comedy'),
    ('The Grand Budapest Hotel', 2014, 'Comedy'),
    ('Palm Springs', 2020, 'Comedy'),

    ('The Shawshank Redemption', 1994, 'Drama'),
    ('Forrest Gump', 1994, 'Drama'),
    ('Whiplash', 2014, 'Drama'),
    ('The Pursuit of Happyness', 2006, 'Drama'),
    ('A Beautiful Mind', 2001, 'Drama'),

    ('The Shining', 1980, 'Horror'),
    ('Get Out', 2017, 'Horror'),
    ('A Quiet Place', 2018, 'Horror'),
    ('The Conjuring', 2013, 'Horror'),
    ('Hereditary', 2018, 'Horror'),

    ('Inception', 2010, 'SciFi'),
    ('Interstellar', 2014, 'SciFi'),
    ('Arrival', 2016, 'SciFi'),
    ('Blade Runner 2049', 2017, 'SciFi'),
    ('The Matrix', 1999, 'SciFi'),

    ('Titanic', 1997, 'Romance'),
    ('La La Land', 2016, 'Romance'),
    ('About Time', 2013, 'Romance'),
    ('The Notebook', 2004, 'Romance'),
    ('Pride & Prejudice', 2005, 'Romance')
), ins_movies AS (
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
    'demo-m-' || LPAD((ROW_NUMBER() OVER (ORDER BY title))::text, 4, '0') AS external_id,
    title,
    title,
    title || ': demo synopsis for recommendation flow.',
    MAKE_DATE(release_year, 1, 1),
    90 + (random() * 45)::int,
    (SELECT id FROM languages WHERE code = 'en-US' LIMIT 1),
    (SELECT id FROM countries WHERE iso_code = 'US' LIMIT 1),
    ROUND((40 + random() * 50)::numeric, 4)
  FROM movie_seed
  RETURNING id, title
), movie_genre_pairs AS (
  SELECT im.id AS movie_id, ms.genre_name
  FROM ins_movies im
  JOIN movie_seed ms ON ms.title = im.title
)
INSERT INTO movie_genres (movie_id, genre_id, weight)
SELECT
  mgp.movie_id,
  g.id,
  1.0000
FROM movie_genre_pairs mgp
JOIN genres g ON g.name = mgp.genre_name;

-- Generate 35 events with stronger signal towards preferred genre.
WITH generated AS (
  SELECT
    gs AS idx,
    ((gs * 17) % 100)::numeric / 100.0 AS pick_pref,
    ((gs * 37) % 100)::numeric / 100.0 AS event_random,
    ((gs * 53) % 100)::numeric / 100.0 AS rating_random
  FROM generate_series(1, 35) gs
), picked AS (
  SELECT
    g.idx,
    u.id AS user_id,
    CASE
      WHEN g.pick_pref < 0.72 THEN pref_movie.movie_id
      ELSE any_movie.movie_id
    END AS movie_id,
    g.event_random AS r,
    g.rating_random AS rr
  FROM generated g
  JOIN LATERAL (
    SELECT id
    FROM users
    ORDER BY id
    OFFSET ((g.idx - 1) % 7)
    LIMIT 1
  ) u ON TRUE
  JOIN LATERAL (
    SELECT genre_id
    FROM user_preferred_genres
    WHERE user_id = u.id
    LIMIT 1
  ) upg ON TRUE
  JOIN LATERAL (
    SELECT mg.movie_id
    FROM movie_genres mg
    WHERE mg.genre_id = upg.genre_id
    ORDER BY mg.movie_id
    OFFSET ((g.idx - 1) % 5)
    LIMIT 1
  ) pref_movie ON TRUE
  JOIN LATERAL (
    SELECT m.id AS movie_id
    FROM movies m
    ORDER BY m.id
    OFFSET ((g.idx * 11) % 30)
    LIMIT 1
  ) any_movie ON TRUE
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
  p.user_id,
  p.movie_id,
  CASE
    WHEN p.r < 0.26 THEN 'watch_start'
    WHEN p.r < 0.54 THEN 'watch_complete'
    WHEN p.r < 0.74 THEN 'like'
    WHEN p.r < 0.92 THEN 'rating'
    ELSE 'skip'
  END AS event_type,
  CASE
    WHEN p.r >= 0.74 AND p.r < 0.92 THEN ROUND((3.0 + p.rr * 2.0)::numeric, 1)
    ELSE NULL
  END AS event_value,
  CASE
    WHEN p.r < 0.28 THEN 0.4
    WHEN p.r < 0.54 THEN 1.2
    WHEN p.r < 0.74 THEN 2.2
    WHEN p.r < 0.92 THEN ROUND((3.0 + p.rr * 2.0)::numeric, 1)
    ELSE -0.2
  END AS event_weight,
  'seed_demo',
  NOW() - ((random() * 45 || ' days')::interval)
FROM picked p
WHERE p.movie_id IS NOT NULL;

-- Aggregate quick feedback view for baseline queries and debugging.
INSERT INTO user_movie_feedback (
  user_id,
  movie_id,
  rating_value,
  liked,
  watch_count,
  last_watched_at,
  aggregated_weight,
  updated_at
)
SELECT
  ie.user_id,
  ie.movie_id,
  ROUND(AVG(ie.event_value) FILTER (WHERE ie.event_type = 'rating')::numeric, 1) AS rating_value,
  BOOL_OR(ie.event_type = 'like') AS liked,
  COUNT(*) FILTER (WHERE ie.event_type IN ('watch_start', 'watch_complete'))::int AS watch_count,
  MAX(ie.occurred_at) FILTER (WHERE ie.event_type IN ('watch_start', 'watch_complete')) AS last_watched_at,
  ROUND(SUM(ie.event_weight)::numeric, 4) AS aggregated_weight,
  NOW() AS updated_at
FROM interaction_events ie
GROUP BY ie.user_id, ie.movie_id;

COMMIT;
