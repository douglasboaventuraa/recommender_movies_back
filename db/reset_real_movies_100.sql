-- Reset dataset to exactly 8 genres + 100 real movie titles
-- Run with:
-- docker compose exec postgres psql -U postgres -d smartshop_recommender -f /docker-entrypoint-initdb.d/reset_real_movies_100.sql

BEGIN;

-- Clean data (keep schema)
TRUNCATE TABLE
    recommendation_feedback,
    recommendation_results,
    recommendation_batches,
    training_samples,
    training_runs,
    model_registry,
    interaction_events,
    user_movie_feedback,
    watch_sessions,
    user_exclusions,
    user_preferred_genres,
    user_preferences,
    user_profiles,
    movie_providers,
    movie_assets,
    movie_credits,
    movie_tag_links,
    movie_tags,
    movie_genres,
    movies,
    people,
    users,
    providers,
    genres,
    languages,
    countries,
    ingestion_jobs,
    audit_logs
RESTART IDENTITY CASCADE;

-- Reference tables
INSERT INTO countries (iso_code, name)
VALUES
    ('US', 'United States'),
    ('BR', 'Brazil')
ON CONFLICT (iso_code) DO NOTHING;

INSERT INTO languages (code, name)
VALUES
    ('en-US', 'English (US)'),
    ('pt-BR', 'Portuguese (Brazil)')
ON CONFLICT (code) DO NOTHING;

-- Exactly 8 genres requested
INSERT INTO genres (slug, name)
VALUES
    ('action', 'Action'),
    ('comedy', 'Comedy'),
    ('drama', 'Drama'),
    ('horror', 'Horror'),
    ('scifi', 'SciFi'),
    ('romance', 'Romance'),
    ('thriller', 'Thriller'),
    ('fantasy', 'Fantasy');

INSERT INTO providers (name, provider_type, homepage_url)
VALUES
    ('CinemaVerse', 'streaming', 'https://cinemaverse.example');

-- Users for recommendation simulation (400)
WITH ref AS (
    SELECT
        (SELECT id FROM countries WHERE iso_code = 'BR' LIMIT 1) AS country_id,
        (SELECT id FROM languages WHERE code = 'pt-BR' LIMIT 1) AS language_id
), first_names AS (
    SELECT ARRAY[
        'Lucas','Miguel','Arthur','Gael','Heitor','Theo','Davi','Gabriel','Bernardo','Samuel',
        'Matheus','Rafael','Pedro','Joao','Henrique','Guilherme','Nicolas','Eduardo','Felipe','Daniel',
        'Ana','Maria','Sofia','Helena','Alice','Laura','Valentina','Beatriz','Isabella','Manuela',
        'Giovanna','Mariana','Julia','Eloa','Livia','Cecilia','Clara','Yasmin','Heloisa','Camila'
    ] AS items
), last_names AS (
    SELECT ARRAY[
        'Silva','Santos','Oliveira','Souza','Pereira','Costa','Rodrigues','Almeida','Nascimento','Lima',
        'Araujo','Fernandes','Gomes','Martins','Rocha','Ribeiro','Carvalho','Barbosa','Cardoso','Melo'
    ] AS items
), generated_users AS (
    SELECT
        gs,
        fn.items[1 + floor(random() * array_length(fn.items, 1))::int] AS first_name,
        ln.items[1 + floor(random() * array_length(ln.items, 1))::int] AS last_name
    FROM generate_series(1, 400) AS gs
    CROSS JOIN first_names fn
    CROSS JOIN last_names ln
)
INSERT INTO users (external_id, full_name, email, birth_date, country_id, preferred_language_id)
SELECT
    'real-u-' || LPAD(gu.gs::text, 5, '0') AS external_id,
    gu.first_name || ' ' || gu.last_name AS full_name,
    lower(gu.first_name || '.' || gu.last_name || '+' || LPAD(gu.gs::text, 5, '0') || '@mail.com') AS email,
    (DATE '1965-01-01' + ((random() * 15000)::int)) AS birth_date,
    ref.country_id,
    ref.language_id
