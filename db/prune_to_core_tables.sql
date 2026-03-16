-- Prune schema to core tables used by the current API.
-- Keep only the minimal set required for demo + training + recommendations.
--
-- Run with:
-- docker compose exec postgres psql -U postgres -d smartshop_recommender -f /docker-entrypoint-initdb.d/prune_to_core_tables.sql

BEGIN;

DROP TABLE IF EXISTS
  recommendation_feedback,
  training_samples,
  feature_catalog,
  user_exclusions,
  watch_sessions,
  user_preferences,
  user_profiles,
  movie_providers,
  movie_assets,
  movie_credits,
  movie_tag_links,
  movie_tags,
  people,
  providers,
  ingestion_jobs,
  audit_logs
CASCADE;

COMMIT;
