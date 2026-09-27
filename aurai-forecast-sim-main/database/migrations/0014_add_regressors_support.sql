-- =============================================================================
-- Migration: Add exogenous variables (regressors) support to Prophet models
-- =============================================================================
-- Adds regressor configuration column to predictions table so Prophet can
-- incorporate external factors (marketing spend, holidays, temperature, etc.)
-- in forecast training and predictions.
-- =============================================================================

-- Add regressors column to store JSON array of regressor configurations
ALTER TABLE `predictions` ADD COLUMN `regressors` JSON NOT NULL DEFAULT (JSON_ARRAY());

-- Create an index on regressors for queries filtering by regressor usage
KEY `predictions_regressors_idx` (`regressors`(100));

-- The regressors column stores JSON like:
-- [
--   {
--     "name": "marketing_spend",
--     "column": "marketing_spend",
--     "description": "Marketing expenditure in dollars",
--     "include_future": true
--   },
--   {
--     "name": "holidays",
--     "column": "is_holiday",
--     "description": "Holiday indicator (0/1)",
--     "include_future": false
--   }
-- ]
--
-- Fields:
--   name: Unique identifier for the regressor
--   column: Dataset column name containing the regressor values
--   description: Human-readable description of what this regressor represents
--   include_future: Whether future values need to be provided for forecasting