FROM generated_users gu
CROSS JOIN ref;

-- One primary genre affinity per user for more realistic behavior
INSERT INTO user_preferred_genres (user_id, genre_id, affinity_score)
SELECT
    u.id,
    g.id,
    ROUND((0.65 + random() * 0.35)::numeric, 4)
FROM users u
CROSS JOIN LATERAL (
    SELECT id
    FROM genres
    WHERE u.id IS NOT NULL
    ORDER BY random()
    LIMIT 1
) g;

-- 100 real movie titles
WITH movie_seed(title, release_year, genre_name) AS (
    VALUES
    ('Die Hard', 1988, 'Action'),
    ('Mad Max: Fury Road', 2015, 'Action'),
    ('Gladiator', 2000, 'Action'),
    ('The Dark Knight', 2008, 'Action'),
    ('John Wick', 2014, 'Action'),
    ('The Matrix', 1999, 'Action'),
    ('Terminator 2: Judgment Day', 1991, 'Action'),
    ('Casino Royale', 2006, 'Action'),
    ('Mission: Impossible - Fallout', 2018, 'Action'),
    ('Top Gun: Maverick', 2022, 'Action'),
    ('Avengers: Endgame', 2019, 'Action'),
    ('Black Panther', 2018, 'Action'),
    ('Spider-Man: Into the Spider-Verse', 2018, 'Action'),

    ('Superbad', 2007, 'Comedy'),
    ('The Grand Budapest Hotel', 2014, 'Comedy'),
    ('Groundhog Day', 1993, 'Comedy'),
    ('Bridesmaids', 2011, 'Comedy'),
    ('The Big Lebowski', 1998, 'Comedy'),
    ('Shaun of the Dead', 2004, 'Comedy'),
    ('Dumb and Dumber', 1994, 'Comedy'),
    ('Mean Girls', 2004, 'Comedy'),
    ('Step Brothers', 2008, 'Comedy'),
    ('Anchorman: The Legend of Ron Burgundy', 2004, 'Comedy'),
    ('The Hangover', 2009, 'Comedy'),
    ('Home Alone', 1990, 'Comedy'),
    ('Ferris Bueller''s Day Off', 1986, 'Comedy'),

    ('The Shawshank Redemption', 1994, 'Drama'),
    ('Forrest Gump', 1994, 'Drama'),
    ('The Godfather', 1972, 'Drama'),
    ('Fight Club', 1999, 'Drama'),
    ('Whiplash', 2014, 'Drama'),
    ('Parasite', 2019, 'Drama'),
    ('Good Will Hunting', 1997, 'Drama'),
    ('The Social Network', 2010, 'Drama'),
    ('Moonlight', 2016, 'Drama'),
    ('There Will Be Blood', 2007, 'Drama'),
    ('The Pianist', 2002, 'Drama'),
    ('A Beautiful Mind', 2001, 'Drama'),
    ('The Green Mile', 1999, 'Drama'),

    ('The Exorcist', 1973, 'Horror'),
    ('The Shining', 1980, 'Horror'),
    ('Hereditary', 2018, 'Horror'),
    ('Get Out', 2017, 'Horror'),
    ('A Quiet Place', 2018, 'Horror'),
    ('The Conjuring', 2013, 'Horror'),
    ('The Babadook', 2014, 'Horror'),
    ('It', 2017, 'Horror'),
    ('Alien', 1979, 'Horror'),
    ('Halloween', 1978, 'Horror'),
    ('The Ring', 2002, 'Horror'),
    ('Psycho', 1960, 'Horror'),

    ('Inception', 2010, 'SciFi'),
    ('Interstellar', 2014, 'SciFi'),
    ('Blade Runner 2049', 2017, 'SciFi'),
    ('Arrival', 2016, 'SciFi'),
    ('Dune', 2021, 'SciFi'),
    ('Ex Machina', 2014, 'SciFi'),
    ('Star Wars: Episode IV - A New Hope', 1977, 'SciFi'),
    ('Back to the Future', 1985, 'SciFi'),
    ('Jurassic Park', 1993, 'SciFi'),
    ('E.T. the Extra-Terrestrial', 1982, 'SciFi'),
    ('District 9', 2009, 'SciFi'),
    ('Gravity', 2013, 'SciFi'),

    ('Titanic', 1997, 'Romance'),
    ('La La Land', 2016, 'Romance'),
    ('The Notebook', 2004, 'Romance'),
    ('Pride and Prejudice', 2005, 'Romance'),
    ('Before Sunrise', 1995, 'Romance'),
    ('Notting Hill', 1999, 'Romance'),
    ('Eternal Sunshine of the Spotless Mind', 2004, 'Romance'),
    ('Her', 2013, 'Romance'),
    ('Crazy Rich Asians', 2018, 'Romance'),
    ('About Time', 2013, 'Romance'),
    ('Roman Holiday', 1953, 'Romance'),
    ('Amelie', 2001, 'Romance'),

    ('Se7en', 1995, 'Thriller'),
    ('Gone Girl', 2014, 'Thriller'),
    ('Prisoners', 2013, 'Thriller'),
    ('Memento', 2000, 'Thriller'),
    ('Zodiac', 2007, 'Thriller'),
    ('Shutter Island', 2010, 'Thriller'),
    ('No Country for Old Men', 2007, 'Thriller'),
    ('Sicario', 2015, 'Thriller'),
    ('Nightcrawler', 2014, 'Thriller'),
    ('The Silence of the Lambs', 1991, 'Thriller'),
    ('The Usual Suspects', 1995, 'Thriller'),
    ('Oldboy', 2003, 'Thriller'),
    ('The Departed', 2006, 'Thriller'),

    ('The Lord of the Rings: The Fellowship of the Ring', 2001, 'Fantasy'),
    ('Harry Potter and the Sorcerer''s Stone', 2001, 'Fantasy'),
    ('Pan''s Labyrinth', 2006, 'Fantasy'),
    ('Spirited Away', 2001, 'Fantasy'),
    ('The Princess Bride', 1987, 'Fantasy'),
    ('The Shape of Water', 2017, 'Fantasy'),
    ('Stardust', 2007, 'Fantasy'),
    ('Pirates of the Caribbean: The Curse of the Black Pearl', 2003, 'Fantasy'),
    ('Howl''s Moving Castle', 2004, 'Fantasy'),
    ('Big Fish', 2003, 'Fantasy'),
    ('The Chronicles of Narnia: The Lion, the Witch and the Wardrobe', 2005, 'Fantasy'),
    ('Avatar', 2009, 'Fantasy')
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
        'real-m-' || LPAD(ROW_NUMBER() OVER (ORDER BY title)::text, 4, '0') AS external_id,
        title,
        title,
        CASE
            WHEN genre_name = 'Action' THEN title || ': elite operatives race against time to prevent a global catastrophe.'
            WHEN genre_name = 'Comedy' THEN title || ': awkward situations and sharp humor turn everyday chaos into fun.'
            WHEN genre_name = 'Drama' THEN title || ': personal choices and emotional conflicts reshape lives forever.'
            WHEN genre_name = 'Horror' THEN title || ': a disturbing presence slowly takes control of a seemingly normal place.'
            WHEN genre_name = 'SciFi' THEN title || ': science and technology challenge what it means to be human.'
            WHEN genre_name = 'Romance' THEN title || ': two people face timing, distance, and destiny to stay together.'
            WHEN genre_name = 'Thriller' THEN title || ': a high-stakes investigation uncovers dangerous secrets.'
            ELSE title || ': a journey through a magical world filled with ancient powers.'
        END,
        MAKE_DATE(release_year, 1, 1),
        CASE
            WHEN genre_name = 'Action' THEN (105 + (random() * 40)::int)
            WHEN genre_name = 'Comedy' THEN (88 + (random() * 32)::int)
            WHEN genre_name = 'Drama' THEN (100 + (random() * 55)::int)
            WHEN genre_name = 'Horror' THEN (85 + (random() * 35)::int)
            WHEN genre_name = 'SciFi' THEN (100 + (random() * 60)::int)
            WHEN genre_name = 'Romance' THEN (92 + (random() * 40)::int)
            WHEN genre_name = 'Thriller' THEN (95 + (random() * 45)::int)
            ELSE (100 + (random() * 65)::int)
        END,
        (SELECT id FROM languages WHERE code = 'en-US' LIMIT 1),
        (SELECT id FROM countries WHERE iso_code = 'US' LIMIT 1),
        ROUND((
            35
            + LEAST(30, GREATEST(0, release_year - 1990) * 0.6)
            + random() * 35
        )::numeric, 4)
    FROM movie_seed
    RETURNING id, title
)
INSERT INTO movie_genres (movie_id, genre_id, weight)
SELECT
    m.id,
    g.id,
    1.0000
