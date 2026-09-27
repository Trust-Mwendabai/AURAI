-- =============================================================================
-- Migration: Add forecast result caching
-- =============================================================================
-- Cache forecast results to avoid recomputing identical forecasts
-- Significantly speeds up repeat forecasts on the same data
-- =============================================================================

CREATE TABLE `forecast_cache` (
  `id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `dataset_id` CHAR(36) NOT NULL,
  `target_column` VARCHAR(255) NOT NULL,
  `date_column` VARCHAR(255) NULL,
  `horizon` INT NOT NULL,
  `period` VARCHAR(50) NOT NULL,
  `regressors` JSON DEFAULT NULL,
  `forecast_result` LONGTEXT NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `accessed_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `hit_count` INT DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `cache_key_unique` (`user_id`, `dataset_id`, `target_column`, `date_column`(100), `horizon`, `period`),
  KEY `forecast_cache_expires_idx` (`created_at`),
  CONSTRAINT `forecast_cache_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `forecast_cache_dataset_id_fk` FOREIGN KEY (`dataset_id`) REFERENCES `datasets` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
