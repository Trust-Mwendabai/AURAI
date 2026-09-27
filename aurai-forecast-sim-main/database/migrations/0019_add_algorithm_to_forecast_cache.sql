-- =============================================================================
-- Migration: Add algorithm to the forecast cache key
-- =============================================================================
-- The cache previously keyed only on (user, dataset, target, date_column,
-- horizon, period) — fine while every forecast used Prophet, but once the
-- Predictions page can pick ARIMA/Holt-Winters/XGBoost/LightGBM too, that key
-- would return one algorithm's cached result for a request asking for a
-- different one on the same dataset/target/horizon.
-- =============================================================================

ALTER TABLE `forecast_cache`
  ADD COLUMN `algorithm` VARCHAR(50) NOT NULL DEFAULT 'prophet' AFTER `period`;

ALTER TABLE `forecast_cache`
  DROP INDEX `cache_key_unique`;

ALTER TABLE `forecast_cache`
  ADD UNIQUE KEY `cache_key_unique` (`user_id`, `dataset_id`, `target_column`, `date_column`(100), `horizon`, `period`, `algorithm`);
