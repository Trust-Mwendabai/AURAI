-- =============================================================================
-- Migration: Add anomaly detection and scenario modeling support
-- =============================================================================
-- Adds tables for tracking anomalies (actual vs forecasted deviations) and
-- storing scenario models (what-if analysis with adjusted forecast points).
-- =============================================================================

-- Table for tracking anomalies when actual data deviates from forecast
CREATE TABLE `anomalies` (
  `id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `prediction_id` CHAR(36) NOT NULL,
  `date` DATE NOT NULL,
  `actual_value` DECIMAL(15,2) NOT NULL,
  `forecasted_value` DECIMAL(15,2) NOT NULL,
  `lower_bound` DECIMAL(15,2) NOT NULL,
  `upper_bound` DECIMAL(15,2) NOT NULL,
  -- Deviation in standard deviations from forecast
  `deviation_sigma` DECIMAL(5,2) NOT NULL,
  -- Whether anomaly is above upper or below lower bound
  `anomaly_type` ENUM('above_upper', 'below_lower', 'within_bounds') NOT NULL,
  -- User's note about what caused the anomaly
  `note` TEXT NULL,
  -- Whether this anomaly has been reviewed/acknowledged
  `acknowledged` BOOLEAN DEFAULT FALSE,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `anomalies_user_created_idx` (`user_id`, `created_at` DESC),
  KEY `anomalies_prediction_date_idx` (`prediction_id`, `date`),
  CONSTRAINT `anomalies_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `anomalies_prediction_id_fk` FOREIGN KEY (`prediction_id`) REFERENCES `predictions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table for storing scenario models (what-if analysis)
CREATE TABLE `scenarios` (
  `id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `prediction_id` CHAR(36) NOT NULL,
  `name` VARCHAR(255) NOT NULL DEFAULT 'Scenario',
  `description` TEXT NULL,
  -- JSON array of modified forecast points:
  -- [{"period": 1, "value": 5500, "reason": "Increased marketing spend"}, ...]
  `adjustments` JSON NOT NULL DEFAULT (JSON_ARRAY()),
  -- Calculated results: aggregated metrics for the scenario
  `results` JSON NOT NULL DEFAULT (JSON_OBJECT()),
  -- Whether this is the baseline or a variation
  `is_baseline` BOOLEAN DEFAULT FALSE,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `scenarios_user_created_idx` (`user_id`, `created_at` DESC),
  KEY `scenarios_prediction_id_idx` (`prediction_id`),
  CONSTRAINT `scenarios_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `scenarios_prediction_id_fk` FOREIGN KEY (`prediction_id`) REFERENCES `predictions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table for linking multiple scenarios for comparison
CREATE TABLE `scenario_comparisons` (
  `id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `name` VARCHAR(255) NOT NULL DEFAULT 'Comparison',
  -- JSON array of scenario IDs being compared: ["scenario_1", "scenario_2", ...]
  `scenario_ids` JSON NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `scenario_comparisons_user_created_idx` (`user_id`, `created_at` DESC),
  CONSTRAINT `scenario_comparisons_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