FROM ins_movies m
JOIN movie_seed s ON s.title = m.title
JOIN genres g ON g.name = s.genre_name;

-- Assign all movies to provider
INSERT INTO movie_providers (movie_id, provider_id, availability_type, deep_link)
SELECT
    m.id,
    p.id,
    'subscription',
    'https://cinemaverse.example/watch/' || m.external_id
FROM movies m
CROSS JOIN providers p;

-- Interactions (30k) well distributed
INSERT INTO interaction_events (
    user_id,
    movie_id,
    event_type,
    event_value,
    event_weight,
    source,
    occurred_at
)
WITH user_pool AS (
    SELECT array_agg(id) AS ids FROM users
), movie_pool AS (
    SELECT array_agg(id) AS ids FROM movies
)
SELECT
    u.ids[1 + floor(random() * array_length(u.ids, 1))::int] AS user_id,
    m.ids[1 + floor(random() * array_length(m.ids, 1))::int] AS movie_id,
    CASE
        WHEN e.r < 0.30 THEN 'watch_complete'
        WHEN e.r < 0.62 THEN 'watch_start'
        WHEN e.r < 0.82 THEN 'like'
        WHEN e.r < 0.96 THEN 'rating'
        ELSE 'skip'
    END AS event_type,
    CASE
        WHEN e.r >= 0.82 AND e.r < 0.96 THEN e.rating_value
        ELSE NULL::numeric
    END AS event_value,
    CASE
        WHEN e.r < 0.30 THEN 1.2::numeric
        WHEN e.r < 0.62 THEN 0.4::numeric
        WHEN e.r < 0.82 THEN 2.2::numeric
        WHEN e.r < 0.96 THEN e.rating_value
        ELSE -0.2::numeric
    END AS event_weight,
    'real_seed_v1' AS source,
    NOW() - ((random() * 365)::int || ' days')::interval
FROM generate_series(1, 30000) AS gs
CROSS JOIN user_pool u
CROSS JOIN movie_pool m
CROSS JOIN LATERAL (
    SELECT random() AS r, (1 + floor(random() * 5))::numeric AS rating_value
    FROM (SELECT gs) AS per_row
) e
;

-- Aggregate feedback table
INSERT INTO user_movie_feedback (user_id, movie_id, rating_value, liked, watch_count, last_watched_at, aggregated_weight)
SELECT
    ie.user_id,
    ie.movie_id,
    MAX(CASE WHEN ie.event_type = 'rating' THEN ie.event_value END) AS rating_value,
    BOOL_OR(ie.event_type = 'like') AS liked,
    COUNT(*) FILTER (WHERE ie.event_type IN ('watch_start', 'watch_complete')) AS watch_count,
    MAX(ie.occurred_at) AS last_watched_at,
    COALESCE(SUM(ie.event_weight), 0) AS aggregated_weight
FROM interaction_events ie
GROUP BY ie.user_id, ie.movie_id;

COMMIT;
