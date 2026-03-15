-- SmartShop Recommender - Massive PostgreSQL Schema
-- Domain: Movie recommendation for users
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

CREATE TABLE IF NOT EXISTS providers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(120) NOT NULL UNIQUE,
    provider_type VARCHAR(40) NOT NULL DEFAULT 'streaming',
    homepage_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- User domain
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

CREATE TABLE IF NOT EXISTS user_profiles (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    display_name VARCHAR(120),
    avatar_url TEXT,
    timezone VARCHAR(80),
    maturity_level VARCHAR(20) NOT NULL DEFAULT 'general',
    notification_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_preferences (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    min_release_year SMALLINT,
    max_release_year SMALLINT,
    min_runtime_min SMALLINT,
    max_runtime_min SMALLINT,
    prefers_original_audio BOOLEAN NOT NULL DEFAULT FALSE,
    avoid_spoilers BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT user_preferences_runtime_valid CHECK (
        min_runtime_min IS NULL OR max_runtime_min IS NULL OR min_runtime_min <= max_runtime_min
    )
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
    budget_usd BIGINT,
    revenue_usd BIGINT,
    age_certification VARCHAR(20),
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

CREATE TABLE IF NOT EXISTS movie_tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug VARCHAR(60) NOT NULL UNIQUE,
    name VARCHAR(80) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS movie_tag_links (
    movie_id UUID NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
    tag_id UUID NOT NULL REFERENCES movie_tags(id) ON DELETE CASCADE,
    confidence NUMERIC(5,4) NOT NULL DEFAULT 1.0000,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (movie_id, tag_id)
);

CREATE TABLE IF NOT EXISTS movie_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    movie_id UUID NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
    asset_type VARCHAR(20) NOT NULL,
    url TEXT NOT NULL,
    width INT,
    height INT,
    language_id UUID REFERENCES languages(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT movie_assets_type_valid CHECK (asset_type IN ('poster', 'backdrop', 'trailer', 'thumbnail'))
);

CREATE TABLE IF NOT EXISTS people (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_id VARCHAR(120) UNIQUE,
    full_name VARCHAR(180) NOT NULL,
    birth_date DATE,
    country_id UUID REFERENCES countries(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS movie_credits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    movie_id UUID NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
    person_id UUID NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    credit_type VARCHAR(20) NOT NULL,
    role_name VARCHAR(120),
    cast_order SMALLINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT movie_credits_type_valid CHECK (credit_type IN ('actor', 'director', 'writer', 'producer', 'composer'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_movie_credits_unique
    ON movie_credits(movie_id, person_id, credit_type, COALESCE(role_name, ''));

CREATE TABLE IF NOT EXISTS movie_providers (
    movie_id UUID NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
    provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
    availability_type VARCHAR(20) NOT NULL DEFAULT 'subscription',
    deep_link TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (movie_id, provider_id, availability_type),
    CONSTRAINT movie_providers_type_valid CHECK (availability_type IN ('subscription', 'rent', 'buy', 'free'))
);

-- ============================================
-- Interaction domain
-- ============================================

CREATE TABLE IF NOT EXISTS interaction_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    movie_id UUID NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
    event_type VARCHAR(20) NOT NULL,
    event_value NUMERIC(6,3),
    event_weight NUMERIC(8,4) NOT NULL DEFAULT 1.0000,
    source VARCHAR(40) NOT NULL DEFAULT 'web',
    session_id VARCHAR(120),
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

CREATE TABLE IF NOT EXISTS watch_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    movie_id UUID NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ,
    watched_seconds INT NOT NULL DEFAULT 0,
    completion_ratio NUMERIC(5,4) NOT NULL DEFAULT 0,
    device_type VARCHAR(40),
    app_version VARCHAR(40),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT watch_sessions_completion_valid CHECK (completion_ratio >= 0 AND completion_ratio <= 1)
);

CREATE TABLE IF NOT EXISTS user_exclusions (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    movie_id UUID NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
    reason VARCHAR(40) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, movie_id),
    CONSTRAINT user_exclusions_reason_valid CHECK (reason IN ('not_interested', 'already_seen', 'blocked_content'))
);

-- ============================================
-- ML training and recommendation outputs
-- ============================================

CREATE TABLE IF NOT EXISTS feature_catalog (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    feature_key VARCHAR(120) NOT NULL UNIQUE,
    feature_scope VARCHAR(20) NOT NULL,
    data_type VARCHAR(20) NOT NULL,
    description TEXT,
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT feature_catalog_scope_valid CHECK (feature_scope IN ('user', 'movie', 'pair')),
    CONSTRAINT feature_catalog_type_valid CHECK (data_type IN ('numeric', 'categorical', 'boolean', 'embedding'))
);

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

CREATE TABLE IF NOT EXISTS training_samples (
    id BIGSERIAL PRIMARY KEY,
    run_id UUID NOT NULL REFERENCES training_runs(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    movie_id UUID NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
    label NUMERIC(6,4) NOT NULL,
    feature_vector JSONB NOT NULL,
    split_set VARCHAR(10) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT training_samples_split_valid CHECK (split_set IN ('train', 'valid', 'test'))
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

CREATE TABLE IF NOT EXISTS recommendation_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recommendation_result_id BIGINT NOT NULL REFERENCES recommendation_results(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    feedback_type VARCHAR(30) NOT NULL,
    comment TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT recommendation_feedback_type_valid CHECK (feedback_type IN ('clicked', 'ignored', 'dismissed', 'watched_after_recommendation'))
);

-- ============================================
-- Operational / audit
-- ============================================

CREATE TABLE IF NOT EXISTS ingestion_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_name VARCHAR(120) NOT NULL,
    source_type VARCHAR(40) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'queued',
    records_received INT NOT NULL DEFAULT 0,
    records_inserted INT NOT NULL DEFAULT 0,
    records_failed INT NOT NULL DEFAULT 0,
    payload_uri TEXT,
    error_details TEXT,
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ingestion_jobs_status_valid CHECK (status IN ('queued', 'running', 'completed', 'failed'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGSERIAL PRIMARY KEY,
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    entity_name VARCHAR(100) NOT NULL,
    entity_id VARCHAR(120),
    old_value JSONB,
    new_value JSONB,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- Useful indexes
-- ============================================

CREATE INDEX IF NOT EXISTS idx_users_country ON users(country_id);
CREATE INDEX IF NOT EXISTS idx_users_language ON users(preferred_language_id);
CREATE INDEX IF NOT EXISTS idx_movies_release_date ON movies(release_date);
CREATE INDEX IF NOT EXISTS idx_movies_popularity ON movies(popularity_score DESC);
CREATE INDEX IF NOT EXISTS idx_movie_genres_genre_id ON movie_genres(genre_id);
CREATE INDEX IF NOT EXISTS idx_movie_credits_movie_id ON movie_credits(movie_id);
CREATE INDEX IF NOT EXISTS idx_events_user_time ON interaction_events(user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_movie_time ON interaction_events(movie_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_type ON interaction_events(event_type);
CREATE INDEX IF NOT EXISTS idx_feedback_user_movie ON user_movie_feedback(user_id, movie_id);
CREATE INDEX IF NOT EXISTS idx_training_samples_run ON training_samples(run_id);
CREATE INDEX IF NOT EXISTS idx_reco_results_user_rank ON recommendation_results(user_id, rank_position);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_name, entity_id);

COMMIT;
