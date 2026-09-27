-- =============================================================================
-- Migration: Add scheduled forecast refreshes
-- =============================================================================
-- Lets a forecast re-run automatically on a cadence instead of only when
-- someone clicks Run Prediction. There is no cron daemon in this XAMPP
-- deployment, so due schedules are checked and run opportunistically when
-- an authenticated user's dashboard loads (see run_due_schedules() in
-- api/schedules.php) rather than by a true background process — a schedule
-- only actually executes the next time someone using the app is active.
-- =============================================================================

CREATE TABLE `scheduled_refreshes` (
  `id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `dataset_id` CHAR(36) NOT NULL,
  `target` VARCHAR(255) NOT NULL,
  `date_column` VARCHAR(255) NULL,
  `horizon` INT NOT NULL,
  `period` VARCHAR(50) NOT NULL,
  `algorithm` VARCHAR(50) NOT NULL DEFAULT 'prophet',
  `name` VARCHAR(255) NOT NULL,
  -- How often to re-run.
  `frequency` ENUM('daily', 'weekly', 'monthly') NOT NULL DEFAULT 'weekly',
  `enabled` BOOLEAN NOT NULL DEFAULT TRUE,
  `last_run_at` DATETIME NULL,
  `next_run_at` DATETIME NOT NULL,
  -- The prediction produced by the most recent run, so the UI can link
  -- straight to its result without a separate lookup.
  `last_prediction_id` CHAR(36) NULL,
  `last_error` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `scheduled_refreshes_due_idx` (`enabled`, `next_run_at`),
  KEY `scheduled_refreshes_user_idx` (`user_id`),
  CONSTRAINT `scheduled_refreshes_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `scheduled_refreshes_dataset_id_fk` FOREIGN KEY (`dataset_id`) REFERENCES `datasets` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
