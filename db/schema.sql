-- Recommender Movies - Simplified Core Schema
-- Domain: movie recommendation with lightweight training pipeline
-- Run with: psql -U postgres -d smartshop_recommender -f db/schema.sql

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================
-- Core reference tables
-- ============================================

CREATE TABLE IF NOT EXISTS countries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    iso_code CHAR(2) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS languages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(10) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS genres (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug VARCHAR(60) NOT NULL UNIQUE,
    name VARCHAR(80) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- User and preference domain
-- ============================================

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_id VARCHAR(120) UNIQUE,
    full_name VARCHAR(180) NOT NULL,
    email VARCHAR(255) UNIQUE,
    birth_date DATE,
    country_id UUID REFERENCES countries(id),
    preferred_language_id UUID REFERENCES languages(id),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_preferred_genres (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    genre_id UUID NOT NULL REFERENCES genres(id) ON DELETE CASCADE,
    affinity_score NUMERIC(5,4) NOT NULL DEFAULT 0.5000,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, genre_id)
);

-- ============================================
-- Movie domain
-- ============================================

CREATE TABLE IF NOT EXISTS movies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_id VARCHAR(120) UNIQUE,
    title VARCHAR(255) NOT NULL,
    original_title VARCHAR(255),
    synopsis TEXT,
    release_date DATE,
    runtime_min SMALLINT,
    primary_language_id UUID REFERENCES languages(id),
    production_country_id UUID REFERENCES countries(id),
    is_adult BOOLEAN NOT NULL DEFAULT FALSE,
    popularity_score NUMERIC(8,4) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT movies_runtime_positive CHECK (runtime_min IS NULL OR runtime_min > 0)
);

CREATE TABLE IF NOT EXISTS movie_genres (
    movie_id UUID NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
    genre_id UUID NOT NULL REFERENCES genres(id) ON DELETE CASCADE,
    weight NUMERIC(5,4) NOT NULL DEFAULT 1.0000,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (movie_id, genre_id)
);

-- ============================================
-- Interaction and feedback domain
-- ============================================

CREATE TABLE IF NOT EXISTS interaction_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    movie_id UUID NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
    event_type VARCHAR(20) NOT NULL,
    event_value NUMERIC(6,3),
    event_weight NUMERIC(8,4) NOT NULL DEFAULT 1.0000,
    source VARCHAR(40) NOT NULL DEFAULT 'web',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT interaction_events_type_valid CHECK (
        event_type IN ('watch_start', 'watch_complete', 'like', 'dislike', 'rating', 'wishlist_add', 'wishlist_remove', 'skip')
    ),
    CONSTRAINT interaction_events_rating_valid CHECK (
        event_type <> 'rating' OR (event_value IS NOT NULL AND event_value >= 1 AND event_value <= 5)
    )
);

CREATE TABLE IF NOT EXISTS user_movie_feedback (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    movie_id UUID NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
    rating_value NUMERIC(2,1),
    liked BOOLEAN,
    watch_count INT NOT NULL DEFAULT 0,
    last_watched_at TIMESTAMPTZ,
    aggregated_weight NUMERIC(10,4) NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, movie_id),
    CONSTRAINT user_movie_feedback_rating_valid CHECK (rating_value IS NULL OR (rating_value >= 1 AND rating_value <= 5))
);

-- ============================================
-- Training and model registry
-- ============================================

CREATE TABLE IF NOT EXISTS training_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_name VARCHAR(120),
    algorithm VARCHAR(80) NOT NULL,
    model_version VARCHAR(80) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'created',
    parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
    metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT training_runs_status_valid CHECK (status IN ('created', 'running', 'completed', 'failed', 'archived'))
);

CREATE TABLE IF NOT EXISTS model_registry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    training_run_id UUID REFERENCES training_runs(id) ON DELETE SET NULL,
    model_name VARCHAR(120) NOT NULL,
    model_version VARCHAR(80) NOT NULL,
    storage_uri TEXT NOT NULL,
    checksum_sha256 VARCHAR(64),
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (model_name, model_version)
);

-- ============================================
-- Recommendation persistence
-- ============================================

CREATE TABLE IF NOT EXISTS recommendation_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    model_id UUID REFERENCES model_registry(id) ON DELETE SET NULL,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    generation_mode VARCHAR(20) NOT NULL DEFAULT 'on_demand',
    source VARCHAR(40) NOT NULL DEFAULT 'worker',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT recommendation_batches_mode_valid CHECK (generation_mode IN ('batch', 'on_demand'))
);

CREATE TABLE IF NOT EXISTS recommendation_results (
    id BIGSERIAL PRIMARY KEY,
    batch_id UUID NOT NULL REFERENCES recommendation_batches(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    movie_id UUID NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
    rank_position INT NOT NULL,
    score NUMERIC(12,8) NOT NULL,
    reason JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (batch_id, user_id, movie_id)
);

-- ============================================
-- Core indexes
-- ============================================

CREATE INDEX IF NOT EXISTS idx_users_external_id ON users(external_id);
CREATE INDEX IF NOT EXISTS idx_users_full_name ON users(full_name);

CREATE INDEX IF NOT EXISTS idx_movies_external_id ON movies(external_id);
CREATE INDEX IF NOT EXISTS idx_movies_title ON movies(title);
CREATE INDEX IF NOT EXISTS idx_movies_popularity ON movies(popularity_score DESC);

CREATE INDEX IF NOT EXISTS idx_movie_genres_genre ON movie_genres(genre_id);

CREATE INDEX IF NOT EXISTS idx_interactions_user_time ON interaction_events(user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_interactions_movie_time ON interaction_events(movie_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_interactions_event_type ON interaction_events(event_type);

CREATE INDEX IF NOT EXISTS idx_user_pref_user ON user_preferred_genres(user_id);
CREATE INDEX IF NOT EXISTS idx_user_pref_genre ON user_preferred_genres(genre_id);

CREATE INDEX IF NOT EXISTS idx_training_runs_created_at ON training_runs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_model_registry_active ON model_registry(model_name, is_active);

CREATE INDEX IF NOT EXISTS idx_reco_batches_generated_at ON recommendation_batches(generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_reco_results_user_rank ON recommendation_results(user_id, rank_position);

COMMIT;
