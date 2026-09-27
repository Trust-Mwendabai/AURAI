-- =============================================================================
-- Migration: Add saved reports and forecast bookmarking
-- =============================================================================
-- Lets users save favorite chart views, configurations, and dashboards.
-- Each saved report stores references to datasets/forecasts and their settings.
-- =============================================================================

CREATE TABLE `saved_reports` (
  `id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `workspace_id` CHAR(36) NULL,
  `name` VARCHAR(255) NOT NULL DEFAULT 'Saved Report',
  `description` TEXT NULL,
  -- JSON payload: { "datasetId": "...", "predictionIds": ["..."], "dateRange": {...}, "chartType": "...", ... }
  `config` JSON NOT NULL DEFAULT (JSON_OBJECT()),
  -- Display order on dashboard
  `position` INT DEFAULT 0,
  -- Whether to show on dashboard
  `pinned` BOOLEAN DEFAULT FALSE,
  -- Thumbnail/preview image (data URL or asset URL)
  `preview_url` VARCHAR(500) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `last_viewed_at` DATETIME NULL,
  `view_count` INT DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `saved_reports_user_workspace_idx` (`user_id`, `workspace_id`, `created_at` DESC),
  KEY `saved_reports_pinned_idx` (`user_id`, `pinned` DESC),
  CONSTRAINT `saved_reports_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `saved_reports_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Bookmarks for quick access to forecasts
CREATE TABLE `forecast_bookmarks` (
  `id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `prediction_id` CHAR(36) NOT NULL,
  `folder` VARCHAR(100) NULL DEFAULT 'default',
  `position` INT DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `forecast_bookmarks_user_prediction_unique` (`user_id`, `prediction_id`),
  KEY `forecast_bookmarks_user_folder_idx` (`user_id`, `folder`, `position`),
  CONSTRAINT `forecast_bookmarks_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `forecast_bookmarks_prediction_id_fk` FOREIGN KEY (`prediction_id`) REFERENCES `predictions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
